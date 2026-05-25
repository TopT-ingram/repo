const sectionConfig = {
  encrypt: {
    fieldsId: 'encryptFields',
    resultId: 'encryptCombinedResult',
    emptyMessage: 'Your encrypted values will appear here.',
    placeholder: 'Enter plain text to encrypt',
    actionLabel: 'Encrypt'
  },
  decrypt: {
    fieldsId: 'decryptFields',
    resultId: 'decryptCombinedResult',
    emptyMessage: 'Your decrypted values will appear here.',
    placeholder: 'Enter encrypted text to decrypt',
    actionLabel: 'Decrypt'
  }
};

const UI_AES_KEY = 'aesEncryptionKey';
const UI_AES_IV = 'encryptionIntVec';
const aesKey = CryptoJS.enc.Utf8.parse(UI_AES_KEY);
const aesIv = CryptoJS.enc.Utf8.parse(UI_AES_IV);

function getSectionElements(mode) {
  const config = sectionConfig[mode];
  return {
    config,
    fields: document.getElementById(config.fieldsId),
    result: document.getElementById(config.resultId)
  };
}

function encryptWithUiCipher(plainText) {
  const encrypted = CryptoJS.AES.encrypt(plainText, aesKey, {
    iv: aesIv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7
  });

  return encrypted.ciphertext.toString(CryptoJS.enc.Base64);
}

function decryptWithUiCipher(encryptedText) {
  const normalizedCipherText = encryptedText
    .trim()
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  const cipherParams = CryptoJS.lib.CipherParams.create({
    ciphertext: CryptoJS.enc.Base64.parse(normalizedCipherText)
  });

  const decrypted = CryptoJS.AES.decrypt(cipherParams, aesKey, {
    iv: aesIv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7
  });

  return decrypted.toString(CryptoJS.enc.Utf8);
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
    <label><strong>${config.actionLabel === 'Encrypt' ? 'Plain Text' : 'Encrypted Text'}</strong></label>
    <textarea class="field-input" rows="3" placeholder="${config.placeholder}"></textarea>
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
  const { fields } = getSectionElements(mode);

  const lines = [];

  Array.from(fields.children).forEach((row, index) => {
    const input = row.querySelector('.field-input').value;
    const output = row.querySelector('.field-output');

    if (!input.trim()) {
      output.value = '';
      return;
    }

    let resultText = '';

    try {
      if (mode === 'encrypt') {
        resultText = encryptWithUiCipher(input);
      } else {
        resultText = decryptWithUiCipher(input);
      }
    } catch (error) {
      resultText = '';
    }

    if (!resultText) {
      resultText = '[Unable to decrypt with this value]';
    }

    output.value = resultText;
    lines.push(resultText);
  });

  setCombinedResult(mode, lines);
}

function clearSection(mode) {
  const { fields, result, config } = getSectionElements(mode);
  fields.innerHTML = '';
  addRow(mode);
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
