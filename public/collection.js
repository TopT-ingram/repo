const collectionFile = document.getElementById('collection-file');
const dataFile = document.getElementById('data-file');
const treeContainer = document.getElementById('tree-container');
const requestEditor = document.getElementById('request-editor');
const runResults = document.getElementById('run-results');
const resultsList = document.getElementById('results-list');
const toggleVariablesBtn = document.getElementById('toggle-variables');
const variablesPanel = document.getElementById('variables-panel');
const variablesToggleIcon = document.getElementById('variables-toggle-icon');
const variablesTitle = document.getElementById('variables-title');
const variablesTableBody = document.getElementById('variables-table-body');
const variablesEmptyState = document.getElementById('variables-empty-state');
const addVariableBtn = document.getElementById('add-variable');
const variableSearchInput = document.getElementById('variable-search');
const importVariablesBtn = document.getElementById('import-variables');
const exportVariablesBtn = document.getElementById('export-variables');
const variablesImportFile = document.getElementById('variables-import-file');

let allRequests = [];
let collectionData = null;
let selectedRequest = null;
const folderToRequests = new Map();
const requestToFolders = new Map();
let collectionVariables = [];
let variableIdCounter = 1;

function createVariable(overrides = {}) {
  return {
    id: `var-${Date.now()}-${variableIdCounter++}`,
    key: '',
    value: '',
    description: '',
    secret: false,
    showValue: false,
    ...overrides
  };
}

function setVariablesPanelExpanded(expanded) {
  if (!variablesPanel || !toggleVariablesBtn || !variablesToggleIcon) {
    return;
  }

  if (expanded) {
    variablesPanel.classList.remove('collapsed');
    toggleVariablesBtn.setAttribute('aria-expanded', 'true');
    variablesToggleIcon.textContent = '-';
  } else {
    variablesPanel.classList.add('collapsed');
    toggleVariablesBtn.setAttribute('aria-expanded', 'false');
    variablesToggleIcon.textContent = '+';
  }
}

function updateVariablesHeader() {
  if (variablesTitle) {
    variablesTitle.textContent = `Collection Variables (${collectionVariables.length})`;
  }
}

function getFilteredVariables() {
  const keyword = (variableSearchInput?.value || '').trim().toLowerCase();
  if (!keyword) {
    return collectionVariables;
  }

  return collectionVariables.filter((item) => {
    return [item.key, item.value, item.description].some((field) => String(field || '').toLowerCase().includes(keyword));
  });
}

function moveVariable(id, direction) {
  const index = collectionVariables.findIndex((item) => item.id === id);
  if (index < 0) {
    return;
  }

  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= collectionVariables.length) {
    return;
  }

  const temp = collectionVariables[index];
  collectionVariables[index] = collectionVariables[nextIndex];
  collectionVariables[nextIndex] = temp;
  renderVariablesTable();
}

function removeVariable(id) {
  collectionVariables = collectionVariables.filter((item) => item.id !== id);
  renderVariablesTable();
}

function addVariableRow(defaults = {}) {
  collectionVariables.push(createVariable(defaults));
  renderVariablesTable();

  setVariablesPanelExpanded(true);

  const lastId = collectionVariables[collectionVariables.length - 1]?.id;
  const nameInput = variablesTableBody.querySelector(`tr[data-id="${lastId}"] input[data-field="key"]`);
  if (nameInput) {
    nameInput.focus();
  }
}

function toCollectionVariablesPayload() {
  return collectionVariables
    .filter((item) => item.key && String(item.key).trim())
    .map((item) => ({
      key: String(item.key).trim(),
      value: item.value == null ? '' : String(item.value),
      description: item.description == null ? '' : String(item.description),
      type: item.secret ? 'secret' : 'string'
    }));
}

function parseCollectionVariables(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'object' && Array.isArray(value.variable)) {
    return value.variable;
  }

  if (typeof value === 'object') {
    return Object.entries(value).map(([key, val]) => ({ key, value: val }));
  }

  return [];
}

function loadCollectionVariablesFromCollection(collection) {
  const parsed = parseCollectionVariables(collection?.variable).map((item) => {
    const key = item?.key == null ? '' : String(item.key);
    const value = item?.value == null ? '' : String(item.value);
    const description = item?.description?.content || item?.description || '';
    const type = String(item?.type || '').toLowerCase();
    const secret = type === 'secret';

    return createVariable({
      key,
      value,
      description: String(description || ''),
      secret,
      showValue: !secret
    });
  });

  collectionVariables = parsed;
  renderVariablesTable();

  if (parsed.length > 0) {
    setVariablesPanelExpanded(true);
  }
}

function mergeImportedVariables(importedVars) {
  const incoming = parseCollectionVariables(importedVars).map((item) => ({
    key: item?.key == null ? '' : String(item.key),
    value: item?.value == null ? '' : String(item.value),
    description: item?.description?.content || item?.description || '',
    type: String(item?.type || '').toLowerCase()
  })).filter((item) => item.key.trim());

  if (!incoming.length) {
    return;
  }

  incoming.forEach((entry) => {
    const existing = collectionVariables.find((item) => String(item.key).trim() === entry.key.trim());
    if (existing) {
      existing.value = entry.value;
      existing.description = String(entry.description || '');
      existing.secret = entry.type === 'secret' ? true : existing.secret;
      if (!existing.secret) {
        existing.showValue = true;
      }
    } else {
      const secret = entry.type === 'secret';
      collectionVariables.push(createVariable({
        key: entry.key,
        value: entry.value,
        description: String(entry.description || ''),
        secret,
        showValue: !secret
      }));
    }
  });

  renderVariablesTable();
  setVariablesPanelExpanded(true);
}

function renderVariablesTable() {
  if (!variablesTableBody || !variablesEmptyState) {
    return;
  }

  const filtered = getFilteredVariables();
  variablesTableBody.innerHTML = '';

  filtered.forEach((item) => {
    const row = document.createElement('tr');
    row.dataset.id = item.id;

    const nameCell = document.createElement('td');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = item.key;
    nameInput.placeholder = 'Variable name';
    nameInput.dataset.field = 'key';
    nameInput.addEventListener('input', (event) => {
      item.key = event.target.value;
      updateVariablesHeader();
    });
    nameCell.appendChild(nameInput);

    const valueCell = document.createElement('td');
    const valueInput = document.createElement('input');
    valueInput.type = item.secret && !item.showValue ? 'password' : 'text';
    valueInput.value = item.value;
    valueInput.placeholder = 'Variable value';
    valueInput.dataset.field = 'value';
    valueInput.addEventListener('input', (event) => {
      item.value = event.target.value;
    });
    valueCell.appendChild(valueInput);

    const descriptionCell = document.createElement('td');
    const descriptionInput = document.createElement('input');
    descriptionInput.type = 'text';
    descriptionInput.value = item.description;
    descriptionInput.placeholder = 'Description';
    descriptionInput.dataset.field = 'description';
    descriptionInput.addEventListener('input', (event) => {
      item.description = event.target.value;
    });
    descriptionCell.appendChild(descriptionInput);

    const secretCell = document.createElement('td');
    const secretToggle = document.createElement('input');
    secretToggle.type = 'checkbox';
    secretToggle.checked = item.secret;
    secretToggle.title = 'Mask variable value';
    secretToggle.addEventListener('change', () => {
      item.secret = secretToggle.checked;
      if (!item.secret) {
        item.showValue = true;
      } else {
        item.showValue = false;
      }
      renderVariablesTable();
    });
    secretCell.appendChild(secretToggle);

    const actionsCell = document.createElement('td');
    const actions = document.createElement('div');
    actions.className = 'variables-actions';

    const showHideBtn = document.createElement('button');
    showHideBtn.type = 'button';
    showHideBtn.className = 'mini-btn';
    showHideBtn.textContent = item.secret && !item.showValue ? 'Show' : 'Hide';
    showHideBtn.addEventListener('click', () => {
      item.showValue = !item.showValue;
      renderVariablesTable();
    });

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'mini-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(item.value || '');
      } catch (error) {
        console.warn('Failed to copy variable value:', error);
      }
    });

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'mini-btn';
    upBtn.textContent = '↑';
    upBtn.addEventListener('click', () => moveVariable(item.id, -1));

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'mini-btn';
    downBtn.textContent = '↓';
    downBtn.addEventListener('click', () => moveVariable(item.id, 1));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'mini-btn danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => removeVariable(item.id));

    actions.appendChild(showHideBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(upBtn);
    actions.appendChild(downBtn);
    actions.appendChild(deleteBtn);
    actionsCell.appendChild(actions);

    [nameInput, valueInput, descriptionInput].forEach((input) => {
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          addVariableRow();
        }
      });
    });

    row.appendChild(nameCell);
    row.appendChild(valueCell);
    row.appendChild(descriptionCell);
    row.appendChild(secretCell);
    row.appendChild(actionsCell);
    variablesTableBody.appendChild(row);
  });

  if (!filtered.length) {
    variablesEmptyState.style.display = 'block';
    if (collectionVariables.length) {
      variablesEmptyState.innerHTML = 'No variables match your search.';
    } else {
      variablesEmptyState.innerHTML = 'No collection variables found.<br>Click "Add Variable" to create one.';
    }
  } else {
    variablesEmptyState.style.display = 'none';
  }

  updateVariablesHeader();
}

function ensureRequestAncestors(requestId, folderId) {
  const ancestors = requestToFolders.get(requestId) || [];
  ancestors.push(folderId);
  requestToFolders.set(requestId, ancestors);
}

function collectRequestIds(items, prefix = []) {
  let ids = [];

  items.forEach((item, idx) => {
    const id = [...prefix, idx].join('.');
    if (item.item && Array.isArray(item.item)) {
      ids = ids.concat(collectRequestIds(item.item, [...prefix, idx]));
    } else {
      ids.push(id);
    }
  });

  return ids;
}

function setFolderState(folderId) {
  const folderCheckbox = document.querySelector(`.folder-checkbox[data-id="${folderId}"]`);
  if (!folderCheckbox) {
    return;
  }

  const childRequestIds = folderToRequests.get(folderId) || [];
  const childCheckboxes = childRequestIds
    .map((id) => document.querySelector(`.request-checkbox[data-id="${id}"]`))
    .filter(Boolean);

  if (!childCheckboxes.length) {
    folderCheckbox.checked = false;
    folderCheckbox.indeterminate = false;
    return;
  }

  const checkedCount = childCheckboxes.filter((cb) => cb.checked).length;
  folderCheckbox.checked = checkedCount === childCheckboxes.length;
  folderCheckbox.indeterminate = checkedCount > 0 && checkedCount < childCheckboxes.length;
}

function refreshAllFolderStates() {
  const folderIds = Array.from(folderToRequests.keys()).sort((a, b) => b.split('.').length - a.split('.').length);
  folderIds.forEach(setFolderState);
}

function toggleFolder(folderId, checked) {
  const childRequestIds = folderToRequests.get(folderId) || [];
  childRequestIds.forEach((requestId) => {
    const requestCheckbox = document.querySelector(`.request-checkbox[data-id="${requestId}"]`);
    if (requestCheckbox) {
      requestCheckbox.checked = checked;
    }
  });
  refreshAllFolderStates();
}

function buildTree(items, container, prefix = []) {
  items.forEach((item, idx) => {
    const id = [...prefix, idx].join('.');
    const div = document.createElement('div');
    div.className = 'request-item';
    div.dataset.id = id;

    if (item.item && Array.isArray(item.item)) {
      div.className += ' folder-item';
      const folderCheckbox = document.createElement('input');
      folderCheckbox.type = 'checkbox';
      folderCheckbox.className = 'folder-checkbox';
      folderCheckbox.dataset.id = id;
      folderCheckbox.style.marginRight = '8px';

      const label = document.createElement('span');
      label.textContent = item.name || 'Folder';

      const childRequestIds = collectRequestIds(item.item, [...prefix, idx]);
      folderToRequests.set(id, childRequestIds);
      childRequestIds.forEach((requestId) => ensureRequestAncestors(requestId, id));

      div.appendChild(folderCheckbox);
      div.appendChild(label);
      container.appendChild(div);

      folderCheckbox.addEventListener('change', () => {
        toggleFolder(id, folderCheckbox.checked);
      });

      const subContainer = document.createElement('div');
      subContainer.style.marginLeft = '20px';
      container.appendChild(subContainer);
      buildTree(item.item, subContainer, [...prefix, idx]);
    } else {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'request-checkbox';
      checkbox.dataset.id = id;
      checkbox.style.marginRight = '8px';

      const text = document.createElement('span');
      text.textContent = `${item.request?.method || 'GET'}: ${item.name}`;
      text.style.cursor = 'pointer';

      div.appendChild(checkbox);
      div.appendChild(text);
      container.appendChild(div);

      text.addEventListener('click', () => {
        selectSingle(id, item);
      });

      checkbox.addEventListener('change', () => {
        const ancestorFolders = requestToFolders.get(id) || [];
        ancestorFolders.forEach(setFolderState);
      });
    }
  });
}

function selectSingle(id, item) {
  document.querySelectorAll('.request-item').forEach(el => el.classList.remove('selected'));
  document.querySelector(`[data-id="${id}"]`).classList.add('selected');
  selectedRequest = { id, item };
  requestEditor.classList.add('active');
  runResults.classList.remove('active');
  populateEditor(item);
}

function populateEditor(item) {
  const req = item.request || {};

  // Method and URL - assuming we have inputs for them
  if (document.getElementById('method')) document.getElementById('method').value = req.method || 'GET';
  if (document.getElementById('url')) document.getElementById('url').value = req.url?.raw || '';

  // Params
  populateParams(req.url?.query || [], 'query-params');
  populateParams(req.url?.variable || [], 'path-vars');

  // Auth
  const auth = req.auth || {};
  document.getElementById('auth-type').value = auth.type || 'none';
  populateAuthFields(auth);

  // Headers
  populateHeaders(req.header || []);

  // Body
  const body = req.body || {};
  document.getElementById('body-type').value = body.mode || 'none';
  populateBody(body);

  // Scripts
  document.getElementById('pre-request-script').value = item.event?.find(e => e.listen === 'prerequest')?.script?.exec?.join('\n') || '';
  document.getElementById('tests-script').value = item.event?.find(e => e.listen === 'test')?.script?.exec?.join('\n') || '';
}

function populateParams(params, containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  params.forEach(param => {
    const row = document.createElement('div');
    row.innerHTML = `<input type="text" value="${param.key || ''}" placeholder="Key"> <input type="text" value="${param.value || ''}" placeholder="Value"> <input type="checkbox" ${param.disabled ? 'checked' : ''}> Disabled`;
    container.appendChild(row);
  });
}

function populateAuthFields(auth) {
  const fields = document.getElementById('auth-fields');
  fields.innerHTML = '';
  if (auth.type === 'basic') {
    fields.innerHTML = '<input type="text" placeholder="Username"> <input type="password" placeholder="Password">';
  } else if (auth.type === 'bearer') {
    fields.innerHTML = '<input type="text" placeholder="Token">';
  } else if (auth.type === 'apikey') {
    fields.innerHTML = '<input type="text" placeholder="Key"> <input type="text" placeholder="Value"> <select><option value="header">Header</option><option value="query">Query</option></select>';
  }
}

function populateHeaders(headers) {
  const list = document.getElementById('headers-list');
  list.innerHTML = '';
  headers.forEach(header => {
    const row = document.createElement('div');
    row.innerHTML = `<input type="text" value="${header.key || ''}" placeholder="Key"> <input type="text" value="${header.value || ''}" placeholder="Value"> <input type="checkbox" ${header.disabled ? 'checked' : ''}> Disabled <button>Remove</button>`;
    list.appendChild(row);
  });
}

function populateBody(body) {
  const content = document.getElementById('body-content');
  content.innerHTML = '';
  if (body.mode === 'raw') {
    content.innerHTML = `<textarea rows="10" style="width:100%;">${body.raw || ''}</textarea>`;
  } else if (body.mode === 'formdata' || body.mode === 'urlencoded') {
    const items = body[body.mode] || [];
    items.forEach(item => {
      const row = document.createElement('div');
      row.innerHTML = `<input type="text" value="${item.key || ''}" placeholder="Key"> <input type="text" value="${item.value || ''}" placeholder="Value"> <input type="checkbox" ${item.disabled ? 'checked' : ''}> Disabled`;
      content.appendChild(row);
    });
  }
}

collectionFile.addEventListener('change', async () => {
  const file = collectionFile.files[0];
  if (!file) return;

  const text = await file.text();
  try {
    collectionData = JSON.parse(text);
    allRequests = traverseCollection(collectionData.item || []);
    folderToRequests.clear();
    requestToFolders.clear();
    treeContainer.innerHTML = '';
    buildTree(collectionData.item || [], treeContainer);
    refreshAllFolderStates();
    loadCollectionVariablesFromCollection(collectionData);
  } catch (error) {
    alert('Invalid JSON collection');
  }
});

function traverseCollection(items, prefix = []) {
  let result = [];
  items.forEach((item, idx) => {
    const id = [...prefix, idx].join('.');
    if (item.item && Array.isArray(item.item)) {
      result = result.concat(traverseCollection(item.item, [...prefix, idx]));
    } else {
      result.push({ id, item });
    }
  });
  return result;
}

function getSelectedIds() {
  return Array.from(document.querySelectorAll('.request-checkbox:checked')).map(cb => cb.dataset.id);
}

document.getElementById('run-selected').addEventListener('click', async () => {
  const selectedIds = getSelectedIds();
  if (!selectedIds.length) {
    alert('Please select at least one request');
    return;
  }

  const formData = new FormData();
  formData.append('collection', collectionFile.files[0]);
  if (dataFile.files[0]) formData.append('dataFile', dataFile.files[0]);
  formData.append('selectedIds', JSON.stringify(selectedIds));
  formData.append('collectionVariables', JSON.stringify(toCollectionVariablesPayload()));

  requestEditor.classList.remove('active');
  runResults.classList.add('active');
  resultsList.innerHTML = 'Running...';

  try {
    const response = await fetch('/run-selected', { method: 'POST', body: formData });
    const data = await response.json();

    if (!response.ok) {
      resultsList.innerHTML = `Error: ${data.error}`;
      return;
    }

    // Generate manifest/extent report
    const hasIterationData = dataFile.files[0];
    const report = generateManifestReport(selectedIds, data.requestResults, hasIterationData, data.reportUrl, {
      error: data.error,
      duration: data.duration,
      reportExists: data.reportExists,
      failureDetails: data.failureDetails
    });
    
    resultsList.innerHTML = report.html;
    
    // Store report data for download
    resultsList.dataset.reportData = JSON.stringify(report.data);

  } catch (err) {
    resultsList.innerHTML = `Error: ${err.message}`;
  }
});

// Generate Manifest/Extent Report
function generateManifestReport(selectedIds, results, hasIterationData, reportUrl, runMeta = {}) {
  const totalRequests = selectedIds.length;
  const successCount = results.filter(r => r.code >= 200 && r.code < 300).length;
  const failureCount = results.filter(r => r.code >= 400).length;
  const warningCount = results.filter(r => r.code >= 300 && r.code < 400).length;

  const reportData = {
    timestamp: new Date().toISOString(),
    totalRequests: totalRequests,
    successCount: successCount,
    failureCount: failureCount,
    warningCount: warningCount,
    hasIterationData: hasIterationData,
    selectedRequestIds: selectedIds,
    results: results
  };

  let successColor = successCount === totalRequests ? '#4CAF50' : '#ff9800';
  if (failureCount > 0) successColor = '#f44336';

  let reportButtonHtml = '';
  if (reportUrl) {
    reportButtonHtml = `
      <div style="margin-top: 15px;">
        <a href="${reportUrl}" target="_blank" class="download-report-btn" style="display: inline-block; text-decoration: none; margin-right: 10px;">
          📊 View Newman Extent Report
        </a>
      </div>
    `;
  }

  const errorSummaryHtml = runMeta.error
    ? `<div style="margin-top:10px; padding:10px; border:1px solid #fecaca; background:#fff1f2; border-radius:6px; color:#991b1b;"><strong>Run Error:</strong> ${runMeta.error}</div>`
    : '';

  const reportMissingHtml = runMeta.reportExists === false
    ? '<div style="margin-top:10px; padding:10px; border:1px solid #fde68a; background:#fffbeb; border-radius:6px; color:#92400e;"><strong>Report note:</strong> detailed report was not generated; fallback report was created.</div>'
    : '';

  const failureDetails = Array.isArray(runMeta.failureDetails) ? runMeta.failureDetails : [];
  const failureDetailsHtml = failureDetails.length
    ? `<div style="margin-top:10px; padding:10px; border:1px solid #e2e8f0; background:#f8fafc; border-radius:6px;"><strong>Top Failure Details</strong><ul style="margin:8px 0 0 18px; padding:0;">${failureDetails.map((f) => `<li><strong>${f.parent ? `${f.parent} / ` : ''}${f.source}</strong>: ${f.error}</li>`).join('')}</ul></div>`
    : '';

  const html = `
    <div class="report-section">
      <h4>Execution Report</h4>
      <div class="report-summary">
        <div class="report-stat">
          <label>Total Requests</label>
          <div class="value">${totalRequests}</div>
        </div>
        <div class="report-stat">
          <label>Successful (2xx)</label>
          <div class="value" style="color: #4CAF50;">${successCount}</div>
        </div>
        <div class="report-stat ${failureCount > 0 ? 'failed' : ''}">
          <label>Failed (4xx+)</label>
          <div class="value" style="color: ${failureCount > 0 ? '#f44336' : '#4CAF50'};">${failureCount}</div>
        </div>
        <div class="report-stat ${warningCount > 0 ? 'warning' : ''}">
          <label>Redirects (3xx)</label>
          <div class="value" style="color: ${warningCount > 0 ? '#ff9800' : '#4CAF50'};">${warningCount}</div>
        </div>
      </div>
      <p><strong>Iteration Data:</strong> ${hasIterationData ? '✓ Loaded' : '✗ Not provided'}</p>
      <p><strong>Execution Time:</strong> ${new Date().toLocaleString()}</p>
      ${runMeta.duration ? `<p><strong>Duration:</strong> ${runMeta.duration}s</p>` : ''}
      <button class="download-report-btn" onclick="downloadReport()">📥 Download JSON Report</button>
      ${reportButtonHtml}
      ${errorSummaryHtml}
      ${reportMissingHtml}
      ${failureDetailsHtml}
    </div>
  `;

  let resultsHtml = html + '<h3>Request Results</h3>';
  
  results.forEach((result, index) => {
    const statusColor = result.code >= 200 && result.code < 300 ? '#4CAF50' : 
                       result.code >= 400 ? '#f44336' : '#ff9800';
    
    resultsHtml += `
      <div class="response-view">
        <h4 style="color: ${statusColor};">
          ${index + 1}. ${result.method} ${result.name}
        </h4>
        <p><strong>URL:</strong> ${result.url}</p>
        <p><strong>Status:</strong> <span style="color: ${statusColor}; font-weight: bold;">${result.status} (${result.code})</span></p>
        <label><strong>Response Body:</strong></label><br>
        <textarea class="response-textarea" readonly>${result.body}</textarea>
      </div>
    `;
  });

  return {
    html: resultsHtml,
    data: reportData
  };
}

// Download report function
function downloadReport() {
  const resultsDiv = document.getElementById('results-list');
  const reportData = JSON.parse(resultsDiv.dataset.reportData || '{}');
  
  const element = document.createElement('a');
  element.setAttribute('href', 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(reportData, null, 2)));
  element.setAttribute('download', `postman-report-${new Date().getTime()}.json`);
  element.style.display = 'none';
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
}

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab + '-tab').classList.add('active');
  });
});

document.getElementById('add-header').addEventListener('click', () => {
  const list = document.getElementById('headers-list');
  const row = document.createElement('div');
  row.innerHTML = `<input type="text" placeholder="Key"> <input type="text" placeholder="Value"> <input type="checkbox"> Disabled <button>Remove</button>`;
  list.appendChild(row);
});

document.getElementById('auth-type').addEventListener('change', () => {
  const auth = { type: document.getElementById('auth-type').value };
  populateAuthFields(auth);
});

document.getElementById('send-request').addEventListener('click', async () => {
  if (!selectedRequest) return;

  const formData = new FormData();
  formData.append('collection', collectionFile.files[0]);
  if (dataFile.files[0]) formData.append('dataFile', dataFile.files[0]);
  formData.append('selectedIds', JSON.stringify([selectedRequest.id]));
  formData.append('collectionVariables', JSON.stringify(toCollectionVariablesPayload()));

  requestEditor.classList.remove('active');
  runResults.classList.add('active');
  resultsList.innerHTML = 'Running...';

  try {
    const response = await fetch('/run-selected', { method: 'POST', body: formData });
    const data = await response.json();

    if (!response.ok) {
      resultsList.innerHTML = `Error: ${data.error}`;
      return;
    }

    // Generate manifest/extent report for single request
    const hasIterationData = dataFile.files[0];
    const report = generateManifestReport([selectedRequest.id], data.requestResults, hasIterationData, data.reportUrl, {
      error: data.error,
      duration: data.duration,
      reportExists: data.reportExists,
      failureDetails: data.failureDetails
    });
    
    resultsList.innerHTML = report.html;
    resultsList.dataset.reportData = JSON.stringify(report.data);

  } catch (err) {
    resultsList.innerHTML = `Error: ${err.message}`;
  }
});

// Select All / Unselect All
document.getElementById('select-all').addEventListener('click', () => {
  document.querySelectorAll('.request-checkbox').forEach(cb => cb.checked = true);
  refreshAllFolderStates();
});

document.getElementById('unselect-all').addEventListener('click', () => {
  document.querySelectorAll('.request-checkbox').forEach(cb => cb.checked = false);
  refreshAllFolderStates();
});

if (toggleVariablesBtn) {
  toggleVariablesBtn.addEventListener('click', () => {
    const expanded = toggleVariablesBtn.getAttribute('aria-expanded') === 'true';
    setVariablesPanelExpanded(!expanded);
  });
}

if (addVariableBtn) {
  addVariableBtn.addEventListener('click', () => addVariableRow());
}

if (variableSearchInput) {
  variableSearchInput.addEventListener('input', () => renderVariablesTable());
}

if (importVariablesBtn && variablesImportFile) {
  importVariablesBtn.addEventListener('click', () => {
    variablesImportFile.click();
  });

  variablesImportFile.addEventListener('change', async () => {
    const file = variablesImportFile.files && variablesImportFile.files[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      mergeImportedVariables(parsed);
    } catch (error) {
      alert('Invalid variable JSON file.');
    } finally {
      variablesImportFile.value = '';
    }
  });
}

if (exportVariablesBtn) {
  exportVariablesBtn.addEventListener('click', () => {
    const exportPayload = toCollectionVariablesPayload();
    const data = JSON.stringify(exportPayload, null, 2);
    const anchor = document.createElement('a');
    anchor.href = `data:application/json;charset=utf-8,${encodeURIComponent(data)}`;
    anchor.download = 'collection-variables.json';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  });
}

setVariablesPanelExpanded(false);
renderVariablesTable();
