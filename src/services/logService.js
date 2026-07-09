function createLogService({ jobRepository }) {
  if (!jobRepository) {
    throw new Error("logService requires a jobRepository");
  }

  function getJobLogs(jobId) {
    const job = jobRepository.findById(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    return {
      id: job.id,
      state: job.state,
      attempts: job.attempts,
      output: job.output,
      error: job.error,
    };
  }

  return {
    getJobLogs,
  };
}

module.exports = {
  createLogService,
};
