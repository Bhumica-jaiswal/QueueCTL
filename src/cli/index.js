#!/usr/bin/env node

const { Command } = require("commander");
const { getConnection, closeConnection } = require("../database/connection");
const { initDatabase } = require("../database/init");
const { createConfigRepository } = require("../repositories/configRepository");
const { createJobRepository } = require("../repositories/jobRepository");
const {
  createConfigService,
  ConfigValidationError,
} = require("../services/configService");
const {
  createQueueService,
  QueueValidationError,
} = require("../services/queueService");
const { createLogService } = require("../services/logService");
const { createMetricsService } = require("../services/metricsService");
const { WorkerManager } = require("../workers/workerManager");
const {
  buildEnqueuePayload,
  PayloadValidationError,
} = require("./parseJobPayload");

async function runWorkers(count, queueService) {
  const normalizedCount = Number(count);
  if (!Number.isInteger(normalizedCount) || normalizedCount < 1) {
    throw new QueueValidationError("Worker count must be a positive integer");
  }

  const manager = new WorkerManager({
    count: normalizedCount,
    queueService,
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

function formatNullableLogValue(value) {
  return value ?? "None";
}

function createProgram({ queueService, configService, logService, metricsService }) {
  const program = new Command();

  program
    .name("queuectl")
    .description("QueueCTL command-line interface")
    .version("1.0.0")
    .showHelpAfterError("\nUse --help to see available commands.");

  program
    .command("enqueue")
    .description("Enqueue a new job from JSON or flags")
    .argument("[jobJson...]", "Strict JSON job payload")
    .option("--id <id>", "Job id")
    .option("--command <command>", "Shell command to run")
    .option("--max-retries <count>", "Maximum retry attempts")
    .option("--run-at <datetime>", "Earliest time the job can run")
    .option("--priority <number>", "Job priority")
    .action((jobJsonParts, options) => {
      try {
        const parsed = buildEnqueuePayload(jobJsonParts, options);
        const created = queueService.enqueue(parsed);
        console.log(`Enqueued job '${created.id}' with state '${created.state}'.`);
      } catch (error) {
        if (
          error instanceof SyntaxError ||
          error instanceof QueueValidationError ||
          error instanceof PayloadValidationError
        ) {
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
        if (error instanceof QueueValidationError) {
          console.error(error.message);
        } else {
          console.error(`Failed to list jobs: ${error.message}`);
        }

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

  program
    .command("logs")
    .description("Show stored output and error for a job")
    .argument("<jobId>", "Job id")
    .action((jobId) => {
      try {
        const logs = logService.getJobLogs(jobId);

        console.log(`Job: ${logs.id}`);
        console.log("");
        console.log(`State: ${logs.state}`);
        console.log(`Attempts: ${logs.attempts}`);
        console.log("");
        console.log("Output:");
        console.log(formatNullableLogValue(logs.output));
        console.log("");
        console.log("Error:");
        console.log(formatNullableLogValue(logs.error));
      } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
      }
    });

  program
    .command("metrics")
    .description("Show queue health and execution statistics")
    .action(() => {
      try {
        const metrics = metricsService.getMetrics();

        console.log("QueueCTL Metrics");
        console.log("");
        console.log(`Total Jobs: ${metrics.totalJobs}`);
        console.log("");
        console.log(`Pending: ${metrics.states.pending}`);
        console.log(`Processing: ${metrics.states.processing}`);
        console.log(`Completed: ${metrics.states.completed}`);
        console.log(`Failed: ${metrics.states.failed}`);
        console.log(`Dead: ${metrics.states.dead}`);
        console.log("");
        console.log(`Success Rate: ${metrics.successRate}%`);
        console.log("");
        console.log(`Average Attempts: ${metrics.averageAttempts}`);
      } catch (error) {
        console.error(`Failed to read queue metrics: ${error.message}`);
        process.exitCode = 1;
      }
    });

  const dlqCommand = program.command("dlq").description("Manage dead letter jobs");

  dlqCommand
    .command("list")
    .description("List dead letter jobs")
    .action(() => {
      try {
        const jobs = queueService.listDeadJobs();
        if (jobs.length === 0) {
          console.log("Dead letter queue is empty");
          return;
        }

        console.table(
          jobs.map((job) => ({
            id: job.id,
            attempts: job.attempts,
            max_retries: job.max_retries,
            command: job.command,
            error: job.error,
            updated_at: job.updated_at,
          }))
        );
      } catch (error) {
        console.error(`Failed to list dead letter jobs: ${error.message}`);
        process.exitCode = 1;
      }
    });

  dlqCommand
    .command("retry")
    .description("Retry a dead letter job")
    .argument("<jobId>", "Dead letter job id")
    .action((jobId) => {
      try {
        const job = queueService.retryDeadJob(jobId);
        console.log(`Retried job '${job.id}' with state '${job.state}'.`);
      } catch (error) {
        if (error instanceof QueueValidationError) {
          console.error(error.message);
        } else {
          console.error(`Failed to retry dead letter job: ${error.message}`);
        }

        process.exitCode = 1;
      }
    });

  const configCommand = program.command("config").description("Manage queue config");

  configCommand
    .command("set")
    .description("Set a queue config value")
    .argument("<key>", "Config key")
    .argument("<value>", "Config value")
    .action((key, value) => {
      try {
        const savedValue = configService.set(key, value);
        console.log(`Set ${key}=${savedValue}`);
      } catch (error) {
        if (error instanceof ConfigValidationError) {
          console.error(error.message);
        } else {
          console.error(`Failed to set config: ${error.message}`);
        }

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
        await runWorkers(options.count, queueService);
      } catch (error) {
        if (error instanceof QueueValidationError) {
          console.error(error.message);
        } else {
          console.error(`Failed to start workers: ${error.message}`);
        }

        process.exitCode = 1;
      }
    });

  return program;
}

function main() {
  const db = getConnection();
  initDatabase(db);

  const jobRepository = createJobRepository(db);
  const configRepository = createConfigRepository(db);
  const configService = createConfigService({ configRepository });
  const queueService = createQueueService({ jobRepository, configService });
  const logService = createLogService({ jobRepository });
  const metricsService = createMetricsService({ jobRepository });
  const program = createProgram({
    queueService,
    configService,
    logService,
    metricsService,
  });

  return program.parseAsync(process.argv).finally(() => {
    closeConnection();
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  createProgram,
  formatNullableLogValue,
  runWorkers,
};
