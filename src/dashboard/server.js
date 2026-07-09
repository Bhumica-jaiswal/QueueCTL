const path = require("path");
const express = require("express");
const { getConnection, closeConnection } = require("../database/connection");
const { initDatabase } = require("../database/init");
const { createConfigRepository } = require("../repositories/configRepository");
const { createJobRepository } = require("../repositories/jobRepository");
const { createConfigService } = require("../services/configService");
const { createQueueService } = require("../services/queueService");
const { createLogService } = require("../services/logService");
const { createMetricsService } = require("../services/metricsService");

const DEFAULT_PORT = 3000;

function toDashboardJob(job) {
  return {
    id: job.id,
    command: job.command,
    state: job.state,
    attempts: job.attempts,
    max_retries: job.max_retries,
    priority: job.priority,
    timeout: job.timeout,
    next_run_at: job.next_run_at,
    created_at: job.created_at,
    updated_at: job.updated_at,
  };
}

function createDashboardApp({ queueService, logService, metricsService }) {
  const app = express();
  const publicDir = path.join(__dirname, "public");

  app.use(express.static(publicDir));

  app.get("/api/metrics", (req, res) => {
    try {
      res.json(metricsService.getMetrics());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/jobs", (req, res) => {
    try {
      res.json(queueService.list().map(toDashboardJob));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/jobs/:id", (req, res) => {
    try {
      const job = queueService.list().find((item) => item.id === req.params.id);
      const logs = logService.getJobLogs(req.params.id);

      res.json({
        ...toDashboardJob(job),
        output: logs.output,
        error: logs.error,
      });
    } catch (error) {
      const statusCode = error.message.startsWith("Job not found:") ? 404 : 500;
      res.status(statusCode).json({ error: error.message });
    }
  });

  return app;
}

function createDashboardServices(db) {
  initDatabase(db);

  const jobRepository = createJobRepository(db);
  const configRepository = createConfigRepository(db);
  const configService = createConfigService({ configRepository });
  const queueService = createQueueService({ jobRepository, configService });
  const logService = createLogService({ jobRepository });
  const metricsService = createMetricsService({ jobRepository });

  return {
    queueService,
    logService,
    metricsService,
  };
}

function startDashboardServer({ port = DEFAULT_PORT, db } = {}) {
  const ownsConnection = !db;
  const database = db ?? getConnection();
  const services = createDashboardServices(database);
  const app = createDashboardApp(services);
  const server = app.listen(port);

  return {
    app,
    server,
    port,
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (ownsConnection) {
            closeConnection();
          }

          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

module.exports = {
  DEFAULT_PORT,
  createDashboardApp,
  createDashboardServices,
  startDashboardServer,
};
