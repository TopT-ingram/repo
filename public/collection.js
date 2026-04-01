const collectionFile = document.getElementById('collection-file');
const dataFile = document.getElementById('data-file');
const treeContainer = document.getElementById('tree-container');
const requestEditor = document.getElementById('request-editor');
const runResults = document.getElementById('run-results');
const resultsList = document.getElementById('results-list');

let allRequests = [];
let collectionData = null;
let selectedRequest = null;

function buildTree(items, container, prefix = []) {
  items.forEach((item, idx) => {
    const id = [...prefix, idx].join('.');
    const div = document.createElement('div');
    div.className = 'request-item';
    div.dataset.id = id;

    if (item.item && Array.isArray(item.item)) {
      div.className += ' folder-item';
      div.textContent = item.name || 'Folder';
      container.appendChild(div);
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
        // Optional: if checked, select for editing too, but for now, separate
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
    treeContainer.innerHTML = '';
    buildTree(collectionData.item || [], treeContainer);
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

    resultsList.innerHTML = '';
    data.requestResults.forEach(result => {
      const div = document.createElement('div');
      div.className = 'response-view';
      div.innerHTML = `
        <h4>${result.method} ${result.name}</h4>
        <p><strong>URL:</strong> ${result.url}</p>
        <p><strong>Status:</strong> ${result.status} (${result.code})</p>
        <label><strong>Response Body:</strong></label><br>
        <textarea class="response-textarea" readonly>${result.body}</textarea>
      `;
      resultsList.appendChild(div);
    });

  } catch (err) {
    resultsList.innerHTML = `Error: ${err.message}`;
  }
});

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

    resultsList.innerHTML = '';
    data.requestResults.forEach(result => {
      const div = document.createElement('div');
      div.className = 'response-view';
      div.innerHTML = `
        <h4>${result.method} ${result.name}</h4>
        <p><strong>URL:</strong> ${result.url}</p>
        <p><strong>Status:</strong> ${result.status} (${result.code})</p>
        <label><strong>Response Body:</strong></label><br>
        <textarea class="response-textarea" readonly>${result.body}</textarea>
      `;
      resultsList.appendChild(div);
    });

  } catch (err) {
    resultsList.innerHTML = `Error: ${err.message}`;
  }
});

// Select All / Unselect All
document.getElementById('select-all').addEventListener('click', () => {
  document.querySelectorAll('.request-checkbox').forEach(cb => cb.checked = true);
});

document.getElementById('unselect-all').addEventListener('click', () => {
  document.querySelectorAll('.request-checkbox').forEach(cb => cb.checked = false);
});
