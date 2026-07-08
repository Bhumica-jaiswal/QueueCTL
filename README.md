# QueueCTL

QueueCTL is a small durable job queue implemented as a Node.js command-line tool.
It stores jobs in SQLite, runs shell commands through worker processes, retries
failed jobs with exponential backoff, and moves exhausted jobs into a dead letter
queue.

The project is intentionally compact: the goal is to show reliable backend queue
mechanics without requiring Redis, Postgres, or a separate broker.

## Setup

Requirements:

- Node.js 20+
- npm

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

Run the CLI from the project root:

```bash
npm run queuectl -- --help
```

Optional local install:

```bash
npm link
queuectl --help
```

## CLI Examples

Set retry defaults:

```bash
queuectl config set max-retries 3
queuectl config set backoff-base 2
```

Enqueue jobs:

```bash
queuectl enqueue '{"id":"job1","command":"echo hello"}'
queuectl enqueue '{"id":"job2","command":"node -e \"process.exit(1)\"","max_retries":2}'
```

Inspect queue state:

```bash
queuectl list
queuectl list --state failed
queuectl status
```

Start workers:

```bash
queuectl worker start --count 5
```

Inspect and retry dead letter jobs:

```bash
queuectl dlq list
queuectl dlq retry job2
```

## Architecture

```text
CLI commands
    |
    v
QueueService  <---- ConfigService
    |                  |
    v                  v
JobRepository     ConfigRepository
    |                  |
    +-------- SQLite --+
    |
    v
WorkerManager -> Worker(s) -> Executor -> shell command
```

Layer responsibilities:

- `src/cli/index.js`: argument parsing and user-facing output.
- `src/services/queueService.js`: queue rules, retry policy, DLQ operations.
- `src/services/configService.js`: supported config keys and validation.
- `src/repositories/jobRepository.js`: SQL statements and atomic job claims.
- `src/workers/worker.js`: polling loop and graceful stop behavior.
- `src/workers/executor.js`: shell command execution.

## Job Lifecycle

```text
pending
  |
  | worker atomically claims job
  v
processing
  |                  |
  | success          | failure with attempts < max_retries
  v                  v
completed          failed
                     |
                     | retry time reached
                     v
                  processing
                     |
                     | failure with attempts >= max_retries
                     v
                    dead
```

Dead jobs stay in the dead letter queue until an operator runs:

```bash
queuectl dlq retry <jobId>
```

That moves the job back to `pending`, clears the error, and resets attempts.

## Worker Design

Workers poll for claimable work. A job is claimable when it is:

- `pending`
- `failed` and `next_run_at` is in the past

Claiming is atomic. The repository opens an immediate SQLite transaction, selects
the oldest claimable job, marks it `processing`, records `worker_id`, and commits.
This prevents multiple workers from executing the same job.

Shutdown is graceful. `SIGINT` and `SIGTERM` stop the worker manager from claiming
more jobs, wait for in-flight jobs to finish, and then close the database.

## Retry Logic

Retry behavior is configuration-driven:

- `max-retries`: maximum failed attempts before the job becomes `dead`
- `backoff-base`: base used for exponential retry delay

After a failure, QueueCTL increments `attempts`.

If `attempts < max_retries`, the job becomes `failed` and gets:

```text
next_run_at = now + backoff_base ^ attempts seconds
```

If `attempts >= max_retries`, the job becomes `dead`.

Example with `max-retries=3` and `backoff-base=2`:

```text
attempt 1 fails -> failed, retry after 2 seconds
attempt 2 fails -> failed, retry after 4 seconds
attempt 3 fails -> dead
```

## Database Choice

SQLite is a good fit for this project because QueueCTL is a local CLI-first queue:

- it has no external service dependency
- it persists jobs across process restarts
- transactions are simple and reliable
- write concurrency is acceptable for a small local worker pool

The connection enables WAL mode and foreign keys. WAL improves read/write behavior
for a local queue while keeping the deployment story simple.

## Tradeoffs

- SQLite is not intended for large distributed worker fleets.
- Jobs execute shell commands, so callers must treat queued commands as trusted input.
- Workers poll instead of using push notifications, which is simpler but less instant.
- In-flight jobs interrupted by a process crash remain `processing`; a production
  lease/heartbeat recovery mechanism would be a natural future improvement.
- Retry timing uses wall-clock timestamps, so clock changes can affect scheduling.

## Test Coverage

The test suite covers:

- successful job execution
- failed job retry scheduling
- dead letter queue movement
- multiple workers without duplicate execution
- persistence after closing and reopening the database
- config validation and repository behavior
