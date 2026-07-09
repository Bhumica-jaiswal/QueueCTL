const { createExecutor } = require("../src/workers/executor");

function nodeCommand(script) {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
}

describe("executor", () => {
  test("runs normal job without timeout", async () => {
    const executor = createExecutor();

    const result = await executor.execute(nodeCommand("console.log('hello')"));

    expect(result).toEqual({
      exitCode: 0,
      stdout: "hello",
      stderr: "",
    });
  });

  test("runs fast job with timeout", async () => {
    const executor = createExecutor();

    const result = await executor.execute(nodeCommand("console.log('fast')"), 5);

    expect(result).toEqual({
      exitCode: 0,
      stdout: "fast",
      stderr: "",
    });
  });

  test("returns failure when job exceeds timeout", async () => {
    const executor = createExecutor();

    const result = await executor.execute(
      nodeCommand("setTimeout(() => {}, 2000)"),
      1
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("Job timed out after 1 seconds");
  });
});
