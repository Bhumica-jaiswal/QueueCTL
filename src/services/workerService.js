function createWorkerService({ workerRepository }) {
  if (!workerRepository) {
    throw new Error("workerService requires a workerRepository");
  }

  function registerWorker(workerId) {
    return workerRepository.registerWorker(workerId);
  }

  function markWorkerStopping(workerId) {
    return workerRepository.markWorkerStopping(workerId);
  }

  function removeWorker(workerId) {
    return workerRepository.removeWorker(workerId);
  }

  function getWorkerStatus(workerId) {
    return workerRepository.getWorkerStatus(workerId);
  }

  function stopAllWorkers() {
    return workerRepository.stopAllWorkers();
  }

  function getActiveWorkerCount() {
    return workerRepository.getActiveWorkerCount();
  }

  return {
    registerWorker,
    markWorkerStopping,
    removeWorker,
    getWorkerStatus,
    stopAllWorkers,
    getActiveWorkerCount,
  };
}

module.exports = {
  createWorkerService,
};
