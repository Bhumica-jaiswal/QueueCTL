const { createDashboardApp } = require("../src/dashboard/server");

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`,
      });
    });
  });
}

describe("dashboard API", () => {
  let server;
  let baseUrl;

  beforeEach(async () => {
    const app = createDashboardApp({
      metricsService: {
        getMetrics: jest.fn().mockReturnValue({
          totalJobs: 2,
          states: {
            pending: 1,
            processing: 0,
            completed: 1,
            failed: 0,
            dead: 0,
          },
          successRate: 50,
          averageAttempts: 0.5,
        }),
      },
      queueService: {
        list: jest.fn().mockReturnValue([
          {
            id: "job-1",
            command: "echo hello",
            state: "completed",
            attempts: 1,
            max_retries: 3,
            priority: 10,
            timeout: null,
            next_run_at: "2026-01-01T00:00:00.000Z",
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:01.000Z",
          },
        ]),
      },
      logService: {
        getJobLogs: jest.fn().mockReturnValue({
          id: "job-1",
          state: "completed",
          attempts: 1,
          output: "hello",
          error: null,
        }),
      },
    });

    const running = await listen(app);
    server = running.server;
    baseUrl = running.baseUrl;
  });

  afterEach(() => {
    server.close();
  });

  test("GET /api/metrics returns service metrics", async () => {
    const response = await fetch(`${baseUrl}/api/metrics`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      totalJobs: 2,
      successRate: 50,
      averageAttempts: 0.5,
    });
  });

  test("GET /api/jobs returns dashboard job fields", async () => {
    const response = await fetch(`${baseUrl}/api/jobs`);
    const jobs = await response.json();

    expect(response.status).toBe(200);
    expect(jobs).toEqual([
      {
        id: "job-1",
        command: "echo hello",
        state: "completed",
        attempts: 1,
        max_retries: 3,
        priority: 10,
        timeout: null,
        next_run_at: "2026-01-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:01.000Z",
      },
    ]);
  });

  test("GET /api/jobs/:id returns job details with logs", async () => {
    const response = await fetch(`${baseUrl}/api/jobs/job-1`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: "job-1",
      command: "echo hello",
      output: "hello",
      error: null,
    });
  });
});
