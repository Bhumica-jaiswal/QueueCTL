const JOB_STATES = ["pending", "processing", "completed", "failed", "dead"];

function roundMetric(value) {
  return Math.round(value * 100) / 100;
}

function createMetricsService({ jobRepository }) {
  if (!jobRepository) {
    throw new Error("metricsService requires a jobRepository");
  }

  function getMetrics() {
    const counts = jobRepository.getJobCounts();
    const attemptStats = jobRepository.getAttemptStats();
    const totalJobs = counts.total ?? 0;
    const states = {};

    for (const state of JOB_STATES) {
      states[state] = counts.byState[state] ?? 0;
    }

    return {
      totalJobs,
      states,
      successRate:
        totalJobs === 0 ? 0 : roundMetric((states.completed / totalJobs) * 100),
      averageAttempts: roundMetric(attemptStats.averageAttempts ?? 0),
    };
  }

  return {
    getMetrics,
  };
}

module.exports = {
  createMetricsService,
};
