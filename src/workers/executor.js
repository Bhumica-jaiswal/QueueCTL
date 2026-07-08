const { spawn } = require("child_process");

function createExecutor() {
  async function execute(command) {
    return new Promise((resolve) => {
      const child = spawn(command, {
        shell: true,
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("close", (code) => {
        resolve({
          exitCode: code ?? 1,
          stdout: stdout.trimEnd(),
          stderr: stderr.trimEnd(),
        });
      });

      child.on("error", (error) => {
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
