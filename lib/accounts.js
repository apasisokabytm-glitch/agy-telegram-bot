/*
 * Agy telegram bot 
 * Creator : Vellzyy
 * Channel Whatsapp : https://whatsapp.com/channel/0029VbDl6c1KmCPJErq9ox3F
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir() || process.env.HOME || '/home/container';
const DATA_DIR = path.resolve(__dirname, '../data');
const DEFAULT_ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');

function getTokenPath(userContext) {
  if (!userContext || !userContext.userHome) {
    throw new Error('userContext.userHome is required for multi-tenant isolation');
  }
  return path.join(userContext.userHome, '.gemini/antigravity-cli/antigravity-oauth-token');
}

function writeTokenToDisk(userContext, tokenData) {
  const p = getTokenPath(userContext);
  const jsonStr = typeof tokenData === 'string' ? tokenData : JSON.stringify(tokenData, null, 2);
  try {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, jsonStr, { mode: 0o600 });
  } catch (err) {
    console.warn(`[writeTokenToDisk] Gagal menulis ke ${p}:`, err.message);
  }
}

function loadAccounts(userContext) {
  if (!userContext || !userContext.accountsFile) {
    throw new Error('userContext.accountsFile is required for multi-tenant isolation');
  }
  const file = userContext.accountsFile;
  let data = { accounts: [], activeAccountId: null };
  try {
    if (fs.existsSync(file)) {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {
    console.warn('[loadAccounts] Error reading accounts file:', e.message);
  }

  if (!data.accounts) data.accounts = [];

  // Auto-import existing token on disk if accounts list is empty
  if (data.accounts.length === 0) {
    const p = getTokenPath(userContext);
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, 'utf8');
        const j = JSON.parse(raw);
        const email = j.id_token_email || j.email || 'akun_utama@antigravity';
        const accId = 'acc_1';
        const newAcc = {
          id: accId,
          email,
          tokenData: j,
          addedAt: Date.now(),
          lastUsed: Date.now(),
          status: 'ready',
          rateLimitedUntil: null
        };
        data.accounts.push(newAcc);
        data.activeAccountId = accId;
        saveAccounts(userContext, data);
      } catch {}
    }
  }

  return data;
}

function saveAccounts(userContext, data) {
  if (!userContext || !userContext.accountsFile) {
    throw new Error('userContext.accountsFile is required for multi-tenant isolation');
  }
  const file = userContext.accountsFile;
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn('[saveAccounts] Error saving accounts file:', err.message);
  }
}

function getActiveAccount(userContext) {
  const data = loadAccounts(userContext);
  if (!data.accounts.length) return null;
  const active = data.accounts.find(a => a.id === data.activeAccountId);
  return active || data.accounts[0] || null;
}

function listAccounts(userContext) {
  const data = loadAccounts(userContext);
  const now = Date.now();

  return data.accounts.map((a, idx) => {
    let currentStatus = a.status || 'ready';
    if (currentStatus === 'limited' && a.rateLimitedUntil && now >= a.rateLimitedUntil) {
      currentStatus = 'ready';
      a.status = 'ready';
      a.rateLimitedUntil = null;
    }
    return {
      index: idx + 1,
      id: a.id,
      email: a.email,
      isActive: a.id === data.activeAccountId,
      status: currentStatus,
      rateLimitedUntil: a.rateLimitedUntil,
      addedAt: a.addedAt,
      lastUsed: a.lastUsed
    };
  });
}

function switchAccount(userContext, identifier) {
  const data = loadAccounts(userContext);
  if (!data.accounts.length) return { ok: false, error: 'Belum ada akun yang terdaftar.' };

  const query = String(identifier || '').trim().toLowerCase();
  let target = null;

  const num = parseInt(query, 10);
  if (!isNaN(num) && num >= 1 && num <= data.accounts.length) {
    target = data.accounts[num - 1];
  } else {
    target = data.accounts.find(a =>
      a.id.toLowerCase() === query ||
      a.email.toLowerCase() === query ||
      a.email.toLowerCase().includes(query)
    );
  }

  if (!target) {
    return { ok: false, error: `Akun "${identifier}" tidak ditemukan.` };
  }

  writeTokenToDisk(userContext, target.tokenData);
  data.activeAccountId = target.id;
  target.lastUsed = Date.now();
  saveAccounts(userContext, data);

  return { ok: true, account: target };
}

function saveCurrentTokenAsAccount(userContext, emailHint = null) {
  const p = getTokenPath(userContext);
  let tokenData = null;
  if (fs.existsSync(p)) {
    try {
      tokenData = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {}
  }

  if (!tokenData) {
    return { ok: false, error: 'Tidak ada berkas token yang ditemukan setelah login.' };
  }

  const data = loadAccounts(userContext);
  const email = emailHint || tokenData.id_token_email || tokenData.email || `akun_${data.accounts.length + 1}@antigravity`;

  let existing = data.accounts.find(a => a.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    existing.tokenData = tokenData;
    existing.status = 'ready';
    existing.rateLimitedUntil = null;
    existing.lastUsed = Date.now();
    data.activeAccountId = existing.id;
  } else {
    const accId = `acc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newAcc = {
      id: accId,
      email,
      tokenData,
      addedAt: Date.now(),
      lastUsed: Date.now(),
      status: 'ready',
      rateLimitedUntil: null
    };
    data.accounts.push(newAcc);
    data.activeAccountId = accId;
    existing = newAcc;
  }

  saveAccounts(userContext, data);
  writeTokenToDisk(userContext, tokenData);
  return { ok: true, account: existing, totalAccounts: data.accounts.length };
}

function markAccountLimited(userContext, accountId) {
  const data = loadAccounts(userContext);
  const acc = data.accounts.find(a => a.id === accountId);
  if (acc) {
    acc.status = 'limited';
    acc.rateLimitedUntil = Date.now() + 3600_000 * 2;
    saveAccounts(userContext, data);
  }
}

function getNextAvailableAccount(userContext, currentAccountId) {
  const data = loadAccounts(userContext);
  if (data.accounts.length <= 1) {
    return { ok: false, error: 'Hanya ada 1 akun terdaftar, tidak ada akun cadangan.' };
  }

  const now = Date.now();
  const candidates = data.accounts.filter(a => {
    if (a.id === currentAccountId) return false;
    if (a.status !== 'limited') return true;
    if (a.rateLimitedUntil && now >= a.rateLimitedUntil) return true;
    return false;
  });

  if (!candidates.length) {
    return { ok: false, error: 'Semua akun cadangan saat ini sedang mencapai limit kuota.' };
  }

  candidates.sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0));
  const next = candidates[0];

  writeTokenToDisk(userContext, next.tokenData);
  data.activeAccountId = next.id;
  next.lastUsed = Date.now();
  next.status = 'ready';
  next.rateLimitedUntil = null;
  saveAccounts(userContext, data);

  return { ok: true, account: next, remainingCount: candidates.length };
}

function removeAccount(userContext, identifier) {
  const data = loadAccounts(userContext);
  if (!data.accounts.length) return { ok: false, error: 'Belum ada akun yang terdaftar.' };

  const query = String(identifier || '').trim().toLowerCase();
  let idx = -1;

  const num = parseInt(query, 10);
  if (!isNaN(num) && num >= 1 && num <= data.accounts.length) {
    idx = num - 1;
  } else {
    idx = data.accounts.findIndex(a =>
      a.id.toLowerCase() === query ||
      a.email.toLowerCase() === query ||
      a.email.toLowerCase().includes(query)
    );
  }

  if (idx === -1) {
    return { ok: false, error: `Akun "${identifier}" tidak ditemukan.` };
  }

  const removed = data.accounts.splice(idx, 1)[0];

  if (data.activeAccountId === removed.id && data.accounts.length > 0) {
    const next = data.accounts[0];
    data.activeAccountId = next.id;
    writeTokenToDisk(userContext, next.tokenData);
  }

  saveAccounts(userContext, data);
  return { ok: true, removed, totalAccounts: data.accounts.length };
}

module.exports = {
  loadAccounts,
  saveAccounts,
  getActiveAccount,
  listAccounts,
  switchAccount,
  saveCurrentTokenAsAccount,
  markAccountLimited,
  getNextAvailableAccount,
  removeAccount,
  getTokenPath
};