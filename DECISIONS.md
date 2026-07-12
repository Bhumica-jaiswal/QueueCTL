# DECISIONS.md

Answers to the five required questions. Line references are real, check them against `src/repositories/jobRepository.js` and `src/repositories/workerRepository.js` in this repo.

---

## 1. Which exact line(s) prevent two workers from claiming the same job, and why is that operation atomic across separate OS processes?

`src/repositories/jobRepository.js`, `claimNextJobTransaction`:

```js
const claimNextJobTransaction = db.transaction((workerId, now) => {
  recoverStaleJobs(now);

  const next = findNextClaimableStatement.get(now, now);
  if (!next) return null;

  const result = markClaimedStatement.run(String(workerId), now, now, next.id);
  if (result.changes === 0) return null;

  return findByIdStatement.get(next.id);
});
```

called with:

```js
claimNextJobTransaction.immediate(workerId, new Date().toISOString());
```

and the update itself:

```sql
UPDATE jobs SET state = 'processing', worker_id = ?, processing_started_at = ?, updated_at = ?
WHERE id = ? AND state IN ('pending', 'failed')
```

The important part is `.immediate(...)`. In `better-sqlite3` that runs the transaction as `BEGIN IMMEDIATE`, which makes SQLite grab a **RESERVED lock on the database file itself** before anything inside the transaction runs. That's not a Node-level lock. It's enforced by SQLite's file locking, so it's visible to every process that has `queuectl.db` open, not just the one that started the transaction. If a second worker process tries the same `.immediate()` call while the first is still running, it just has to wait.

Then the `WHERE ... AND state IN ('pending', 'failed')` guard closes the actual race: even if two workers both saw the same job as claimable, only whichever transaction runs first will actually flip the row to `processing` (`result.changes === 1`). The second one's `UPDATE` matches zero rows because the state has already changed, so `claimNextJob` correctly returns `null` for that worker instead of a false claim. A plain in-memory lock or a `Set` of claimed IDs wouldn't help here, it only protects one process, and the whole point of this requirement is that two `queuectl worker start` processes in two different terminals can't step on each other.

---

## 2. A worker is SIGKILLed halfway through a job. Walk through, step by step, what state the job is in and how it eventually runs again. What is the worst-case delay before recovery?

1. Worker **W1** claims job **J**. After the transaction commits: `state='processing'`, `worker_id='W1'`, `processing_started_at=T0`.
2. W1 spawns J's command and gets `SIGKILL`ed mid-execution. It's gone instantly, no handler in `executor.js` runs, so nothing updates the database.
3. J just sits there: `state='processing'`, `processing_started_at=T0`. As far as the database knows, it's still being worked on.
4. The next time **any** worker tries to claim a job (doesn't matter which one), it runs `recoverStaleJobs(now)` first, inside the same transaction as its own claim attempt:
   ```sql
   UPDATE jobs
   SET state = 'pending', worker_id = NULL, processing_started_at = NULL, updated_at = ?
   WHERE state = 'processing' AND processing_started_at < ?   -- now - 30s
   ```
   Once `T0` is more than `PROCESSING_LEASE_MS` (30 seconds) old, this catches J and resets it to `pending`. `attempts` isn't touched, so J doesn't lose retry history because of the crash.
5. J is now `pending` again and gets picked up by the very next `SELECT` in that same transaction. Could be a totally different worker than the one that originally crashed.
6. From there it just runs like a normal attempt.

**Worst case:** the lease is 30 seconds, and workers poll once a second, so recovery is roughly `30s (lease) + up to 1s (next poll) ≈ 31 seconds`. That's under the 60-second bar the assignment asks for.

This is a lease, not a heartbeat. There's no background thread pinging "I'm alive," recovery just happens as a side effect of a query that already runs on every claim. The trade-off is honest: a crashed job can look stuck in `processing` for up to ~30 seconds before anyone notices, but nothing extra is running during normal operation to pay for that.

---

## 3. Does dlq retry reset attempts? Why is that the right call?

Yes:

```sql
UPDATE jobs
SET state = 'pending', attempts = 0, error = NULL, next_run_at = ?, worker_id = NULL, processing_started_at = NULL, updated_at = ?
WHERE id = ? AND state = 'dead'
```

`dlq retry` is a manual, human decision, very different from the automatic retries the queue does on its own. By the time a job is `dead`, it's already used up every attempt it was configured to get. If I didn't reset `attempts`, a `dlq retry` would just mean "one more failure and it's right back in the DLQ," which isn't really giving it another shot. Resetting to `0` treats a manual retry as "someone looked at this and thinks it's worth trying again from scratch" under whatever the current `max_retries`/`backoff_base` config is. The obvious risk is that someone could retry the same broken job over and over and it keeps cycling back into the DLQ, but that's on the operator, not something the system should quietly block.

---

## 4. What designs did you consider and reject for worker stop (cross-process signaling), and why?

**What I went with:** a `workers` table (`src/repositories/workerRepository.js`). `worker start` writes a row with `status='running'`. `worker stop` runs:

```sql
UPDATE workers SET status = 'stopping', updated_at = ? WHERE status = 'running'
```

Each worker checks its own row at the top of every poll loop, and if it sees `stopping`, it finishes whatever job it's on, deletes its row, and exits.

**What I rejected:**

- **PID file + kill signal.** The obvious first idea, but it doesn't hold up cross-platform. Windows signal handling isn't the same as POSIX, and the assignment leans on PowerShell examples, so this would've meant writing and testing two different code paths. It also breaks quietly if a PID gets reused by some unrelated process after a crash.
- **Sockets / named pipes.** Same cross-platform issue, plus it's a second communication channel with its own way to fail (a leftover socket file after an unclean exit) on top of the database everything else already relies on.
- **Redis or some other broker.** This felt like the wrong direction entirely. The whole reason SQLite was chosen was "no extra infrastructure," and pulling in Redis just to send a stop signal contradicts that.

The database approach won because every worker is already polling the same SQLite file once a second anyway. Reusing that for a stop signal costs one small table, not a new dependency or a platform-specific branch.

---

## 5. If priorities were added tomorrow (high-priority jobs jump the queue), which parts of your design survive unchanged and which break?

Priority is actually already built in this version (`priority` column, `ORDER BY priority DESC, created_at ASC` in the claim query), so I can answer this from what actually happened rather than guessing.

**Didn't need to change at all:**
- The atomic claim transaction (see Q1): priority only affects which row `SELECT` picks, not the locking that makes the claim safe.
- Crash recovery (Q2): works off `processing_started_at`, has nothing to do with ordering.
- Retry/backoff, DLQ, config, worker registry, `worker stop`: none of them care what order jobs get worked in.
- The layering: priority ended up being one column and one extra clause, contained entirely in `jobRepository`.

**What actually had to change, and what's still missing:**
- `priority` had to be the *primary* sort key with `created_at` as the tiebreaker, not the other way around. If it were secondary, older low-priority jobs would still jump ahead of newer high-priority ones, which quietly defeats the whole feature.
- **Starvation is a real, currently-unhandled risk.** If high-priority jobs keep coming in, low-priority ones can wait forever, since they never make it to the top of that `ORDER BY`. Fixing that properly (some kind of aging so an old job's effective priority creeps up over time) would touch the claim query and probably need a scheduled sweep. It's an addition on top of what's here, not a rewrite, but it doesn't exist yet.
- If priority needed to be changeable *after* a job is already enqueued (bump it mid-queue), that's a new repository method plus a CLI command. It obviously can't reach into a job that's already `processing`, but for anything still `pending` or `failed` it's a small addition, not a redesign.