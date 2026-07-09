const { spawn } = require("child_process");

function createExecutor() {
  async function execute(command, timeout = null) {
    return new Promise((resolve) => {
      const child = spawn(command, {
        shell: true,
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timeoutMs = timeout === null ? null : timeout * 1000;
      const timeoutId =
        timeoutMs === null
          ? null
          : setTimeout(() => {
              timedOut = true;
              child.kill();
            }, timeoutMs);

      function clearTimeoutIfNeeded() {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("close", (code) => {
        clearTimeoutIfNeeded();

        if (timedOut) {
          resolve({
            exitCode: 1,
            stdout: stdout.trimEnd(),
            stderr: `Job timed out after ${timeout} seconds`,
          });
          return;
        }

        resolve({
          exitCode: code ?? 1,
          stdout: stdout.trimEnd(),
          stderr: stderr.trimEnd(),
        });
      });

      child.on("error", (error) => {
        clearTimeoutIfNeeded();
        resolve({
          exitCode: 1,
          stdout: stdout.trimEnd(),
          stderr: error.message,
        });
      });
    });
  }

  return {
    execute,
  };
}

module.exports = {
  createExecutor,
};
