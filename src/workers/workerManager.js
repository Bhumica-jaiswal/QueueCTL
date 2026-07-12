const { Worker } = require("./worker");
const { createExecutor } = require("./executor");

class WorkerManager {
  constructor({
    count,
    queueService,
    workerService = null,
    workerIdPrefix = process.pid,
    pollIntervalMs = 1000,
    logger = console,
    executor = createExecutor(),
  }) {
    this.count = count;
    this.queueService = queueService;
    this.workerService = workerService;
    this.workerIdPrefix = workerIdPrefix;
    this.pollIntervalMs = pollIntervalMs;
    this.logger = logger;
    this.executor = executor;
    this.workers = [];
    this.workerPromises = [];
    this.isStopping = false;
    this.stopPromise = null;
  }

  start() {
    if (this.workers.length > 0) {
      return;
    }

    for (let index = 1; index <= this.count; index += 1) {
      const worker = new Worker({
        id: `worker-${this.workerIdPrefix}-${index}`,
        queueService: this.queueService,
        workerService: this.workerService,
        executor: this.executor,
        pollIntervalMs: this.pollIntervalMs,
        logger: this.logger,
      });

      this.workers.push(worker);
      this.workerPromises.push(worker.start());
    }
  }

  async stop() {
    if (this.stopPromise) {
      return this.stopPromise;
    }

    this.isStopping = true;
    this.stopPromise = Promise.all(this.workers.map((worker) => worker.stop())).then(
      () => {
        this.workers = [];
        this.workerPromises = [];
        this.isStopping = false;
        this.stopPromise = null;
      }
    );

    return this.stopPromise;
  }

  async shutdown() {
    if (this.stopPromise) {
      return this.stopPromise;
    }

    this.logger.log("Shutdown requested...");
    this.logger.log("Waiting for active jobs to finish...");
    await this.stop();
    this.logger.log("All workers stopped gracefully.");
  }

  async waitForShutdown() {
    await Promise.all(this.workerPromises);
  }

  waitForShutdownSignal(processObject = process) {
    return new Promise((resolve) => {
      const shutdown = async () => {
        processObject.removeListener("SIGINT", shutdown);
        processObject.removeListener("SIGTERM", shutdown);
        await this.shutdown();
        resolve();
      };

      processObject.once("SIGINT", shutdown);
      processObject.once("SIGTERM", shutdown);
    });
  }
}

module.exports = {
  WorkerManager,
};
