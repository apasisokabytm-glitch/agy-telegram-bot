/*Creator : Vellzyyy
 * Channel Creator : https://whatsapp.com/channel/0029VbDl6c1KmCPJErq9ox3F
 * Disclaimer : 
 * Note : Jangan hapus watermark
*/

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir() || process.env.HOME || '/home/container';
const DATA_DIR = path.resolve(__dirname, '../data');
const USERS_ROOT = path.join(DATA_DIR, 'users');

fs.mkdirSync(USERS_ROOT, { recursive: true });

function getUserContext(userId) {
  const safeId = String(userId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  const userDir = path.join(USERS_ROOT, safeId);
  const userHome = path.join(userDir, 'home');
  const workspaceDir = path.join(userDir, 'workspace');
  const skillsDir = path.join(userDir, 'skills');
  const sessionFile = path.join(userDir, 'session.json');
  const accountsFile = path.join(userDir, 'accounts.json');

  // Ensure directories exist
  fs.mkdirSync(userDir, { recursive: true });
  fs.mkdirSync(userHome, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(skillsDir, { recursive: true });

  return {
    userId: safeId,
    userDir,
    userHome,
    workspaceDir,
    skillsDir,
    sessionFile,
    accountsFile
  };
}

function getUserSession(userContext, defaults = {}) {
  const defaultModel = defaults.model || 'gemini-3.8-flash-medium';
  const defaultMode = defaults.mode || 'auto';
  const defaultEffort = defaults.effort || 'medium';

  let sess = {
    history: [],
    model: defaultModel,
    mode: defaultMode,
    effort: defaultEffort,
    agent: null,
    persona: null,
    conversationId: null,
    createdAt: Date.now()
  };

  try {
    if (fs.existsSync(userContext.sessionFile)) {
      const read = JSON.parse(fs.readFileSync(userContext.sessionFile, 'utf8'));
      sess = { ...sess, ...read };
    }
  } catch (err) {
    console.warn(`[getUserSession] Error reading ${userContext.sessionFile}:`, err.message);
  }

  if (!sess.history) sess.history = [];
  if (sess.history.length > 80) sess.history = sess.history.slice(-80);
  return sess;
}

function saveUserSession(userContext, sessionObj) {
  try {
    fs.writeFileSync(userContext.sessionFile, JSON.stringify(sessionObj, null, 2));
  } catch (err) {
    console.warn(`[saveUserSession] Error saving ${userContext.sessionFile}:`, err.message);
  }
}

// ── One-time Migration for Owner (7948712917) ───────────────────────
function migrateOwnerIfPresent(ownerId = '7948712917') {
  const ctx = getUserContext(ownerId);
  const tokenDest = path.join(ctx.userHome, '.gemini/antigravity-cli/antigravity-oauth-token');

  // 1. Migrate Antigravity token if not already in userHome
  if (!fs.existsSync(tokenDest)) {
    const candidateTokens = [
      path.join(HOME, '.gemini/antigravity-cli/antigravity-oauth-token'),
      '/home/container/.gemini/antigravity-cli/antigravity-oauth-token'
    ];
    for (const cand of candidateTokens) {
      if (fs.existsSync(cand)) {
        try {
          fs.mkdirSync(path.dirname(tokenDest), { recursive: true });
          fs.copyFileSync(cand, tokenDest);
          console.log(`[migrate] Berhasil migrasi token Antigravity ke ${tokenDest}`);
          break;
        } catch (e) {
          console.warn('[migrate] Error copy token:', e.message);
        }
      }
    }
  }

  // 2. Migrate accounts.json
  const oldAccountsFile = path.join(DATA_DIR, 'accounts.json');
  if (fs.existsSync(oldAccountsFile) && !fs.existsSync(ctx.accountsFile)) {
    try {
      fs.copyFileSync(oldAccountsFile, ctx.accountsFile);
      console.log(`[migrate] Berhasil migrasi accounts.json ke ${ctx.accountsFile}`);
    } catch {}
  }

  // 3. Migrate sessions from data/sessions.json
  const oldSessionsFile = path.join(DATA_DIR, 'sessions.json');
  if (fs.existsSync(oldSessionsFile) && !fs.existsSync(ctx.sessionFile)) {
    try {
      const allSess = JSON.parse(fs.readFileSync(oldSessionsFile, 'utf8'));
      if (allSess[ownerId]) {
        saveUserSession(ctx, allSess[ownerId]);
        console.log(`[migrate] Berhasil migrasi riwayat sesi untuk ${ownerId}`);
      }
    } catch {}
  }

  // 4. Migrate workspace
  const oldWorkspaceDir = path.resolve(__dirname, '../workspace', ownerId);
  if (fs.existsSync(oldWorkspaceDir) && fs.readdirSync(ctx.workspaceDir).length === 0) {
    try {
      fs.cpSync(oldWorkspaceDir, ctx.workspaceDir, { recursive: true });
      console.log(`[migrate] Berhasil migrasi workspace untuk ${ownerId}`);
    } catch {}
  }

  // 5. Migrate GitHub auth
  const ghSrc = path.join(HOME, '.config/gh');
  const ghDest = path.join(ctx.userHome, '.config/gh');
  if (fs.existsSync(ghSrc) && !fs.existsSync(ghDest)) {
    try {
      fs.cpSync(ghSrc, ghDest, { recursive: true });
      console.log(`[migrate] Berhasil migrasi GitHub auth untuk ${ownerId}`);
    } catch {}
  }

  // 6. Migrate Vercel auth
  const vcSrc = path.join(HOME, '.config/com.vercel.cli');
  const vcDest = path.join(ctx.userHome, '.config/com.vercel.cli');
  if (fs.existsSync(vcSrc) && !fs.existsSync(vcDest)) {
    try {
      fs.cpSync(vcSrc, vcDest, { recursive: true });
      console.log(`[migrate] Berhasil migrasi Vercel auth untuk ${ownerId}`);
    } catch {}
  }
}

function getAllUserIds() {
  try {
    if (!fs.existsSync(USERS_ROOT)) return [];
    return fs.readdirSync(USERS_ROOT, { withFileTypes: true })
      .filter(e => e.isDirectory() && /^\d+$/.test(e.name))
      .map(e => e.name);
  } catch (err) {
    console.warn('[getAllUserIds] error:', err.message);
    return [];
  }
}

module.exports = {
  getUserContext,
  getUserSession,
  saveUserSession,
  migrateOwnerIfPresent,
  getAllUserIds,
  USERS_ROOT
};