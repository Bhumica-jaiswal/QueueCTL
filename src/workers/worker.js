function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

class Worker {
  constructor({ id, queueService, executor, pollIntervalMs = 1000, logger = console }) {
    this.id = id;
    this.queueService = queueService;
    this.executor = executor;
    this.pollIntervalMs = pollIntervalMs;
    this.logger = logger;
    this.isRunning = false;
    this.isStopping = false;
    this.runPromise = null;
  }

  start() {
    if (this.isRunning) {
      return this.runPromise;
    }

    this.isRunning = true;
    this.isStopping = false;
    this.logger.log(`Worker ${this.id} started`);
    this.runPromise = this.runLoop();
    return this.runPromise;
  }

  async stop() {
    this.isStopping = true;
    this.isRunning = false;
    if (this.runPromise) {
      await this.runPromise;
    }
  }

  async runLoop() {
    while (this.isRunning) {
      let claimedJob = null;

      try {
        claimedJob = this.queueService.claimNextJob(this.id);
        if (!claimedJob) {
          await sleep(this.pollIntervalMs);
          continue;
        }

        this.logger.log(`Worker ${this.id} picked job ${claimedJob.id}`);
        const result = await this.executor.execute(
          claimedJob.command,
          claimedJob.timeout
        );

        if (result.exitCode === 0) {
          this.queueService.completeJob(claimedJob.id, result.stdout);
          this.logger.log(`Worker ${this.id} completed job ${claimedJob.id}`);
        } else {
          const errorMessage =
            result.stderr || `Command exited with code ${result.exitCode}`;
          this.queueService.failJob(claimedJob.id, errorMessage);
          this.logger.log(`Worker ${this.id} failed job ${claimedJob.id}`);
        }
      } catch (error) {
        if (claimedJob) {
          this.queueService.failJob(claimedJob.id, error.message);
          this.logger.log(`Worker ${this.id} failed job ${claimedJob.id}`);
        } else {
          this.logger.error(`Worker ${this.id} loop error: ${error.message}`);
        }

        if (this.isStopping) {
          break;
        }

        await sleep(this.pollIntervalMs);
      }
    }

    this.logger.log(`Worker ${this.id} stopped`);
  }
}

module.exports = {
  Worker,
};
