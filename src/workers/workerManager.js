const { Worker } = require("./worker");
const { createExecutor } = require("./executor");

class WorkerManager {
  constructor({
    count,
    queueService,
    pollIntervalMs = 1000,
    logger = console,
    executor = createExecutor(),
  }) {
    this.count = count;
    this.queueService = queueService;
    this.pollIntervalMs = pollIntervalMs;
    this.logger = logger;
    this.executor = executor;
    this.workers = [];
    this.workerPromises = [];
  }

  start() {
    if (this.workers.length > 0) {
      return;
    }

    for (let index = 1; index <= this.count; index += 1) {
      const worker = new Worker({
        id: index,
        queueService: this.queueService,
        executor: this.executor,
        pollIntervalMs: this.pollIntervalMs,
        logger: this.logger,
      });

      this.workers.push(worker);
      this.workerPromises.push(worker.start());
    }
  }

  async stop() {
    await Promise.all(this.workers.map((worker) => worker.stop()));
    this.workers = [];
    this.workerPromises = [];
  }

  async waitForShutdown() {
    await Promise.all(this.workerPromises);
  }
}

module.exports = {
  WorkerManager,
};
