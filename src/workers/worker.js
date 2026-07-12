class Worker {
  constructor({
    id,
    queueService,
    workerService = null,
    executor,
    pollIntervalMs = 1000,
    logger = console,
  }) {
    this.id = id;
    this.queueService = queueService;
    this.workerService = workerService;
    this.executor = executor;
    this.pollIntervalMs = pollIntervalMs;
    this.logger = logger;
    this.isRunning = false;
    this.isStopping = false;
    this.runPromise = null;
    this.stopIdleWait = null;
  }

  start() {
    if (this.isRunning) {
      return this.runPromise;
    }

    this.isRunning = true;
    this.isStopping = false;
    this.workerService?.registerWorker(this.id);
    this.logger.log(`Worker ${this.id} started`);
    this.runPromise = this.runLoop();
    return this.runPromise;
  }

  async stop() {
    this.isStopping = true;
    this.isRunning = false;
    this.workerService?.markWorkerStopping(this.id);
    if (this.stopIdleWait) {
      this.stopIdleWait();
      this.stopIdleWait = null;
    }

    if (this.runPromise) {
      await this.runPromise;
    }
  }

  waitForNextPoll() {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.stopIdleWait = null;
        resolve();
      }, this.pollIntervalMs);

      this.stopIdleWait = () => {
        clearTimeout(timeoutId);
        resolve();
      };
    });
  }

  async runLoop() {
    while (this.isRunning) {
      let claimedJob = null;

      try {
        if (this.workerService?.getWorkerStatus(this.id) === "stopping") {
          this.isStopping = true;
          this.isRunning = false;
          break;
        }

        claimedJob = this.queueService.claimNextJob(this.id);
        if (!claimedJob) {
          await this.waitForNextPoll();
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

    try {
      this.logger.log(`Worker ${this.id} stopped`);
    } finally {
      this.workerService?.removeWorker(this.id);
    }
  }
}

module.exports = {
  Worker,
};
