const refreshMs = 3000;
let selectedJobId = null;

function text(id, value) {
  document.getElementById(id).textContent = value;
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  return new Date(value).toLocaleString();
}

function valueOrNone(value) {
  return value || "None";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function fetchJson(url) {
  const response = await fetch(url);
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error || "Dashboard request failed");
  }

  return body;
}

function renderMetrics(metrics) {
  text("totalJobs", metrics.totalJobs);
  text("pending", metrics.states.pending);
  text("processing", metrics.states.processing);
  text("completed", metrics.states.completed);
  text("failed", metrics.states.failed);
  text("dead", metrics.states.dead);
  text("successRate", `${metrics.successRate}%`);
  text("averageAttempts", metrics.averageAttempts);
}

function renderJobs(jobs) {
  const body = document.getElementById("jobs-body");
  body.innerHTML = "";

  for (const job of jobs) {
    const row = document.createElement("tr");
    row.className = "job-row";
    row.innerHTML = `
      <td>${escapeHtml(job.id)}</td>
      <td><span class="state">${escapeHtml(job.state)}</span></td>
      <td>${job.priority ?? 0}</td>
      <td>${job.attempts}</td>
      <td>${escapeHtml(formatDate(job.created_at))}</td>
    `;
    row.addEventListener("click", () => {
      selectedJobId = job.id;
      loadJobDetails(job.id);
    });
    body.appendChild(row);
  }
}

function renderJobDetails(job) {
  document.getElementById("job-details").innerHTML = `
    <div class="detail-block">
      <span class="field-label">ID</span>
      <strong>${escapeHtml(job.id)}</strong>
    </div>
    <div class="detail-block">
      <span class="field-label">Command</span>
      <pre>${escapeHtml(valueOrNone(job.command))}</pre>
    </div>
    <div class="detail-block">
      <span class="field-label">Output</span>
      <pre>${escapeHtml(valueOrNone(job.output))}</pre>
    </div>
    <div class="detail-block">
      <span class="field-label">Error</span>
      <pre>${escapeHtml(valueOrNone(job.error))}</pre>
    </div>
  `;
}

async function loadJobDetails(jobId) {
  try {
    renderJobDetails(await fetchJson(`/api/jobs/${encodeURIComponent(jobId)}`));
  } catch (error) {
    document.getElementById("job-details").innerHTML =
      `<p class="error-text">${error.message}</p>`;
  }
}

async function refresh() {
  try {
    const [metrics, jobs] = await Promise.all([
      fetchJson("/api/metrics"),
      fetchJson("/api/jobs"),
    ]);

    renderMetrics(metrics);
    renderJobs(jobs);
    text("status-text", `Last refreshed ${new Date().toLocaleTimeString()}`);

    if (selectedJobId) {
      await loadJobDetails(selectedJobId);
    }
  } catch (error) {
    text("status-text", error.message);
  }
}

refresh();
setInterval(refresh, refreshMs);
