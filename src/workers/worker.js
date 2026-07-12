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

  logJobFailure(job, failedJob) {
    if (!failedJob) {
      this.logger.log(`Worker ${this.id} failed job ${job.id}`);
      return;
    }

    if (failedJob?.state === "dead") {
      this.logger.log(
        `Worker ${this.id} failed job ${job.id}\n` +
          `Retries exhausted (${failedJob.attempts}/${failedJob.max_retries}).\n` +
          "Moving job to Dead Letter Queue."
      );
      return;
    }

    const retryDelaySeconds = Math.round(
      (Date.parse(failedJob.next_run_at) - Date.parse(failedJob.updated_at)) / 1000
    );
    this.logger.log(
      `Worker ${this.id} failed job ${job.id}\n` +
        `Retry scheduled in ${retryDelaySeconds}s\n` +
        `Next retry at ${failedJob.next_run_at}`
    );
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

        this.logger.log(
          `Worker ${this.id} picked job ${claimedJob.id} ` +
            `(Attempt ${claimedJob.attempts + 1}/${claimedJob.max_retries})`
        );
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
          const failedJob = this.queueService.failJob(claimedJob.id, errorMessage);
          this.logJobFailure(claimedJob, failedJob);
        }
      } catch (error) {
        if (claimedJob) {
          const failedJob = this.queueService.failJob(claimedJob.id, error.message);
          this.logJobFailure(claimedJob, failedJob);
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
