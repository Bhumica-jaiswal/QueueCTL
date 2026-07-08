class QueueValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "QueueValidationError";
  }
}

function createQueueService({ jobRepository }) {
  if (!jobRepository) {
    throw new Error("queueService requires a jobRepository");
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
        typeof jobPayload.max_retries === "number" ? jobPayload.max_retries : 0,
      next_run_at: new Date().toISOString(),
      output: null,
      error: null,
    });
  }

  function list({ state } = {}) {
    const normalizedState = typeof state === "string" ? state.trim() : "";
    if (normalizedState) {
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

  return {
    enqueue,
    list,
    status,
  };
}

module.exports = {
  createQueueService,
  QueueValidationError,
};
