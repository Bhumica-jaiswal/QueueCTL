class QueueValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "QueueValidationError";
  }
}

const JOB_STATES = ["pending", "processing", "completed", "failed", "dead"];

function createQueueService({ jobRepository, configService }) {
  if (!jobRepository) {
    throw new Error("queueService requires a jobRepository");
  }

  if (!configService) {
    throw new Error("queueService requires a configService");
  }

  function enqueue(jobPayload) {
    if (!jobPayload || typeof jobPayload !== "object" || Array.isArray(jobPayload)) {
      throw new QueueValidationError("Job payload must be a JSON object");
    }

    const id = typeof jobPayload.id === "string" ? jobPayload.id.trim() : "";
    const command =
      typeof jobPayload.command === "string" ? jobPayload.command.trim() : "";

    if (!id) {
      throw new QueueValidationError("Missing required field: id");
    }

    if (!command) {
      throw new QueueValidationError("Missing required field: command");
    }

    if (
      jobPayload.max_retries !== undefined &&
      (!Number.isInteger(jobPayload.max_retries) || jobPayload.max_retries < 0)
    ) {
      throw new QueueValidationError("max_retries must be a non-negative integer");
    }

    const existing = jobRepository.findById(id);
    if (existing) {
      throw new QueueValidationError(`Job with id '${id}' already exists`);
    }

    return jobRepository.createJob({
      id,
      command,
      state: "pending",
      attempts: 0,
      max_retries:
        typeof jobPayload.max_retries === "number"
          ? jobPayload.max_retries
          : configService.getNumber("max-retries"),
      next_run_at: new Date().toISOString(),
      output: null,
      error: null,
    });
  }

  function list({ state } = {}) {
    const normalizedState = typeof state === "string" ? state.trim() : "";
    if (normalizedState) {
      if (!JOB_STATES.includes(normalizedState)) {
        throw new QueueValidationError(
          `Invalid state '${normalizedState}'. Allowed values: ${JOB_STATES.join(", ")}`
        );
      }

      return jobRepository.findByState(normalizedState);
    }

    return jobRepository.findAll();
  }

  function status() {
    const counts = jobRepository.getJobCounts();

    return {
      pending: counts.byState.pending ?? 0,
      processing: counts.byState.processing ?? 0,
      completed: counts.byState.completed ?? 0,
      failed: counts.byState.failed ?? 0,
      dead: counts.byState.dead ?? 0,
      total: counts.total ?? 0,
    };
  }

  function claimNextJob(workerId) {
    return jobRepository.claimNextJob(workerId);
  }

  function completeJob(id, output = null) {
    return jobRepository.markJobCompleted(id, output);
  }

  function failJob(id, errorMessage = null) {
    const job = jobRepository.findById(id);
    if (!job) {
      return null;
    }

    return jobRepository.recordJobFailure(id, {
      attempts: job.attempts,
      maxRetries: job.max_retries,
      backoffBase: configService.getNumber("backoff-base"),
      errorMessage,
    });
  }

  function listDeadJobs() {
    return jobRepository.findByState("dead");
  }

  function retryDeadJob(id) {
    const normalizedId = typeof id === "string" ? id.trim() : "";
    if (!normalizedId) {
      throw new QueueValidationError("Job id is required");
    }

    const retried = jobRepository.retryDeadJob(normalizedId);
    if (!retried) {
      throw new QueueValidationError(`Dead job '${normalizedId}' was not found`);
    }

    return retried;
  }

  return {
    enqueue,
    list,
    status,
    claimNextJob,
    completeJob,
    failJob,
    listDeadJobs,
    retryDeadJob,
  };
}

module.exports = {
  createQueueService,
  QueueValidationError,
};
