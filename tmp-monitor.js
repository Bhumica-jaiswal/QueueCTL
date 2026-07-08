const { spawn } = require("child_process");
const Database = require("better-sqlite3");

const worker = spawn("node", ["src/cli/index.js", "worker", "start", "--count", "1"], {
  cwd: "Q:\\",
  stdio: ["ignore", "pipe", "pipe"],
  shell: true,
});

worker.stdout.on("data", (d) => process.stdout.write(`[worker] ${d}`));
worker.stderr.on("data", (d) => process.stderr.write(`[worker-err] ${d}`));

const db = new Database("Q:\\queuectl.db");
const seen = new Set();
const start = Date.now();

const interval = setInterval(() => {
  const row = db.prepare("SELECT id, state, attempts, next_run_at, error FROM jobs WHERE id='worker-fail'").get();
  const key = JSON.stringify(row);
  if (!seen.has(key)) {
    seen.add(key);
    console.log(`[${((Date.now()-start)/1000).toFixed(1)}s]`, row);
    if (row && row.state === "failed" && row.attempts >= 1) {
      const expected = Math.pow(2, row.attempts);
      const next = new Date(row.next_run_at).getTime();
      const prev = Date.now();
      console.log(`  backoff check: delaySeconds=2^${row.attempts}=${expected}, next_run in ~${Math.max(0, Math.round((next-prev)/1000))}s`);
    }
  }
  if (row && row.state === "dead") {
    clearInterval(interval);
    worker.kill("SIGINT");
    setTimeout(() => { worker.kill("SIGTERM"); process.exit(0); }, 3000);
  }
}, 200);

setTimeout(() => {
  console.log("TIMEOUT");
  clearInterval(interval);
  worker.kill("SIGINT");
  process.exit(1);
}, 90000);
