#!/usr/bin/env node

const { Command } = require("commander");
const { getConnection, closeConnection } = require("../database/connection");
const { initDatabase } = require("../database/init");
const { createJobRepository } = require("../repositories/jobRepository");
const {
  createQueueService,
  QueueValidationError,
} = require("../services/queueService");
const { WorkerManager } = require("../workers/workerManager");

const db = getConnection();
initDatabase(db);

const jobRepository = createJobRepository(db);
const queueService = createQueueService({ jobRepository });

async function runWorkers(count) {
  const normalizedCount = Number(count);
  if (!Number.isInteger(normalizedCount) || normalizedCount < 1) {
    throw new QueueValidationError("Worker count must be a positive integer");
  }

  const manager = new WorkerManager({
    count: normalizedCount,
    jobRepository,
  });

  manager.start();

  await new Promise((resolve) => {
    let isStopping = false;

    const shutdown = async () => {
      if (isStopping) {
        return;
      }

      isStopping = true;
      console.log("Stopping workers...");
      await manager.stop();
      resolve();
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

function parseJobPayload(rawPayload) {
  try {
    return JSON.parse(rawPayload);
  } catch (_jsonError) {
    const trimmed = rawPayload.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      throw new SyntaxError("Invalid JSON");
    }

    const body = trimmed.slice(1, -1).trim();
    if (!body) {
      return {};
    }

    const result = {};
    const pairs = body.split(",");

    for (const pair of pairs) {
      const separatorIndex = pair.indexOf(":");
      if (separatorIndex === -1) {
        throw new SyntaxError("Invalid JSON");
      }

      const rawKey = pair.slice(0, separatorIndex).trim();
      const rawValue = pair.slice(separatorIndex + 1).trim();
      const key = rawKey.replace(/^['\"]|['\"]$/g, "");
      const value = rawValue.replace(/^['\"]|['\"]$/g, "");

      if (!key) {
        throw new SyntaxError("Invalid JSON");
      }

      result[key] = value;
    }

    return result;
  }
}

const program = new Command();

program
  .name("queuectl")
  .description("QueueCTL command-line interface")
  .version("1.0.0")
  .showHelpAfterError("\nUse --help to see available commands.");

program
  .command("enqueue")
  .description("Enqueue a new job from a JSON payload")
  .argument("<jobJson...>", "Job JSON payload")
  .action((jobJsonParts) => {
    try {
      const jobJson = jobJsonParts.join(" ");
      const parsed = parseJobPayload(jobJson);
      const created = queueService.enqueue(parsed);
      console.log(`Enqueued job '${created.id}' with state '${created.state}'.`);
    } catch (error) {
      if (error instanceof SyntaxError) {
        console.error("Invalid JSON payload");
      } else if (error instanceof QueueValidationError) {
        console.error(error.message);
      } else {
        console.error(`Failed to enqueue job: ${error.message}`);
      }

      process.exitCode = 1;
    }
  });

program
  .command("list")
  .description("List jobs, optionally filtered by state")
  .option("--state <state>", "Filter jobs by state")
  .action((options) => {
    try {
      const jobs = queueService.list({ state: options.state });
      if (jobs.length === 0) {
        console.log("Queue is empty");
        return;
      }

      console.table(
        jobs.map((job) => ({
          id: job.id,
          state: job.state,
          attempts: job.attempts,
          command: job.command,
          created_at: job.created_at,
          updated_at: job.updated_at,
        }))
      );
    } catch (error) {
      console.error(`Failed to list jobs: ${error.message}`);
      process.exitCode = 1;
    }
  });

program
  .command("status")
  .description("Show queue state counters")
  .action(() => {
    try {
      const status = queueService.status();

      console.log(`pending: ${status.pending}`);
      console.log(`processing: ${status.processing}`);
      console.log(`completed: ${status.completed}`);
      console.log(`failed: ${status.failed}`);
      console.log(`dead: ${status.dead}`);
    } catch (error) {
      console.error(`Failed to read queue status: ${error.message}`);
      process.exitCode = 1;
    }
  });

const workerCommand = program
  .command("worker")
  .description("Manage queue workers");

workerCommand
  .command("start")
  .description("Start background workers")
  .option("--count <count>", "Number of workers", "1")
  .action(async (options) => {
    try {
      await runWorkers(options.count);
    } catch (error) {
      if (error instanceof QueueValidationError) {
        console.error(error.message);
      } else {
        console.error(`Failed to start workers: ${error.message}`);
      }

      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv).finally(() => {
  closeConnection();
});
