const express = require('express');
const multer = require('multer');
const newman = require('newman');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const upload = multer({ dest: 'uploads/' });

const NEWMAN_REQUEST_TIMEOUT = 120000;
const NEWMAN_SCRIPT_TIMEOUT = 300000;
const NEWMAN_RUN_TIMEOUT = 900000;

app.use(express.static('public'));
app.use('/reports', express.static(path.join(__dirname, 'reports')));
app.use('/vendor/crypto-js', express.static(path.join(__dirname, 'node_modules', 'crypto-js')));
app.use(express.urlencoded({ extended: true }));

let progress = {
  running: false,
  logs: {},
  results: [],
  pending: [],
  completed: [],
  runningFiles: [],
  system: {},
  totalTime: 0
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getReportBaseName(originalName) {
  return path.parse(originalName).name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_');
}

function createFallbackReport(reportPath, details) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(details.fileName)} Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; line-height: 1.5; background: #f7f7f9; color: #222; }
    .card { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 20px; max-width: 900px; }
    .meta { margin: 8px 0; }
    .status { font-weight: bold; text-transform: capitalize; }
    .success { color: #1a7f37; }
    .failed { color: #c62828; }
    pre { white-space: pre-wrap; word-break: break-word; background: #111827; color: #f9fafb; padding: 16px; border-radius: 6px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(details.fileName)} Report</h1>
    <div class="meta">Status: <span class="status ${escapeHtml(details.status)}">${escapeHtml(details.status)}</span></div>
    <div class="meta">Duration: ${escapeHtml(details.duration)}s</div>
    <div class="meta">Passed: ${escapeHtml(details.passed)}</div>
    <div class="meta">Failed: ${escapeHtml(details.failed)}</div>
    <div class="meta">Total: ${escapeHtml(details.total)}</div>
    <h2>Notes</h2>
    <pre>${escapeHtml(details.message)}</pre>
  </div>
</body>
</html>`;

  fs.writeFileSync(reportPath, html, 'utf-8');
}

function getAssertionStats(summary) {
  const assertions = summary?.run?.stats?.assertions || {};
  const failures = summary?.run?.failures?.length || 0;
  const total = Number(assertions.total || summary?.run?.stats?.tests?.total || 0);
  const failed = Number(assertions.failed || failures || 0);

  return {
    total,
    failed,
    passed: Math.max(total - failed, 0)
  };
}

function safeDeleteFile(filePath) {
  if (!filePath) {
    return;
  }

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error(`Failed to delete temp file: ${filePath}`, error.message);
  }
}

function cleanupUploadedFiles(files = []) {
  files.forEach(file => safeDeleteFile(file?.path));
}

// SYSTEM STATS
function getSystemStats() {
  return {
    cpuLoad: os.loadavg()[0].toFixed(2),
    totalMem: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2),
    freeMem: (os.freemem() / 1024 / 1024 / 1024).toFixed(2)
  };
}

// STATUS
app.get('/status', (req, res) => {
  progress.system = getSystemStats();
  res.json(progress);
});

// RUN
app.post('/run', upload.fields([
  { name: 'collection', maxCount: 1 },
  { name: 'dataFiles', maxCount: 100 }
]), (req, res) => {

  try {
    const startAll = Date.now();

    if (!req.files || !req.files['collection'] || !req.files['dataFiles']) {
      return res.status(400).json({ error: "Missing files" });
    }

    const collectionPath = req.files['collection'][0].path;
    const dataFiles = req.files['dataFiles'];

    if (!fs.existsSync('reports')) fs.mkdirSync('reports');

    // RESET STATE
    progress = {
      running: true,
      logs: {},
      results: [],
      pending: dataFiles.map(f => f.originalname),
      completed: [],
      runningFiles: [],
      system: {},
      totalTime: 0
    };

    const collectionData = JSON.parse(fs.readFileSync(collectionPath, 'utf-8'));
    safeDeleteFile(collectionPath);

    // 🔥 Dynamic parallel control
    const MAX_PARALLEL = Math.min(parseInt(req.body.parallel) || 7, 20);

    let index = 0;
    let active = 0;

    const runParallel = () => {
      while (active < MAX_PARALLEL && index < dataFiles.length) {

        const file = dataFiles[index++];
        active++;

        const start = Date.now();
        const name = getReportBaseName(file.originalname);
        const reportPath = path.join(__dirname, 'reports', `${name}.html`);

        if (fs.existsSync(reportPath)) {
          fs.unlinkSync(reportPath);
        }

        progress.runningFiles.push(file.originalname);
        progress.logs[file.originalname] = [`🚀 Starting ${file.originalname}`];

        newman.run({
          collection: collectionData,
          iterationData: file.path,
          timeoutRequest: NEWMAN_REQUEST_TIMEOUT,
          timeoutScript: NEWMAN_SCRIPT_TIMEOUT,
          timeout: NEWMAN_RUN_TIMEOUT,
          reporters: ['cli', 'htmlextra'],
          reporter: {
            htmlextra: {
              export: reportPath
            }
          }
        })
        .on('request', (err, args) => {
          if (!err && progress.logs[file.originalname].length < 200) {
            progress.logs[file.originalname].push(`→ ${args.item.name}`);
          }
        })
        .on('done', (err, summary) => {

          active--;

          const duration = ((Date.now() - start) / 1000).toFixed(2);

          const failures = summary?.run?.failures?.length || 0;
          const { total, failed, passed } = getAssertionStats(summary);
          const status = err || failed > 0 || failures > 0 ? 'failed' : 'success';
          const fallbackMessage = err
            ? err.message
            : 'The detailed Newman HTML report was not generated, so this fallback summary was created instead.';

          if (!fs.existsSync(reportPath)) {
            createFallbackReport(reportPath, {
              fileName: file.originalname,
              status,
              duration,
              passed,
              failed,
              total,
              message: fallbackMessage
            });
          }

          // UPDATE STATE
          progress.runningFiles = progress.runningFiles.filter(f => f !== file.originalname);
          progress.completed.push(file.originalname);
          progress.pending = progress.pending.filter(f => f !== file.originalname);

          progress.results.push({
            file: file.originalname,
            status,
            report: `/reports/${name}.html`,
            passed,
            failed,
            total,
            duration
          });

          progress.logs[file.originalname].push(`⏱ ${duration}s`);
          if (err) {
            progress.logs[file.originalname].push(`❌ ${err.message}`);
          }
          if (failures > 0) {
            progress.logs[file.originalname].push(`⚠ Failure events: ${failures}`);
          }
          if (!summary) {
            progress.logs[file.originalname].push('⚠ Newman finished without a summary.');
          }
          if (fs.existsSync(reportPath)) {
            progress.logs[file.originalname].push(`📝 Report ready: ${name}.html`);
          }
          progress.logs[file.originalname].push(`✅ Finished (${passed}/${total})`);
          safeDeleteFile(file.path);

          // 🔥 stagger
          setTimeout(() => {
            if (index < dataFiles.length) {
              runParallel();
            } else if (active === 0) {
              progress.running = false;
              progress.totalTime = ((Date.now() - startAll) / 1000).toFixed(2);
            }
          }, 200);
        });
      }
    };

    runParallel();
    res.json({ message: 'Started' });

  } catch (err) {
    cleanupUploadedFiles([
      ...(req.files?.collection || []),
      ...(req.files?.dataFiles || [])
    ]);
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => {
  console.log('Running at http://localhost:3000');
});