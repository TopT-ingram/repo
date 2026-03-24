const sectionConfig = {
  encrypt: {
    fieldsId: 'encryptFields',
    passphraseId: 'encryptPassphrase',
    resultId: 'encryptCombinedResult',
    emptyMessage: 'Your encrypted values will appear here.',
    placeholder: 'Enter plain text to encrypt',
    actionLabel: 'Encrypt'
  },
  decrypt: {
    fieldsId: 'decryptFields',
    passphraseId: 'decryptPassphrase',
    resultId: 'decryptCombinedResult',
    emptyMessage: 'Your decrypted values will appear here.',
    placeholder: 'Enter encrypted text to decrypt',
    actionLabel: 'Decrypt'
  }
};

function getSectionElements(mode) {
  const config = sectionConfig[mode];
  return {
    config,
    fields: document.getElementById(config.fieldsId),
    passphrase: document.getElementById(config.passphraseId),
    result: document.getElementById(config.resultId)
  };
}

function buildRow(mode, rowNumber) {
  const { config } = getSectionElements(mode);
  const row = document.createElement('div');
  row.className = 'field-row';
  row.innerHTML = `
    <div class="field-row-header">
      <span class="field-row-title">${config.actionLabel} Value ${rowNumber}</span>
      <button type="button" class="icon-btn remove-btn" aria-label="Remove row">×</button>
    </div>
    <label><strong>Variable Name</strong></label>
    <input type="text" class="field-label" placeholder="username">
    <label><strong>${config.actionLabel === 'Encrypt' ? 'Plain Text' : 'Encrypted Text'}</strong></label>
    <textarea class="field-input" rows="3" placeholder="${config.placeholder}"></textarea>
    <label><strong>Output</strong></label>
    <textarea class="field-output" rows="3" readonly placeholder="Output will appear here"></textarea>
  `;

  row.querySelector('.remove-btn').addEventListener('click', () => {
    const { fields } = getSectionElements(mode);
    row.remove();
    if (!fields.children.length) {
      addRow(mode);
    }
    refreshTitles(mode);
  });

  return row;
}

function refreshTitles(mode) {
  const { fields } = getSectionElements(mode);
  Array.from(fields.children).forEach((row, index) => {
    const title = row.querySelector('.field-row-title');
    if (title) {
      title.textContent = `${sectionConfig[mode].actionLabel} Value ${index + 1}`;
    }
  });
}

function addRow(mode) {
  const { fields } = getSectionElements(mode);
  const nextIndex = fields.children.length + 1;
  fields.appendChild(buildRow(mode, nextIndex));
}

function setCombinedResult(mode, lines) {
  const { result, config } = getSectionElements(mode);
  result.textContent = lines.length ? lines.join('\n\n') : config.emptyMessage;
}

function processRows(mode) {
  const { fields, passphrase } = getSectionElements(mode);
  const secret = passphrase.value.trim();

  if (!secret) {
    setCombinedResult(mode, ['Enter a passphrase first.']);
    return;
  }

  const lines = [];

  Array.from(fields.children).forEach((row, index) => {
    const label = row.querySelector('.field-label').value.trim() || `Value ${index + 1}`;
    const input = row.querySelector('.field-input').value;
    const output = row.querySelector('.field-output');

    if (!input.trim()) {
      output.value = '';
      return;
    }

    let resultText = '';

    if (mode === 'encrypt') {
      resultText = CryptoJS.AES.encrypt(input, secret).toString();
    } else {
      const bytes = CryptoJS.AES.decrypt(input, secret);
      resultText = bytes.toString(CryptoJS.enc.Utf8);
      if (!resultText) {
        resultText = '[Unable to decrypt with this passphrase/value]';
      }
    }

    output.value = resultText;
    lines.push(`${label}:\n${resultText}`);
  });

  setCombinedResult(mode, lines);
}

function clearSection(mode) {
  const { fields, result, passphrase, config } = getSectionElements(mode);
  fields.innerHTML = '';
  addRow(mode);
  passphrase.value = '';
  result.textContent = config.emptyMessage;
}

document.getElementById('addEncryptRow').addEventListener('click', () => addRow('encrypt'));
document.getElementById('addDecryptRow').addEventListener('click', () => addRow('decrypt'));
document.getElementById('encryptAll').addEventListener('click', () => processRows('encrypt'));
document.getElementById('decryptAll').addEventListener('click', () => processRows('decrypt'));
document.getElementById('clearEncrypt').addEventListener('click', () => clearSection('encrypt'));
document.getElementById('clearDecrypt').addEventListener('click', () => clearSection('decrypt'));

addRow('encrypt');
addRow('decrypt');
