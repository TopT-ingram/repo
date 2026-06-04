const express = require('express');
const multer = require('multer');
const newman = require('newman');
const path = require('path');
const fs = require('fs');
const os = require('os');
const readXlsxFile = require('read-excel-file/node');
const { parse: parseCsv } = require('csv-parse/sync');

const app = express();
const upload = multer({ dest: 'uploads/' });

const NEWMAN_REQUEST_TIMEOUT = parseInt(process.env.NEWMAN_REQUEST_TIMEOUT || '300000', 10);
const NEWMAN_SCRIPT_TIMEOUT = parseInt(process.env.NEWMAN_SCRIPT_TIMEOUT || '1800000', 10);
const NEWMAN_RUN_TIMEOUT = parseInt(process.env.NEWMAN_RUN_TIMEOUT || '3600000', 10);

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

function flattenCollectionItems(items, prefix = []) {
  const result = [];

  items.forEach((item, idx) => {
    const id = [...prefix, idx].join('.');

    if (item.item && Array.isArray(item.item)) {
      result.push({
        id,
        name: item.name || 'Folder',
        type: 'folder',
        item
      });
      result.push(...flattenCollectionItems(item.item, [...prefix, idx]));
    } else {
      result.push({
        id,
        name: item.name || 'Request',
        type: 'request',
        method: item.request?.method || 'GET',
        url: (item.request?.url && (item.request.url.raw || item.request.url)) || '',
        item
      });
    }
  });

  return result;
}

function buildSubsetItems(items, selectedIds, prefix = []) {
  const filtered = [];

  items.forEach((item, idx) => {
    const id = [...prefix, idx].join('.');

    if (item.item && Array.isArray(item.item)) {
      const children = buildSubsetItems(item.item, selectedIds, [...prefix, idx]);
      if (children.length > 0) {
        const copy = { ...item, item: children };
        filtered.push(copy);
      }
    } else {
      if (selectedIds.includes(id)) {
        filtered.push(item);
      }
    }
  });

  return filtered;
}

function normalizeCollectionVariable(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const key = item.key == null ? '' : String(item.key).trim();
  if (!key) {
    return null;
  }

  const normalized = {
    ...item,
    key,
    value: item.value == null ? '' : String(item.value)
  };

  if (item.description != null) {
    normalized.description = String(item.description);
  }

  if (item.type != null) {
    normalized.type = String(item.type);
  }

  return normalized;
}

function mergeCollectionVariables(baseVariables = [], overrideVariables = []) {
  const result = [];
  const indexByKey = new Map();

  baseVariables.forEach((item) => {
    const normalized = normalizeCollectionVariable(item);
    if (!normalized) {
      return;
    }

    indexByKey.set(normalized.key, result.length);
    result.push(normalized);
  });

  overrideVariables.forEach((item) => {
    const normalized = normalizeCollectionVariable(item);
    if (!normalized) {
      return;
    }

    if (indexByKey.has(normalized.key)) {
      const idx = indexByKey.get(normalized.key);
      result[idx] = {
        ...result[idx],
        ...normalized
      };
    } else {
      indexByKey.set(normalized.key, result.length);
      result.push(normalized);
    }
  });

  return result;
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

function getRunErrorMessage(err) {
  if (!err) {
    return '';
  }

  const rawMessage = String(err.message || err);
  const lowered = rawMessage.toLowerCase();

  if (lowered.includes('callback timed out') || lowered.includes('timeout')) {
    return `${rawMessage}\n\nLikely cause: execution exceeded Newman timeout limits (request/script/run) or an async callback in scripts never completed. Current run timeout is ${NEWMAN_RUN_TIMEOUT}ms.`;
  }

  return rawMessage;
}

function extractFailureDetails(summary, limit = 30) {
  const failures = summary?.run?.failures;
  if (!Array.isArray(failures) || failures.length === 0) {
    return [];
  }

  return failures.slice(0, limit).map((failure) => ({
    source: failure?.source?.name || 'Unknown source',
    parent: failure?.parent?.name || '',
    error: failure?.error?.message || String(failure?.error || 'Unknown error'),
    at: failure?.at || ''
  }));
}

async function parseIterationData(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.xlsx') {
    const rows = await readXlsxFile(filePath);

    if (rows.length === 0) {
      return [];
    }

    const headers = rows[0].map((header) => String(header ?? '').trim());
    return rows.slice(1)
      .filter((values) => values.some((value) => value !== undefined && value !== null && String(value).trim() !== ''))
      .map((values) => {
        const item = {};
        headers.forEach((header, idx) => {
          if (header) {
            item[header] = values[idx] ?? '';
          }
        });
        return item;
      });
  }

  const fileText = fs.readFileSync(filePath, 'utf-8').trim();

  if (ext === '.csv') {
    return parseCsv(fileText, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
  }

  if (ext === '.json') {
    return JSON.parse(fileText);
  }

  if (ext === '.xls') {
    throw new Error('Unsupported iteration data format (.xls). Please use .xlsx, .csv, or .json.');
  }

  // Best-effort fallback: try JSON then CSV.
  try {
    return JSON.parse(fileText);
  } catch (jsonError) {
    try {
      return parseCsv(fileText, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });
    } catch (xlsError) {
      throw new Error(`Unsupported iteration data format${ext ? ` (${ext})` : ''}. JSON error: ${jsonError.message}; CSV error: ${xlsError.message}`);
    }
  }
}

function safeDeleteFile(filePath) {
  if (!filePath) {
    return;
  }

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.warn(`safeDeleteFile failed for ${filePath}:`, err.message);
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
          insecure: true,
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
            ? getRunErrorMessage(err)
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
            progress.logs[file.originalname].push(`❌ ${getRunErrorMessage(err)}`);
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

app.post('/run-selected', upload.fields([
  { name: 'collection', maxCount: 1 },
  { name: 'dataFile', maxCount: 1 }
]), async (req, res) => {
  try {
    if (!req.files || !req.files['collection']) {
      return res.status(400).json({ error: 'Collection required' });
    }

    const selectedIds = req.body.selectedIds ? JSON.parse(req.body.selectedIds) : [];
    if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
      return res.status(400).json({ error: 'No request IDs selected' });
    }

    let runtimeCollectionVariables = [];
    if (req.body.collectionVariables) {
      runtimeCollectionVariables = JSON.parse(req.body.collectionVariables);
      if (!Array.isArray(runtimeCollectionVariables)) {
        return res.status(400).json({ error: 'collectionVariables must be an array' });
      }
    }

    const collectionPath = req.files['collection'][0].path;
    const collectionData = JSON.parse(fs.readFileSync(collectionPath, 'utf-8'));
    safeDeleteFile(collectionPath);

    const subsetItems = buildSubsetItems(collectionData.item || [], selectedIds);
    if (subsetItems.length === 0) {
      return res.status(400).json({ error: 'No matching selected requests found in collection' });
    }

    const runCollection = {
      ...collectionData,
      item: subsetItems
    };
    runCollection.variable = mergeCollectionVariables(collectionData.variable || [], runtimeCollectionVariables);

    let iterationDataPath;
    let iterationData;
    if (req.files['dataFile'] && req.files['dataFile'][0]) {
      iterationDataPath = req.files['dataFile'][0].path;
      iterationData = await parseIterationData(iterationDataPath);
    }

    // Create reports directory if it doesn't exist
    if (!fs.existsSync('reports')) fs.mkdirSync('reports');

    // Generate unique report name
    const timestamp = Date.now();
    const reportDir = path.join(__dirname, 'reports', `report-${timestamp}`);
    const reportPath = path.join(reportDir, 'index.html');
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }
    const runStart = Date.now();

    const requestResults = [];

    newman.run({
      collection: runCollection,
      iterationData: iterationData,
      timeoutRequest: NEWMAN_REQUEST_TIMEOUT,
      timeoutScript: NEWMAN_SCRIPT_TIMEOUT,
      timeout: NEWMAN_RUN_TIMEOUT,
      insecure: true,
      reporters: ['cli', 'htmlextra'],
      reporter: {
        htmlextra: {
          export: reportPath
        }
      }
    })
    .on('request', (err, args) => {
      if (err) {
        return;
      }

      const responseBody = args.response?.stream
        ? args.response.stream.toString('utf8')
        : args.response?.body || '';

      requestResults.push({
        name: args.item?.name || 'Unknown',
        method: args.request?.method || 'N/A',
        url: args.request?.url && args.request.url.toString ? args.request.url.toString() : '',
        status: args.response?.status || 'N/A',
        code: args.response?.code || 'N/A',
        body: typeof responseBody === 'string' ? responseBody.substring(0, 16000) : '',
        assertionCount: args.response ? args.response.responseTime || 0 : 0
      });
    })
    .on('done', (err, summary) => {
      if (iterationDataPath) safeDeleteFile(iterationDataPath);

      const { total, failed, passed } = getAssertionStats(summary);
      const status = err || failed > 0 ? 'failed' : 'success';
      const reportUrl = `/reports/report-${timestamp}/index.html`;
      const duration = ((Date.now() - runStart) / 1000).toFixed(2);
      const failureDetails = extractFailureDetails(summary);

      if (!fs.existsSync(reportPath)) {
        const fallbackMessage = err
          ? getRunErrorMessage(err)
          : `Detailed Newman HTML report was not generated. Assertions failed: ${failed}/${total}.`;

        createFallbackReport(reportPath, {
          fileName: `selected-requests-${timestamp}`,
          status,
          duration,
          passed,
          failed,
          total,
          message: fallbackMessage
        });
      }

      const reportExists = fs.existsSync(reportPath);

      return res.json({
        status,
        total,
        failed,
        passed,
        duration,
        requestResults,
        reportUrl,
        reportExists,
        failureDetails,
        error: getRunErrorMessage(err)
      });
    });

  } catch (err) {
    cleanupUploadedFiles([
      ...(req.files?.collection || []),
      ...(req.files?.dataFile || [])
    ]);
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => {
  console.log('Running at http://localhost:3000');
});