const form = document.getElementById('form');
const logsEl = document.getElementById('logs');
const resultsEl = document.getElementById('results');
const progressEl = document.getElementById('progress');
const queueEl = document.getElementById('queue');
const systemEl = document.getElementById('system');

let pollInterval;

// SUBMIT
form.onsubmit = async (e) => {
  e.preventDefault();

  const formData = new FormData(form);

  // 🔥 send parallel value
  const parallel = document.getElementById('parallel')?.value || 7;
  formData.append('parallel', parallel);

  await fetch('/run', {
    method: 'POST',
    body: formData
  });

  startPolling();
};

// POLLING
function startPolling() {

  if (pollInterval) clearInterval(pollInterval);

  pollInterval = setInterval(async () => {

    try {
      const res = await fetch('/status');
      const data = await res.json();

      // PROGRESS
      progressEl.innerText = data.running ? "Running..." : "Completed";

      // QUEUE
      queueEl.innerHTML = `
        <div><b>🟡 Running (${data.runningFiles.length})</b><br>
          ${(data.runningFiles || []).join('<br>') || 'None'}
        </div><br>

        <div><b>⏳ Pending</b><br>
          ${(data.pending || []).join('<br>') || 'None'}
        </div><br>

        <div><b>✅ Completed</b><br>
          ${(data.completed || []).join('<br>') || 'None'}
        </div>
      `;

      // LOGS
      logsEl.innerHTML = Object.entries(data.logs || {}).map(([file, logs]) => `
        <div style="margin-bottom:15px;">
          <h4>${file}</h4>
          <pre>${logs.join('\n')}</pre>
        </div>
      `).join('');

      // RESULTS
      resultsEl.innerHTML = data.results.map(r => `
        <div style="border:1px solid #ccc; padding:10px; margin:10px 0;">
          <b>${r.file}</b> - <span class="${r.status}">${r.status}</span><br>
          ⏱ ${r.duration}s<br>
          ✅ ${r.passed} | ❌ ${r.failed}<br>
          <a href="${r.report}" target="_blank">Open Report</a>
        </div>
      `).join('');

      if (!data.running) clearInterval(pollInterval);

    } catch (err) {
      console.error("Polling error:", err);
    }

  }, 1000);
}

// SYSTEM MONITOR (safe)
setInterval(async () => {
  try {
    const res = await fetch('/status');
    const data = await res.json();

    if (systemEl && data.system) {
      systemEl.innerHTML = `
        <b>🖥 System Monitor</b><br>
        CPU: ${data.system.cpuLoad}<br>
        Memory: ${data.system.freeMem}GB / ${data.system.totalMem}GB<br>
        Time: ${data.totalTime || 0}s<br>
        Active: ${(data.runningFiles || []).length}
      `;
    }

  } catch (e) {
    console.error("System monitor error:", e);
  }
}, 2000);