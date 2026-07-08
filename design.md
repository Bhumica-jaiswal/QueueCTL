# QueueCTL Design Notes

## Why SQLite

QueueCTL uses SQLite because the system is designed as a local durable queue, not
a distributed queue service. SQLite gives the project:

- durable job storage with no external infrastructure
- transactional state transitions
- simple setup for CLI usage and automated tests
- enough write concurrency for a small pool of local workers

The database connection enables WAL mode. WAL lets readers and writers cooperate
better than the default rollback journal and is a practical default for this kind
of local queue.

The main limitation is that SQLite has a single-writer model. That is acceptable
for QueueCTL because job claiming and state updates are short transactions. It
would not be the right storage engine for a high-throughput distributed worker
fleet.

## Worker Locking Approach

Workers call `claimNextJob(workerId)` before executing any command. The claim uses
an immediate SQLite transaction:

1. Find the oldest claimable job.
2. Mark it `processing`.
3. Record the claiming `worker_id`.
4. Commit before command execution starts.

A claimable job is either:

- `pending`
- `failed` with `next_run_at <= now`

The update is guarded by state, so only jobs still in a claimable state can move
to `processing`. Because the transaction is immediate, competing workers serialize
through SQLite instead of racing in application memory.

The worker never executes a job that it has not successfully claimed.

## Retry Design

Retry policy is centralized in `QueueService`. Workers report success or failure;
they do not decide retry state directly.

On failure:

1. Load the current job.
2. Increment `attempts`.
3. If `attempts < max_retries`, store `state='failed'` and schedule `next_run_at`.
4. If `attempts >= max_retries`, store `state='dead'`.

Backoff is exponential:

```text
delay = backoff_base ^ attempts seconds
```

`max-retries` and `backoff-base` are stored in the config table and validated by
`ConfigService`. Jobs can also carry their own `max_retries` value at enqueue time.

Dead letter retry is explicit. `queuectl dlq retry <jobId>` changes a dead job
back to `pending`, clears `error`, and resets `attempts` to zero.

## Graceful Shutdown

The CLI handles `SIGINT` and `SIGTERM` while workers are running. On shutdown:

1. The worker manager asks each worker to stop.
2. Workers stop claiming new jobs.
3. Any current job is allowed to finish.
4. The database connection closes after the command completes.

This avoids abandoning successfully claimed jobs during normal shutdown. A crash
or forced kill can still leave a job in `processing`; recovering stale processing
jobs would require a lease timeout or heartbeat and is intentionally left out of
the current scope.

## State Ownership

The repository owns SQL and atomic transitions. The services own product rules.

That separation keeps the repository small and predictable while preventing the
worker loop from growing retry and DLQ policy branches. It also makes tests more
direct: repository tests cover persistence and locking primitives, service tests
cover behavior, and worker tests cover execution flow.
