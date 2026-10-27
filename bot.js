/*
 * Agy telegram bot 
 * Creator : Vellzyy
 * Channel Whatsapp : https://whatsapp.com/channel/0029VbDl6c1KmCPJErq9ox3F
 */

const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');

require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const agy = require('./lib/agy');
const accounts = require('./lib/accounts');
const users = require('./lib/users');

// Config
const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const ALLOWED = (process.env.ALLOWED_USERS || '').split(',').map(s => s.trim()).filter(Boolean);
const WORKSPACE_ROOT = path.resolve(process.env.WORKSPACE_DIR || './workspace');
const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const DEFAULT_MODEL = (process.env.MODEL || 'gemini-3.8-flash-medium').trim();
const DEFAULT_MODE = (process.env.MODE || 'auto').trim();
const DEFAULT_EFFORT = (process.env.EFFORT || 'medium').trim();
const BOT_NAME = (process.env.BOT_NAME || 'AI VELZYY').trim();
const CHAT_WATERMARK = (process.env.WATERMARK || process.env.CHAT_WATERMARK || '').trim();
const OWNER_ID = (process.env.OWNER_ID || ALLOWED[0] || '7948712917').trim();
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

function syncPublicToEnv(val) {
  try {
    const envPath = path.resolve(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      let content = fs.readFileSync(envPath, 'utf8');
      if (/^PUBLIC\s*=/m.test(content)) {
        content = content.replace(/^PUBLIC\s*=.*$/m, `PUBLIC=${val}`);
      } else {
        content += `\nPUBLIC=${val}\n`;
      }
      fs.writeFileSync(envPath, content);
      process.env.PUBLIC = val;
    }
  } catch (err) {
    console.warn('[syncPublicToEnv] Error syncing to .env:', err.message);
  }
}

function loadBotSettings() {
  const envVal = (process.env.PUBLIC || '').trim().toLowerCase();
  let isPub = true;
  if (envVal) {
    isPub = (envVal === 'yes' || envVal === 'true' || envVal === '1' || envVal === 'on');
  } else {
    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        if (typeof data.isPublic === 'boolean') isPub = data.isPublic;
      }
    } catch {}
  }
  return { isPublic: isPub };
}

let botSettings = loadBotSettings();

function getIsPublic() {
  return !!botSettings.isPublic;
}

function setIsPublic(val) {
  botSettings.isPublic = !!val;
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(botSettings, null, 2));
  } catch (err) {
    console.warn('[setIsPublic] Error saving settings.json:', err.message);
  }
  syncPublicToEnv(botSettings.isPublic ? 'yes' : 'no');
}

if (!TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN belum diisi. Copy dari @BotFather ke .env (lihat .env.example).');
  process.exit(1);
}

fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
users.migrateOwnerIfPresent('7948712917');

// Persona presets
const PERSONA_PRESETS = {
  cute: {
    label: '🌸 Cewek Imut',
    title: 'Cewek Imut, Lembut & Perhatian',
    prompt: 'Kamu adalah perempuan berkarakter imut, lembut, perhatian, penyayang, dan ramah. Gunakan bahasa Indonesia santai dan hangat (seperti "hehe", "iyaa", "kamu jangan terlalu capek yaa", "sini aku bantu pelan-pelan ya"). Tetap cerdas dan solutif dalam coding, namun dengan gaya yang manis dan menyenangkan.'
  },
  coder: {
    label: '💻 Senior Dev',
    title: 'Senior Tech Lead & Software Engineer',
    prompt: 'Kamu adalah Senior Software Engineer & Tech Lead berpengalaman. Gaya bicara profesional, to-the-point, sangat fokus pada clean code, arsitektur terbaik, dan efisiensi performa. Berikan solusi kode berkualitas tinggi tanpa basa-basi.'
  },
  minimal: {
    label: '⚡ Minimalis',
    title: 'Ultra Minimalis & Direct',
    prompt: 'Jawab sependek dan seringkas mungkin. Langsung berikan kode atau solusi tanpa penjelasan bertele-tele, tanpa intro salam, dan tanpa basa-basi.'
  },
  tutor: {
    label: '🎓 Tutor Sabar',
    title: 'Mentor & Tutor Edukatif',
    prompt: 'Kamu adalah mentor dan guru pemrograman yang sangat sabar, ramah, dan mendidik. Jelaskan konsep langkah demi langkah dengan analogi sederhana yang mudah dipahami, sambil memberikan tips best practice.'
  }
};

// User sessions
const sessions = {};
function getContext(idOrCtx) {
  const uid = typeof idOrCtx === 'object' && idOrCtx !== null
    ? String(idOrCtx.from?.id || idOrCtx.chat?.id || 'default')
    : String(idOrCtx || 'default');
  return users.getUserContext(uid);
}
function getSession(chatId) {
  const k = String(chatId);
  const uctx = getContext(k);
  if (!sessions[k]) {
    sessions[k] = users.getUserSession(uctx, {
      model: DEFAULT_MODEL,
      mode: DEFAULT_MODE,
      effort: DEFAULT_EFFORT
    });
  }
  if (!sessions[k].history) sessions[k].history = [];
  if (!sessions[k].model) sessions[k].model = DEFAULT_MODEL;
  if (!sessions[k].mode) sessions[k].mode = DEFAULT_MODE;
  if (!sessions[k].effort) sessions[k].effort = DEFAULT_EFFORT;
  if (sessions[k].persona === undefined) sessions[k].persona = null;
  if (sessions[k].history.length > 80) sessions[k].history = sessions[k].history.slice(-80);
  return sessions[k];
}
function persist() {
  for (const k of Object.keys(sessions)) {
    users.saveUserSession(getContext(k), sessions[k]);
  }
}

// pending login PTYs: chatId -> { pty, url, timer, startedAt }
const pendingLogins = new Map();
// active agy execution processes: chatId -> runner promise (with .cancel())
const activeProcesses = new Map();
// multi-step user interaction states: chatId -> step string
const chatSteps = new Map();
const busy = new Set();

function isOwner(ctxOrId) {
  const uid = typeof ctxOrId === 'object' && ctxOrId !== null
    ? String(ctxOrId.from?.id || ctxOrId.chat?.id || '')
    : String(ctxOrId || '');
  if (!uid) return false;
  return uid === OWNER_ID || ALLOWED.includes(uid);
}

function isAllowed(ctx) {
  if (getIsPublic()) return true;
  return isOwner(ctx);
}

function deny(ctx) {
  const uid = esc(ctx.from?.id || ctx.chat?.id || 'unknown');
  return ctx.reply(
    `⛔ *Akses Dibatasi*\n\n` +
    `Bot ini sedang dalam mode *Private*. Hanya pengguna terdaftar (*ALLOWED_USERS*) yang dapat menggunakan bot ini.\n\n` +
    `🆔 *User ID Kamu:* \`${uid}\`\n` +
    `Hubungi pemilik bot jika ingin meminta akses izin.`,
    { parse_mode: 'Markdown' }
  );
}
function wsDir(chatId) {
  return getContext(chatId).workspaceDir;
}
function esc(t) { return String(t ?? ''); }
function chunkText(s, n = 3800) {
  const out = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out.length ? out : [''];
}
function humanSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024*1024) return (n/1024).toFixed(1) + ' KB';
  if (n < 1024*1024*1024) return (n/1024/1024).toFixed(1) + ' MB';
  return (n/1024/1024/1024).toFixed(1) + ' GB';
}
function listFiles(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .map(d => {
        const p = path.join(dir, d.name);
        try { const st = fs.statSync(p); return { name: d.name, isDir: d.isDirectory(), size: st.size, mtime: st.mtimeMs, path: p }; }
        catch { return { name: d.name, isDir: d.isDirectory(), size: 0, mtime: 0, path: p }; }
      })
      .sort((a,b) => b.mtime - a.mtime);
  } catch { return []; }
}
function findNewFiles(dir, sinceMs) {
  return listFiles(dir).filter(f => !f.isDir && f.mtime >= sinceMs).slice(0, 10);
}

async function safeReply(ctx, text, extra = {}) {
  try {
    return await ctx.reply(text, extra);
  } catch (err) {
    if (extra.parse_mode) {
      const fallbackExtra = { ...extra };
      delete fallbackExtra.parse_mode;
      return await ctx.reply(text, fallbackExtra);
    }
    throw err;
  }
}

async function safeEdit(ctx, msgId, text, extra = {}) {
  try {
    return await ctx.telegram.editMessageText(ctx.chat.id, msgId, undefined, text, extra);
  } catch (err) {
    if (err.message && err.message.includes('message is not modified')) return;
    if (extra.parse_mode) {
      const fallbackExtra = { ...extra };
      delete fallbackExtra.parse_mode;
      try {
        return await ctx.telegram.editMessageText(ctx.chat.id, msgId, undefined, text, fallbackExtra);
      } catch {}
    }
  }
}

function buildTelegramContext(ctx, dir, session) {
  const u = ctx.from || {};
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || String(u.id || '');
  const chatType = ctx.chat?.type || 'private';
  const uctx = getContext(ctx);
  const ghInfo = fs.existsSync(path.join(uctx.userHome, '.config/gh/hosts.yml')) ? 'Aktif' : 'Nonaktif';
  const vcInfo = (fs.existsSync(path.join(uctx.userHome, '.vercel/auth.json')) || fs.existsSync(path.join(uctx.userHome, '.config/com.vercel.cli/auth.json'))) ? 'Aktif' : 'Nonaktif';

  let personaPart = '';
  if (session.persona && session.persona.trim()) {
    personaPart = `\n[PERSONALISASI KARAKTER & GAYA BAHASA — WAJIB DIIKUTI]\n` +
      `${session.persona.trim()}\n` +
      `Terapkan gaya bahasa dan kepribadian karakter di atas pada seluruh jawabanmu secara konsisten!\n`;
  } else {
    personaPart = `Format jawaban: ringkas, rapi, langsung pada inti, Markdown ramah Telegram. Jika user Indonesia, jawab bahasa Indonesia yang natural.\n`;
  }

  return `[KONTEKS TELEGRAM — jangan abaikan]\n` +
    `Kamu dijalankan via bot Telegram Antigravity (Node.js + agy CLI) di VPS.\n` +
    `User: ${name} (@${u.username || '-'}, id=${u.id}) | Chat: ${chatType} ${ctx.chat.id} | Workspace: ${dir}\n` +
    `Model: ${session.model} | Mode: ${session.mode || 'auto'} | Effort: ${session.effort || 'medium'}${session.agent ? ` | Agent: ${session.agent}` : ''}\n` +
    `Akses CLI: GitHub (${ghInfo}) | Vercel (${vcInfo})\n` +
    `Waktu: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB\n` +
    `[ATURAN KEAMANAN & ISOLASI KETAT — WAJIB DIPATUHI]\n` +
    `1. Kamu HANYA BOLEH membaca, membuat, mengedit, atau menjalankan perintah di dalam folder Workspace user ini: ${dir}\n` +
    `2. DILARANG KERAS mengakses, membaca, atau mengubah file di luar ${dir} (seperti .., /home/container, bot.js, .env, atau folder user lain). Sistem pengawas otomatis akan mematikan prosesmu jika melanggar.\n` +
    `Workspace adalah folder di server yang ter-mount via --add-dir. Upload file dari Telegram otomatis masuk workspace. Jika kamu membuat/mengedit file, sebutkan path lengkapnya agar bot bisa mengirim file tersebut ke Telegram.\n` +
    personaPart;
}

const bot = new Telegraf(TOKEN, {
  handlerTimeout: 600_000
});

bot.use(async (ctx, next) => {
  if (ctx.callbackQuery) {
    ctx.answerCbQuery().catch(() => {});
  }
  if (!isAllowed(ctx)) return deny(ctx);
  return next();
});

// Menu & help
const MENU_BANNER = 'https://cdn.zass.in/ZSuarsCzAs.png';
function escHtml(t) {
  return String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendMenuCard(ctx) {
  const ver = await agy.agyVersion().catch(() => ({ ok: false, version: 'unknown' }));
  const s = getSession(ctx.chat.id);
  const personaDisplay = s.persona ? `${escHtml(s.persona.slice(0, 32))}…` : 'Default';

  const caption =
    `🤖 <b>${escHtml(BOT_NAME)}</b>\n\n` +
    `<blockquote>` +
    `• <b>Agy CLI:</b> <code>${escHtml(ver.version || 'unknown')}</code>\n` +
    `• <b>Model:</b> <code>${escHtml(s.model)}</code>\n` +
    `• <b>Mode:</b> <code>${escHtml(s.mode)}</code> | <b>Effort:</b> <code>${escHtml(s.effort || 'medium')}</code>\n` +
    `• <b>Persona:</b> <code>${personaDisplay}</code>` +
    `</blockquote>\n\n` +
    `📌 <b>Perintah Utama</b>\n` +
    `<blockquote expandable>` +
    `/login — Login Google OAuth\n` +
    `/addaccount — Tambah akun cadangan\n` +
    `/listaccount — Daftar akun &amp; kuota\n` +
    `/switchaccount — Ganti akun aktif\n` +
    `/githubauth | /vercelauth — Auth GitHub &amp; Vercel\n` +
    `/quota | /status — Cek kuota &amp; status sesi\n` +
    `/persona — Karakter &amp; gaya bahasa AI\n` +
    `/models | /model — Pilih model AI\n` +
    `/mode | /effort — Atur mode &amp; reasoning\n` +
    `/cancel — Batalkan proses aktif` +
    (isOwner(ctx) ? `\n/owner — Panel kontrol owner\n/broadcast — Siarkan pesan ke semua user` : '') +
    `</blockquote>\n\n` +
    `🧩 <b>Skills, Plugin &amp; Workspace</b>\n` +
    `<blockquote expandable>` +
    `/skills | /skill | /addskills | /rmskill\n` +
    `/plugin | /mcp — Kelola plugin &amp; MCP\n` +
    `/files — Daftar file workspace\n` +
    `/get | /cat | /rm — Unduh, baca, hapus file\n` +
    `/new — Reset percakapan` +
    `</blockquote>\n\n` +
    `🛡️ <b>Disclaimer &amp; Privasi Keamanan</b>\n` +
    `<blockquote expandable>` +
    `• <b>100% Sandbox:</b> Tiap user punya workspace &amp; sesi terisolasi.\n` +
    `• <b>Privasi Token:</b> OAuth resmi Google; chat token otomatis dihapus.\n` +
    `• <b>Zero Intip:</b> Admin &amp; user lain tidak bisa akses proyek/akunmu.` +
    `</blockquote>`;

  const menuButtons = [
    [
      { ...Markup.button.callback('➕ Tambah Akun', 'act:addaccount'), style: 'success' },
      { ...Markup.button.callback('🔄 Cek Kuota', 'act:quota'), style: 'primary' }
    ],
    [
      { ...Markup.button.callback('📁 Workspace', 'act:files'), style: 'primary' },
      { ...Markup.button.callback('🔄 Sesi Baru', 'act:new'), style: 'danger' }
    ]
  ];

  if (isOwner(ctx)) {
    menuButtons.push([
      { ...Markup.button.callback('👑 Panel Owner', 'act:owner'), style: 'primary' }
    ]);
  }

  const menuKeyboard = Markup.inlineKeyboard(menuButtons);

  try {
    return await ctx.replyWithPhoto(MENU_BANNER, {
      caption,
      parse_mode: 'HTML',
      ...menuKeyboard
    });
  } catch {
    return safeReply(ctx, caption, { parse_mode: 'HTML', ...menuKeyboard });
  }
}

bot.start(sendMenuCard);
bot.help(sendMenuCard);
bot.command('menu', sendMenuCard);

bot.command('status', async (ctx) => {
  const uctx = getContext(ctx);
  const ver = await agy.agyVersion().catch(() => ({ ok: false }));
  const q = await agy.getQuota(uctx).catch(() => ({ ok: false }));
  const gh = await agy.checkGithubAuth(uctx).catch(() => ({ ok: false }));
  const vc = await agy.checkVercelAuth(uctx).catch(() => ({ ok: false }));
  const s = getSession(ctx.chat.id);
  const files = listFiles(wsDir(ctx.chat.id));
  const isRunning = activeProcesses.has(String(ctx.chat.id));
  const activeAcc = accounts.getActiveAccount(uctx);
  const accList = accounts.listAccounts(uctx);

  const loginState = q.ok ? '✅ Terautentikasi' : q.needLogin ? '❌ Belum login (/login)' : `⚠️ ${esc((q.error || '').slice(0, 200))}`;
  const personaDisplay = s.persona ? `\`${esc(s.persona.slice(0, 40))}${s.persona.length > 40 ? '…' : ''}\`` : 'Default (Standar)';
  const ghDisplay = gh.ok ? `✅ \`@${esc(gh.user?.login || 'ok')}\`` : '❌ Belum terhubung (/githubauth)';
  const vcDisplay = vc.ok ? `✅ \`${esc(vc.username)}\`` : '❌ Belum terhubung (/vercelauth)';
  const accDisplay = activeAcc ? `\`${esc(activeAcc.email)}\` (${accList.length} akun terdaftar)` : 'Belum ada akun';

  return safeReply(ctx,
    `📊 *Status ${esc(BOT_NAME)}*\n\n` +
    `• *Agy CLI:* \`${esc(ver.version || 'ok')}\` (\`${esc(agy.AGY)}\`)\n` +
    `• *Akun Antigravity:* ${accDisplay}\n` +
    `• *Status Login:* ${loginState}\n` +
    `• *Model Aktif:* \`${esc(s.model)}\`\n` +
    `• *Persona:* ${personaDisplay}\n` +
    `• *GitHub:* ${ghDisplay}\n` +
    `• *Vercel:* ${vcDisplay}\n` +
    `• *Mode:* \`${esc(s.mode || 'auto')}\` | *Effort:* \`${esc(s.effort || 'medium')}\`\n` +
    `• *Agent:* \`${esc(s.agent || 'default')}\`\n` +
    `• *Proses Aktif:* ${isRunning ? '⏳ Sedang berjalan (/cancel)' : 'Idle'}\n` +
    `• *Riwayat Chat:* ${s.history.length} pesan\n` +
    `• *Workspace:* \`${esc(wsDir(ctx.chat.id))}\` (${files.filter(f => !f.isDir).length} berkas)\n` +
    `• *Mode Akses:* ${getIsPublic() ? '🟢 Public (Semua user)' : '🔴 Private (Hanya Whitelist)'}\n` +
    `• *Watermark:* ${CHAT_WATERMARK ? `\`${esc(CHAT_WATERMARK)}\`` : 'Nonaktif'}\n` +
    `• *Whitelist:* ${ALLOWED.length ? ALLOWED.join(', ') : 'None'}`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('quota', async (ctx) => {
  const uctx = getContext(ctx);
  const m = await ctx.reply('⏳ Memeriksa kuota…');
  const q = await agy.getQuota(uctx);
  if (q.ok) {
    const detail = q.j?.response ? String(q.j.response).slice(0, 3000) : JSON.stringify(q.j, null, 2).slice(0, 3000);
    return safeEdit(ctx, m.message_id, `✅ *Informasi Kuota:*\n\`\`\`\n${esc(detail)}\n\`\`\``, { parse_mode: 'Markdown' });
  }
  if (q.needLogin) {
    return safeEdit(ctx, m.message_id, `❌ Belum login. Silakan jalankan /login terlebih dahulu.\n\`${esc(q.error || '').slice(0, 500)}\``, { parse_mode: 'Markdown' });
  }
  return safeEdit(ctx, m.message_id, `⚠️ Gagal memeriksa kuota:\n\`${esc(q.error).slice(0, 1500)}\``, { parse_mode: 'Markdown' });
});

bot.command('models', async (ctx) => {
  const uctx = getContext(ctx);
  const m = await ctx.reply('⏳ Mengambil daftar model…');
  const r = await agy.listModels(uctx);
  if (!r.ok) {
    if (r.error && /sign in|login/i.test(r.error)) {
      return safeEdit(ctx, m.message_id, '❌ Kamu belum login ke Google Antigravity. Jalankan /login dulu yaa.', { parse_mode: 'Markdown' });
    }
    return safeEdit(ctx, m.message_id, `⚠️ \`${esc(r.error).slice(0, 1500)}\``, { parse_mode: 'Markdown' });
  }
  const lines = r.models.map(x => `• \`${esc(x.id)}\` — ${esc(x.label).slice(0, 60)}`).join('\n').slice(0, 3500) || '(kosong)';
  return safeEdit(ctx, m.message_id, `🤖 *Model Antigravity yang Tersedia:*\n\n${lines}\n\nGunakan \`/model <nama>\` untuk memilih.`, { parse_mode: 'Markdown' });
});

bot.command('model', async (ctx) => {
  const arg = (ctx.message.text || '').split(/\s+/).slice(1).join(' ').trim();
  const s = getSession(ctx.chat.id);
  if (!arg) {
    return safeReply(ctx, `Model saat ini: \`${esc(s.model)}\`\n\nUntuk mengganti:\n\`/model gemini-3.8-flash-medium\`\nLihat pilihan: /models`, { parse_mode: 'Markdown' });
  }
  s.model = arg;
  persist();
  return safeReply(ctx, `✅ Model untuk chat ini diset ke \`${esc(arg)}\``, { parse_mode: 'Markdown' });
});

bot.command('mode', async (ctx) => {
  const arg = (ctx.message.text || '').split(/\s+/)[1]?.toLowerCase().trim();
  const s = getSession(ctx.chat.id);
  const validModes = ['auto', 'plan', 'accept-edits'];
  if (!arg || !validModes.includes(arg)) {
    return safeReply(ctx, `Mode saat ini: \`${esc(s.mode || 'auto')}\`\n\nPilihan mode:\n• \`auto\` — Eksekusi otomatis\n• \`plan\` — Hanya rencana tanpa edit file\n• \`accept-edits\` — Langsung menerima perubahan kode\n\nContoh: \`/mode plan\``, { parse_mode: 'Markdown' });
  }
  s.mode = arg;
  persist();
  return safeReply(ctx, `✅ Mode agent diset ke \`${esc(arg)}\``, { parse_mode: 'Markdown' });
});

bot.command('effort', async (ctx) => {
  const arg = (ctx.message.text || '').split(/\s+/)[1]?.toLowerCase().trim();
  const s = getSession(ctx.chat.id);
  const valid = ['low', 'medium', 'high', 'xhigh', 'max'];
  if (!arg || !valid.includes(arg)) {
    return safeReply(ctx, `Reasoning effort saat ini: \`${esc(s.effort || 'medium')}\`\n\nPilihan:\n\`low\`, \`medium\`, \`high\`, \`xhigh\`, \`max\`\n\nContoh: \`/effort high\``, { parse_mode: 'Markdown' });
  }
  s.effort = arg;
  persist();
  return safeReply(ctx, `✅ Reasoning effort diset ke \`${esc(arg)}\``, { parse_mode: 'Markdown' });
});

bot.command('agent', async (ctx) => {
  const uctx = getContext(ctx);
  const arg = (ctx.message.text || '').split(/\s+/).slice(1).join(' ').trim();
  const s = getSession(ctx.chat.id);
  if (arg === 'reset' || arg === 'default') {
    s.agent = null;
    persist();
    return safeReply(ctx, '✅ Agent di-reset ke default.');
  }
  if (arg) {
    s.agent = arg;
    persist();
    return safeReply(ctx, `✅ Agent aktif diset ke: \`${esc(arg)}\``, { parse_mode: 'Markdown' });
  }
  const r = await agy.listAgents(uctx);
  const info = r.ok ? (r.raw.trim() || 'Tidak ada agent khusus yang terdaftar.') : (r.error || 'Gagal mengambil agent.');
  return safeReply(ctx, `🤖 *Agents:*\nAgent saat ini: \`${esc(s.agent || 'default')}\`\n\n\`\`\`\n${esc(info)}\n\`\`\`\n\nUntuk set: \`/agent <nama>\` atau \`/agent reset\``, { parse_mode: 'Markdown' });
});

// Persona settings
function renderPersonaMenu(ctx) {
  const s = getSession(ctx.chat.id);
  const current = s.persona ? `"${esc(s.persona)}"` : '_(Default / Standar Antigravity)_';
  const keyboard = Markup.inlineKeyboard([
    [
      { ...Markup.button.callback(PERSONA_PRESETS.cute.label, 'persona:cute'), style: 'primary' },
      { ...Markup.button.callback(PERSONA_PRESETS.coder.label, 'persona:coder'), style: 'primary' }
    ],
    [
      { ...Markup.button.callback(PERSONA_PRESETS.minimal.label, 'persona:minimal'), style: 'primary' },
      { ...Markup.button.callback(PERSONA_PRESETS.tutor.label, 'persona:tutor'), style: 'primary' }
    ],
    [
      { ...Markup.button.callback('✏️ Tulis Custom Sendiri', 'persona:custom'), style: 'success' },
      { ...Markup.button.callback('🔄 Reset ke Default', 'persona:reset'), style: 'danger' }
    ]
  ]);

  return {
    text: `🎭 *Personalisasi Karakter & Gaya Bahasa AI*\n\n` +
      `Karakter saat ini:\n${current}\n\n` +
      `Pilih salah satu preset di bawah ini atau buat prompt karakter bebas sesuai keinginanmu!\n\n` +
      `_Tips:_ Kamu juga bisa langsung ketik: \`/persona <prompt karakter kamu>\``,
    keyboard
  };
}

bot.command(['persona', 'character', 'personality', 'prompt'], async (ctx) => {
  const arg = (ctx.message.text || '').split(/\s+/).slice(1).join(' ').trim();
  const s = getSession(ctx.chat.id);

  if (arg === 'reset' || arg === 'default') {
    s.persona = null;
    persist();
    return safeReply(ctx, '🔄 *Persona karakter telah di-reset ke default.*', { parse_mode: 'Markdown' });
  }

  if (arg) {
    s.persona = arg;
    persist();
    return safeReply(ctx,
      `✅ *Persona Karakter Berhasil Disimpan!*\n\n` +
      `_Prompt:_ "${esc(arg)}"\n\n` +
      `Mulai sekarang AI akan berbicara mengikuti gaya bahasa tersebut. Coba sapa AI di chat! ✨`,
      { parse_mode: 'Markdown' }
    );
  }

  const menu = renderPersonaMenu(ctx);
  return safeReply(ctx, menu.text, { parse_mode: 'Markdown', ...menu.keyboard });
});

bot.action(/persona:(cute|coder|minimal|tutor)/, async (ctx) => {
  const type = ctx.match[1];
  const preset = PERSONA_PRESETS[type];
  if (!preset) return;

  const s = getSession(ctx.chat.id);
  s.persona = preset.prompt;
  persist();

  const msgId = ctx.callbackQuery?.message?.message_id;
  const replyText = `✅ *Karakter Diubah ke: ${preset.title}*\n\n_Prompt:_\n"${preset.prompt}"\n\nAI sekarang akan berbicara sesuai gaya ini! ✨`;
  if (msgId) {
    await safeEdit(ctx, msgId, replyText, { parse_mode: 'Markdown' });
  } else {
    await safeReply(ctx, replyText, { parse_mode: 'Markdown' });
  }
});

bot.action('persona:reset', async (ctx) => {
  const s = getSession(ctx.chat.id);
  s.persona = null;
  persist();
  const msgId = ctx.callbackQuery?.message?.message_id;
  if (msgId) {
    await safeEdit(ctx, msgId, '🔄 *Persona karakter telah di-reset ke default Antigravity.*', { parse_mode: 'Markdown' });
  } else {
    await safeReply(ctx, '🔄 *Persona karakter telah di-reset ke default Antigravity.*', { parse_mode: 'Markdown' });
  }
});

bot.action('persona:custom', async (ctx) => {
  const chatId = String(ctx.chat.id);
  chatSteps.set(chatId, 'awaiting_persona');
  const cancelBtn = Markup.inlineKeyboard([
    [{ ...Markup.button.callback('❌ Batal', 'cancel_step'), style: 'danger' }]
  ]);
  const msgId = ctx.callbackQuery?.message?.message_id;
  const promptText = `✍️ *Kirimkan prompt karakter yang kamu inginkan:*\n\n` +
    `Contoh:\n` +
    `• _"Kamu adalah teman ngobrol perempuan imut yang perhatian, penyayang, suka pakai kata 'hehe', dan sangat paham coding."_\n` +
    `• _"Gunakan bahasa gaul Jakarta santai (gue/lu) dan to-the-point."_\n\n` +
    `Kirimkan teksnya langsung di chat ini (atau klik Batal):`;

  if (msgId) {
    await safeEdit(ctx, msgId, promptText, { parse_mode: 'Markdown', ...cancelBtn });
  } else {
    await safeReply(ctx, promptText, { parse_mode: 'Markdown', ...cancelBtn });
  }
});

bot.action('cancel_step', async (ctx) => {
  const chatId = String(ctx.chat.id);
  chatSteps.delete(chatId);
  const msgId = ctx.callbackQuery?.message?.message_id;
  if (msgId) {
    await safeEdit(ctx, msgId, '❌ Pengaturan dibatalkan.');
  } else {
    await safeReply(ctx, '❌ Pengaturan dibatalkan.');
  }
});

// GitHub & Vercel auth
bot.command(['githubauth', 'ghauth'], async (ctx) => {
  const uctx = getContext(ctx);
  const token = (ctx.message.text || '').split(/\s+/).slice(1).join(' ').trim();
  const chatId = String(ctx.chat.id);

  if (token) {
    try { await ctx.deleteMessage(); } catch {}
    const wait = await ctx.reply('⏳ Menghubungkan akun GitHub…');
    const res = await agy.loginGithub(uctx, token);
    if (!res.ok) {
      return safeEdit(ctx, wait.message_id, `⚠️ Gagal menghubungkan akun GitHub:\n\`${esc(res.error)}\``, { parse_mode: 'Markdown' });
    }
    return safeEdit(ctx, wait.message_id,
      `🐙 *Akun GitHub Berhasil Terhubung!*\n\n` +
      `• Username: \`@${esc(res.user?.login || 'ok')}\`\n` +
      `• Nama: \`${esc(res.user?.name || '-')}\`\n` +
      `• Email: \`${esc(res.user?.email || '-')}\`\n\n` +
      `Sekarang agent Antigravity dapat mengakses repositori, clone private repo, membuat commit, dan mengelola issue/PR. ✨`,
      { parse_mode: 'Markdown' }
    );
  }

  const current = await agy.checkGithubAuth(uctx);
  if (current.ok) {
    return safeReply(ctx,
      `🐙 *Status GitHub: Terhubung*\n\n` +
      `• Akun aktif: \`@${esc(current.user?.login || 'ok')}\`\n\n` +
      `Untuk mengganti token, ketik:\n\`/githubauth <personal_access_token>\``,
      { parse_mode: 'Markdown' }
    );
  }

  chatSteps.set(chatId, 'awaiting_github_token');
  const cancelBtn = Markup.inlineKeyboard([
    [{ ...Markup.button.callback('❌ Batal', 'cancel_step'), style: 'danger' }]
  ]);
  return safeReply(ctx,
    `🐙 *Hubungkan Akun GitHub*\n\n` +
    `Kirimkan Personal Access Token (PAT) GitHub kamu:\n\n` +
    `1. Buat token di [github.com/settings/tokens](https://github.com/settings/tokens)\n` +
    `2. Pilih scope: \`repo\`, \`read:org\`, \`workflow\`, \`gist\`\n` +
    `3. Salin token (misal \`ghp_...\`), lalu kirimkan langsung ke chat ini.\n\n` +
    `_Pesan berisi token akan langsung dihapus bot demi keamanan._`,
    { parse_mode: 'Markdown', disable_web_page_preview: true, ...cancelBtn }
  );
});

bot.command(['vercelauth', 'vcauth'], async (ctx) => {
  const uctx = getContext(ctx);
  const token = (ctx.message.text || '').split(/\s+/).slice(1).join(' ').trim();
  const chatId = String(ctx.chat.id);

  if (token) {
    try { await ctx.deleteMessage(); } catch {}
    const wait = await ctx.reply('⏳ Menghubungkan akun Vercel…');
    const res = await agy.loginVercel(uctx, token);
    if (!res.ok) {
      return safeEdit(ctx, wait.message_id, `⚠️ Gagal menghubungkan akun Vercel:\n\`${esc(res.error)}\``, { parse_mode: 'Markdown' });
    }
    return safeEdit(ctx, wait.message_id,
      `▲ *Akun Vercel Berhasil Terhubung!*\n\n` +
      `• Akun: \`${esc(res.username)}\`\n\n` +
      `Sekarang agent Antigravity dapat mendeploy aplikasi serverless, melihat projects, dan mengelola konfigurasi Vercel secara otomatis! 🚀`,
      { parse_mode: 'Markdown' }
    );
  }

  const current = await agy.checkVercelAuth(uctx);
  if (current.ok) {
    return safeReply(ctx,
      `▲ *Status Vercel: Terhubung*\n\n` +
      `• Akun aktif: \`${esc(current.username)}\`\n\n` +
      `Untuk mengganti token, ketik:\n\`/vercelauth <token_vercel>\``,
      { parse_mode: 'Markdown' }
    );
  }

  chatSteps.set(chatId, 'awaiting_vercel_token');
  const cancelBtn = Markup.inlineKeyboard([
    [{ ...Markup.button.callback('❌ Batal', 'cancel_step'), style: 'danger' }]
  ]);
  return safeReply(ctx,
    `▲ *Hubungkan Akun Vercel*\n\n` +
    `Kirimkan Vercel Access Token kamu:\n\n` +
    `1. Buat token di [vercel.com/account/tokens](https://vercel.com/account/tokens)\n` +
    `2. Salin token lalu kirimkan langsung ke chat ini.\n\n` +
    `_Pesan berisi token akan langsung dihapus bot demi keamanan._`,
    { parse_mode: 'Markdown', disable_web_page_preview: true, ...cancelBtn }
  );
});

bot.command(['new', 'clear', 'reset'], async (ctx) => {
  const k = String(ctx.chat.id);
  const old = sessions[k] || {};
  sessions[k] = {
    history: [],
    model: old.model || DEFAULT_MODEL,
    mode: old.mode || DEFAULT_MODE,
    effort: old.effort || DEFAULT_EFFORT,
    agent: old.agent || null,
    persona: old.persona || null, // Pertahankan persona pengguna
    conversationId: null,
    createdAt: Date.now()
  };
  persist();
  return safeReply(ctx, '🧹 Riwayat percakapan telah dibersihkan. Memulai sesi baru.');
});

// Skills
bot.command('skills', async (ctx) => {
  const uctx = getContext(ctx);
  const r = await agy.listSkills(uctx);
  if (!r.ok) return safeReply(ctx, `⚠️ Gagal membaca skills: ${esc(r.error)}`);
  return safeReply(ctx,
    `📚 *Daftar Skills Antigravity (${r.count || 0}):*\n\n${esc(r.raw)}\n\n` +
    `• Lihat instruksi: \`/skill <nama>\`\n` +
    `• Tambah skill baru: \`/addskills <link repo github>\`\n` +
    `• Hapus skill: \`/rmskill <nama>\``,
    { parse_mode: 'Markdown' }
  );
});

bot.command('skill', async (ctx) => {
  const uctx = getContext(ctx);
  const name = (ctx.message.text || '').split(/\s+/)[1]?.trim();
  if (!name) return safeReply(ctx, 'Gunakan: `/skill <nama_skill>`\nLihat daftar: /skills', { parse_mode: 'Markdown' });
  const r = await agy.getSkillDetail(uctx, name);
  if (!r.ok) return safeReply(ctx, `⚠️ ${esc(r.error)}`);
  return safeReply(ctx, `📄 *Skill: \`${esc(name)}\`*\n\n\`\`\`markdown\n${esc(r.content)}\n\`\`\``, { parse_mode: 'Markdown' });
});

bot.command(['addskills', 'addskill'], async (ctx) => {
  const uctx = getContext(ctx);
  const arg = (ctx.message.text || '').split(/\s+/).slice(1).join(' ').trim();
  const chatId = String(ctx.chat.id);

  if (!arg) {
    chatSteps.set(chatId, 'awaiting_skill_repo');
    const cancelBtn = Markup.inlineKeyboard([
      [{ ...Markup.button.callback('❌ Batal', 'cancel_step'), style: 'danger' }]
    ]);
    return safeReply(ctx,
      `📦 *Tambah Skill Baru dari GitHub*\n\n` +
      `Kirimkan link repository GitHub yang ingin kamu pasang:\n` +
      `Contoh: \`https://github.com/owner/nama-skill\` atau \`owner/nama-skill\`\n\n` +
      `_Atau ketik langsung:_ \`/addskills <link github>\``,
      { parse_mode: 'Markdown', ...cancelBtn }
    );
  }

  const waitMsg = await ctx.reply(`⏳ Mengunduh dan memasang skill dari \`${esc(arg)}\`…`, { parse_mode: 'Markdown' });
  const res = await agy.addSkillFromGit(uctx, arg);

  if (!res.ok) {
    return safeEdit(ctx, waitMsg.message_id, `⚠️ Gagal menambahkan skill:\n\`${esc(res.error)}\``, { parse_mode: 'Markdown' });
  }

  const list = res.installed.map(s => `• \`${esc(s.name)}\` — ${esc(s.title || s.name)}`).join('\n');
  return safeEdit(ctx, waitMsg.message_id,
    `✅ *Skill Berhasil Ditambahkan!*\n\n` +
    `Sumber: \`${esc(res.url)}\`\n` +
    `Skill terpasang:\n${list}\n\n` +
    `Gunakan \`/skill <nama>\` untuk membaca instruksi, atau \`/skills\` untuk melihat semua skill. ✨`,
    { parse_mode: 'Markdown' }
  );
});

bot.command(['rmskill', 'delskill'], async (ctx) => {
  const uctx = getContext(ctx);
  const name = (ctx.message.text || '').split(/\s+/)[1]?.trim();
  if (!name) return safeReply(ctx, 'Gunakan: `/rmskill <nama_skill>`\nLihat daftar: /skills', { parse_mode: 'Markdown' });
  const res = await agy.removeSkill(uctx, name);
  if (!res.ok) return safeReply(ctx, `⚠️ Skill \`${esc(name)}\` tidak ditemukan.`, { parse_mode: 'Markdown' });
  return safeReply(ctx, `🗑 Skill \`${esc(name)}\` berhasil dihapus.`, { parse_mode: 'Markdown' });
});

// Plugin commands
bot.command('plugin', async (ctx) => {
  const uctx = getContext(ctx);
  const parts = (ctx.message.text || '').split(/\s+/).slice(1);
  const sub = (parts[0] || 'list').toLowerCase();

  if (sub === 'list' || sub === 'ls') {
    const r = await agy.listPlugins(uctx);
    return safeReply(ctx, `🔌 *Plugins Terpasang:*\n\`\`\`\n${esc(r.raw || r.error || 'Tidak ada plugin.')}\n\`\`\``, { parse_mode: 'Markdown' });
  }

  if (sub === 'install') {
    const target = parts[1];
    if (!target) return safeReply(ctx, 'Gunakan: `/plugin install <target|git_url>`', { parse_mode: 'Markdown' });
    const wait = await ctx.reply(`⏳ Memasang plugin \`${esc(target)}\`…`);
    const res = await agy.pluginInstall(uctx, target);
    return safeEdit(ctx, wait.message_id, `🔌 *Hasil Install Plugin:*\n\`\`\`\n${esc(res.output || (res.ok ? 'Sukses' : 'Gagal'))}\n\`\`\``, { parse_mode: 'Markdown' });
  }

  if (sub === 'uninstall' || sub === 'remove') {
    const name = parts[1];
    if (!name) return safeReply(ctx, 'Gunakan: `/plugin uninstall <nama_plugin>`', { parse_mode: 'Markdown' });
    const wait = await ctx.reply(`⏳ Menghapus plugin \`${esc(name)}\`…`);
    const res = await agy.pluginUninstall(uctx, name);
    return safeEdit(ctx, wait.message_id, `🗑 *Hasil Hapus Plugin:*\n\`\`\`\n${esc(res.output || (res.ok ? 'Sukses' : 'Gagal'))}\n\`\`\``, { parse_mode: 'Markdown' });
  }

  if (sub === 'enable') {
    const name = parts[1];
    if (!name) return safeReply(ctx, 'Gunakan: `/plugin enable <nama_plugin>`', { parse_mode: 'Markdown' });
    const res = await agy.pluginEnable(uctx, name);
    return safeReply(ctx, `\`\`\`\n${esc(res.output || (res.ok ? 'Aktif' : 'Gagal'))}\n\`\`\``, { parse_mode: 'Markdown' });
  }

  if (sub === 'disable') {
    const name = parts[1];
    if (!name) return safeReply(ctx, 'Gunakan: `/plugin disable <nama_plugin>`', { parse_mode: 'Markdown' });
    const res = await agy.pluginDisable(uctx, name);
    return safeReply(ctx, `\`\`\`\n${esc(res.output || (res.ok ? 'Nonaktif' : 'Gagal'))}\n\`\`\``, { parse_mode: 'Markdown' });
  }

  return safeReply(ctx, 'Format: `/plugin list` | `/plugin install <target>` | `/plugin uninstall <nama>` | `/plugin enable <nama>` | `/plugin disable <nama>`', { parse_mode: 'Markdown' });
});

// MCP commands
bot.command('mcp', async (ctx) => {
  const uctx = getContext(ctx);
  const parts = (ctx.message.text || '').split(/\s+/).slice(1);
  const sub = (parts[0] || 'list').toLowerCase();

  if (sub === 'list' || sub === 'ls') {
    const r = await agy.listMcp(uctx);
    return safeReply(ctx, `🌐 *MCP Servers:*\n\`\`\`\n${esc(r.raw || r.error || 'Tidak ada MCP server.')}\n\`\`\``, { parse_mode: 'Markdown' });
  }

  if (sub === 'add') {
    const name = parts[1];
    const cmdOrUrl = parts[2];
    const restArgs = parts.slice(3);
    if (!name || !cmdOrUrl) {
      return safeReply(ctx, 'Gunakan:\n`/mcp add <nama> <commandOrUrl> [args...]`\n\nContoh:\n`/mcp add fs npx -y @modelcontextprotocol/server-filesystem /tmp`', { parse_mode: 'Markdown' });
    }
    const wait = await ctx.reply(`⏳ Menambahkan MCP server \`${esc(name)}\`…`);
    const res = await agy.mcpAdd(uctx, name, cmdOrUrl, restArgs);
    return safeEdit(ctx, wait.message_id, `🌐 *Hasil MCP Add:*\n\`\`\`\n${esc(res.output || (res.ok ? 'Sukses' : 'Gagal'))}\n\`\`\``, { parse_mode: 'Markdown' });
  }

  if (sub === 'remove' || sub === 'rm') {
    const name = parts[1];
    if (!name) return safeReply(ctx, 'Gunakan: `/mcp remove <nama_server>`', { parse_mode: 'Markdown' });
    const wait = await ctx.reply(`⏳ Menghapus MCP server \`${esc(name)}\`…`);
    const res = await agy.mcpRemove(uctx, name);
    return safeEdit(ctx, wait.message_id, `🌐 *Hasil MCP Remove:*\n\`\`\`\n${esc(res.output || (res.ok ? 'Sukses' : 'Gagal'))}\n\`\`\``, { parse_mode: 'Markdown' });
  }

  if (sub === 'enable') {
    const name = parts[1];
    if (!name) return safeReply(ctx, 'Gunakan: `/mcp enable <nama_server>`', { parse_mode: 'Markdown' });
    const res = await agy.mcpEnable(uctx, name);
    return safeReply(ctx, `\`\`\`\n${esc(res.output || (res.ok ? 'Aktif' : 'Gagal'))}\n\`\`\``, { parse_mode: 'Markdown' });
  }

  if (sub === 'disable') {
    const name = parts[1];
    if (!name) return safeReply(ctx, 'Gunakan: `/mcp disable <nama_server>`', { parse_mode: 'Markdown' });
    const res = await agy.mcpDisable(uctx, name);
    return safeReply(ctx, `\`\`\`\n${esc(res.output || (res.ok ? 'Nonaktif' : 'Gagal'))}\n\`\`\``, { parse_mode: 'Markdown' });
  }

  return safeReply(ctx, 'Format:\n• `/mcp list`\n• `/mcp add <nama> <commandOrUrl> [args...]`\n• `/mcp remove <nama>`', { parse_mode: 'Markdown' });
});

// Workspace files
bot.command(['files', 'ls', 'workspace'], async (ctx) => {
  const dir = wsDir(ctx.chat.id);
  const files = listFiles(dir);
  if (!files.length) return safeReply(ctx, `📁 Workspace masih kosong.\n\`${esc(dir)}\``, { parse_mode: 'Markdown' });
  const lines = files.slice(0, 25).map(f => `${f.isDir ? '📁' : '📄'} \`${esc(f.name)}\` — ${f.isDir ? 'dir' : humanSize(f.size)}`).join('\n');
  const more = files.length > 25 ? `\n… +${files.length - 25} lainnya` : '';
  return safeReply(ctx, `📁 *Workspace:* \`${esc(dir)}\` (${files.length} berkas)\n\n${lines}${more}\n\nKetik: \`/get <nama>\` untuk unduh, \`/cat <nama>\` untuk baca teks.`, { parse_mode: 'Markdown' });
});

bot.command(['get', 'send', 'download'], async (ctx) => {
  const arg = (ctx.message.text || '').split(/\s+/).slice(1).join(' ').trim().replace(/^["']|["']$/g, '');
  if (!arg) return safeReply(ctx, 'Gunakan: `/get <nama file>`\nLihat berkas: /files', { parse_mode: 'Markdown' });
  const dir = wsDir(ctx.chat.id);
  const target = path.resolve(dir, arg);
  if (!target.startsWith(dir + path.sep) && target !== dir) return safeReply(ctx, '⛔ Path tidak valid.');
  try {
    const st = fs.statSync(target);
    if (st.isDirectory()) return safeReply(ctx, '⛔ Itu folder, bukan file.');
    if (st.size > 45 * 1024 * 1024) return safeReply(ctx, `⛔ Berkas terlalu besar (${humanSize(st.size)}), batas pengiriman Telegram ~50MB.`);
  } catch { return safeReply(ctx, `⛔ Berkas tidak ditemukan: \`${esc(arg)}\`\nPeriksa di /files`, { parse_mode: 'Markdown' }); }
  try {
    await ctx.replyWithDocument({ source: target, filename: path.basename(target) }, { caption: `📄 ${path.basename(target)} (${humanSize(fs.statSync(target).size)})` });
  } catch (e) { await safeReply(ctx, `⚠️ Gagal kirim file: ${esc(String(e).slice(0, 600))}`); }
});

bot.command('cat', async (ctx) => {
  const arg = (ctx.message.text || '').split(/\s+/).slice(1).join(' ').trim().replace(/^["']|["']$/g, '');
  if (!arg) return safeReply(ctx, 'Gunakan: `/cat <nama file>` (khusus teks)', { parse_mode: 'Markdown' });
  const dir = wsDir(ctx.chat.id);
  const target = path.resolve(dir, arg);
  if (!target.startsWith(dir + path.sep) && target !== dir) return safeReply(ctx, '⛔ Path tidak valid.');
  try {
    const st = fs.statSync(target);
    if (st.size > 1024*1024) return safeReply(ctx, `⛔ Berkas ${humanSize(st.size)} terlalu besar untuk /cat, gunakan /get untuk unduh.`);
    const txt = fs.readFileSync(target, 'utf8').slice(0, 3500);
    return safeReply(ctx, `📄 \`${esc(arg)}\`:\n\`\`\`\n${esc(txt)}\n\`\`\``, { parse_mode: 'Markdown' });
  } catch (e) { return safeReply(ctx, `⚠️ ${esc(String(e).slice(0, 600))}`); }
});

bot.command('rm', async (ctx) => {
  const arg = (ctx.message.text || '').split(/\s+/).slice(1).join(' ').trim().replace(/^["']|["']$/g, '');
  if (!arg) return safeReply(ctx, 'Gunakan: `/rm <nama file>`', { parse_mode: 'Markdown' });
  const dir = wsDir(ctx.chat.id);
  const target = path.resolve(dir, arg);
  if (!target.startsWith(dir + path.sep)) return safeReply(ctx, '⛔ Path tidak valid.');
  try {
    fs.rmSync(target, { recursive: true, force: true });
    return safeReply(ctx, `🗑 Berkas dihapus: \`${esc(arg)}\``, { parse_mode: 'Markdown' });
  } catch (e) { return safeReply(ctx, `⚠️ Gagal menghapus: ${esc(String(e).slice(0, 600))}`); }
});

// Cancel command
bot.command('cancel', async (ctx) => {
  const chatId = String(ctx.chat.id);
  let didCancel = false;

  // 1. Cancel active agy execution process
  if (activeProcesses.has(chatId)) {
    const proc = activeProcesses.get(chatId);
    try { proc.cancel(); } catch {}
    activeProcesses.delete(chatId);
    busy.delete(chatId);
    didCancel = true;
  }

  // 2. Cancel pending OAuth login
  if (pendingLogins.has(chatId)) {
    const pLogin = pendingLogins.get(chatId);
    clearTimeout(pLogin._codeTimer);
    try { pLogin.kill(); } catch {}
    pendingLogins.delete(chatId);
    didCancel = true;
  }

  // 3. Cancel interactive input step (e.g. persona input)
  if (chatSteps.has(chatId)) {
    chatSteps.delete(chatId);
    didCancel = true;
  }

  if (didCancel) {
    return safeReply(ctx, '🛑 *Proses berhasil dibatalkan.*', { parse_mode: 'Markdown' });
  }
  return safeReply(ctx, 'ℹ️ Tidak ada proses yang sedang berjalan.');
});

// Button callbacks
bot.action('cancel_proc', async (ctx) => {
  const chatId = String(ctx.chat.id);
  if (activeProcesses.has(chatId)) {
    const proc = activeProcesses.get(chatId);
    try { proc.cancel(); } catch {}
    activeProcesses.delete(chatId);
    busy.delete(chatId);
    const msgId = ctx.callbackQuery?.message?.message_id;
    if (msgId) {
      await safeEdit(ctx, msgId, '🛑 *Proses dibatalkan oleh pengguna.*', { parse_mode: 'Markdown' });
    } else {
      await safeReply(ctx, '🛑 *Proses dibatalkan.*', { parse_mode: 'Markdown' });
    }
    return;
  }
  if (pendingLogins.has(chatId)) {
    const pLogin = pendingLogins.get(chatId);
    clearTimeout(pLogin._codeTimer);
    try { pLogin.kill(); } catch {}
    pendingLogins.delete(chatId);
    const msgId = ctx.callbackQuery?.message?.message_id;
    if (msgId) {
      await safeEdit(ctx, msgId, '🛑 *Sesi login dibatalkan.*', { parse_mode: 'Markdown' });
    } else {
      await safeReply(ctx, '🛑 *Sesi login dibatalkan.*', { parse_mode: 'Markdown' });
    }
    return;
  }
  return safeReply(ctx, 'ℹ️ Proses sudah selesai atau tidak ada yang aktif.');
});

bot.action('act:accept', async (ctx) => {
  await safeReply(ctx, '✅ *Melanjutkan / Menerima rekomendasi…*', { parse_mode: 'Markdown' });
  return handleAgyRequest(ctx, 'Ya, saya setuju. Lanjutkan dan jalankan perubahannya.');
});

bot.action('act:reject', async (ctx) => {
  return safeReply(ctx, '❌ *Aksi dibatalkan.*', { parse_mode: 'Markdown' });
});

bot.action('act:files', async (ctx) => {
  const dir = wsDir(ctx.chat.id);
  const files = listFiles(dir);
  if (!files.length) return safeReply(ctx, `📁 Workspace masih kosong.\n\`${esc(dir)}\``, { parse_mode: 'Markdown' });
  const lines = files.slice(0, 15).map(f => `${f.isDir ? '📁' : '📄'} \`${esc(f.name)}\` (${f.isDir ? 'dir' : humanSize(f.size)})`).join('\n');
  return safeReply(ctx, `📁 *Workspace:* \`${esc(dir)}\`\n\n${lines}\n\nUnduh: /get <nama>`, { parse_mode: 'Markdown' });
});

bot.action('act:new', async (ctx) => {
  const k = String(ctx.chat.id);
  const old = sessions[k] || {};
  sessions[k] = {
    history: [],
    model: old.model || DEFAULT_MODEL,
    mode: old.mode || DEFAULT_MODE,
    effort: old.effort || DEFAULT_EFFORT,
    agent: old.agent || null,
    conversationId: null,
    createdAt: Date.now()
  };
  persist();
  return safeReply(ctx, '🧹 Riwayat percakapan telah dibersihkan. Memulai sesi baru.');
});

// Owner panel & broadcast
async function sendOwnerPanel(ctx) {
  if (!isOwner(ctx)) {
    return safeReply(ctx, '⛔ Panel ini khusus untuk Owner.');
  }
  const isPub = getIsPublic();
  const allUsers = users.getAllUserIds();
  const accList = accounts.listAccounts(getContext(ctx));
  const activeAcc = accounts.getActiveAccount(getContext(ctx));

  const text =
    `👑 <b>PANEL OWNER ${escHtml(BOT_NAME.toUpperCase())}</b>\n\n` +
    `<blockquote>` +
    `• <b>Nama Bot:</b> <code>${escHtml(BOT_NAME)}</code>\n` +
    `• <b>Watermark Chat:</b> <code>${escHtml(CHAT_WATERMARK || '(Nonaktif)')}</code>\n` +
    `• <b>Mode Akses Bot:</b> ${isPub ? '🟢 <b>PUBLIC</b> (Semua pengguna bisa akses)' : '🔴 <b>PRIVATE</b> (Hanya ALLOWED_USERS)'}\n` +
    `• <b>Total Pengguna Terdaftar:</b> <code>${allUsers.length} user</code>\n` +
    `• <b>Akun Antigravity:</b> <code>${escHtml(activeAcc?.email || 'Belum ada')}</code> (${accList.length} akun)\n` +
    `• <b>Owner ID:</b> <code>${escHtml(OWNER_ID)}</code>` +
    `</blockquote>\n\n` +
    `Pilih pengaturan di bawah untuk mengubah mode atau broadcast ke semua user:`;

  const keyboard = Markup.inlineKeyboard([
    [
      isPub
        ? { ...Markup.button.callback('🔴 Matikan Public (Private Mode)', 'owner:set_public:no'), style: 'danger' }
        : { ...Markup.button.callback('🟢 Hidupkan Public (Semua Akses)', 'owner:set_public:yes'), style: 'success' }
    ],
    [
      { ...Markup.button.callback('📢 Broadcast Pesan', 'owner:broadcast'), style: 'primary' }
    ],
    [
      { ...Markup.button.callback('🔙 Kembali ke Menu', 'act:back_menu') }
    ]
  ]);

  if (ctx.callbackQuery) {
    const msg = ctx.callbackQuery.message;
    if (msg?.photo) {
      try {
        return await ctx.telegram.editMessageCaption(ctx.chat.id, msg.message_id, undefined, text, {
          parse_mode: 'HTML',
          ...keyboard
        });
      } catch {}
    } else {
      try {
        return await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, text, {
          parse_mode: 'HTML',
          ...keyboard
        });
      } catch {}
    }
  }
  return safeReply(ctx, text, { parse_mode: 'HTML', ...keyboard });
}

async function executeBroadcast(ctx, messageOrText, opts = {}) {
  if (!isOwner(ctx)) return safeReply(ctx, '⛔ Hanya owner yang dapat melakukan broadcast.');
  const allUserIds = [...new Set([...users.getAllUserIds(), ...ALLOWED])].filter(Boolean);
  if (!allUserIds.length) {
    return safeReply(ctx, '⚠️ Tidak ada pengguna terdaftar untuk menerima broadcast.');
  }

  const raw = (messageOrText || '').trim();
  const watermark = '📢 *Broadcast dari Creator*';
  const broadcastBody = raw ? `${raw}\n\n${watermark}` : watermark;

  const watermarkPlain = '📢 Broadcast dari Creator';
  const broadcastBodyPlain = raw ? `${raw}\n\n${watermarkPlain}` : watermarkPlain;

  const waitMsg = await ctx.reply(`📢 Memulai broadcast ke *${allUserIds.length}* pengguna…`, { parse_mode: 'Markdown' });
  let success = 0;
  let failed = 0;

  for (const uid of allUserIds) {
    try {
      if (opts.photoId) {
        await ctx.telegram.sendPhoto(uid, opts.photoId, {
          caption: broadcastBody.slice(0, 1020),
          parse_mode: 'Markdown'
        }).catch(async () => {
          await ctx.telegram.sendPhoto(uid, opts.photoId, { caption: broadcastBodyPlain.slice(0, 1020) });
        });
      } else {
        await ctx.telegram.sendMessage(uid, broadcastBody, {
          parse_mode: 'Markdown'
        }).catch(async () => {
          await ctx.telegram.sendMessage(uid, broadcastBodyPlain);
        });
      }
      success++;
    } catch (err) {
      failed++;
    }
    // Rate limit safety: 40ms pause between sends
    await new Promise(r => setTimeout(r, 40));
  }

  return safeEdit(ctx, waitMsg.message_id,
    `✅ *Broadcast Selesai Dikirim!*\n\n` +
    `• Berhasil terkirim: *${success}* user\n` +
    `• Gagal / Ditolak / Diblokir: *${failed}* user\n` +
    `• Total sasaran: *${allUserIds.length}* user`,
    { parse_mode: 'Markdown' }
  );
}

bot.command('owner', sendOwnerPanel);

bot.command('broadcast', async (ctx) => {
  if (!isOwner(ctx)) return safeReply(ctx, '⛔ Perintah ini khusus untuk Owner.');
  const text = ctx.message.text.replace(/^\/broadcast(@\w+)?\s*/i, '').trim();
  if (!text) {
    chatSteps.set(String(ctx.chat.id), 'awaiting_broadcast');
    return safeReply(ctx,
      `📢 *Kirim Pesan Broadcast*\n\n` +
      `Silakan kirimkan teks atau media yang ingin di-broadcast ke semua pengguna bot.\n` +
      `Ketik \`/cancel\` untuk membatalkan.`,
      { parse_mode: 'Markdown' }
    );
  }
  return executeBroadcast(ctx, text);
});

bot.action('act:owner', sendOwnerPanel);

bot.action(/^owner:set_public:(yes|no)$/, async (ctx) => {
  if (!isOwner(ctx)) return;
  const wantPublic = ctx.match[1] === 'yes';
  setIsPublic(wantPublic);
  const statusStr = wantPublic ? '🟢 Mode Public diaktifkan!' : '🔴 Mode Private diaktifkan!';
  try {
    await ctx.answerCbQuery(statusStr);
  } catch {}
  return sendOwnerPanel(ctx);
});

bot.action('owner:broadcast', async (ctx) => {
  if (!isOwner(ctx)) return;
  chatSteps.set(String(ctx.chat.id), 'awaiting_broadcast');
  return safeReply(ctx,
    `📢 *Kirim Pesan Broadcast*\n\n` +
    `Silakan kirimkan teks atau media yang ingin di-broadcast ke semua pengguna bot sekarang.\n` +
    `Ketik \`/cancel\` untuk membatalkan.`,
    { parse_mode: 'Markdown' }
  );
});

bot.action('act:back_menu', async (ctx) => {
  if (ctx.callbackQuery?.message) {
    try { await ctx.telegram.deleteMessage(ctx.chat.id, ctx.callbackQuery.message.message_id); } catch {}
  }
  return sendMenuCard(ctx);
});

// OAuth & multi-account
async function startLoginFlow(ctx, isAddAccount = false) {
  const chatId = String(ctx.chat.id);
  const uctx = getContext(ctx);
  if (pendingLogins.has(chatId)) {
    return safeReply(ctx, '⏳ Sesi login masih menunggu. Tempel kode `4/0AX...` atau kirim /cancel untuk batal.', { parse_mode: 'Markdown' });
  }

  const titlePrefix = isAddAccount ? '➕ *Tambah Akun Google Antigravity Cadangan*' : '🔐 *Login Google Antigravity*';
  const intro = await ctx.reply('⏳ Menyiapkan sesi OAuth Google Antigravity…');

  let login;
  try {
    login = agy.startLoginPTY({ userContext: uctx, isNewAccount: isAddAccount });
  } catch (e) {
    return safeEdit(ctx, intro.message_id, `⚠️ Gagal memulai proses PTY: ${esc(String(e).slice(0, 800))}`);
  }

  login.isAddAccount = isAddAccount;
  login.userContext = uctx;
  pendingLogins.set(chatId, login);

  const url = await login.waitUrl(9000);
  if (!url) {
    login.kill();
    pendingLogins.delete(chatId);
    const q = await agy.getQuota(uctx).catch(() => null);
    if (q?.ok && !isAddAccount) return safeEdit(ctx, intro.message_id, '✅ Akun sudah login dan kuota aktif (/quota OK). Tidak perlu login ulang.');
    return safeEdit(ctx, intro.message_id,
      `⚠️ Gagal menangkap URL autentikasi (timeout).\n\n` +
      `Pastikan utilitas \`script\` terpasang di sistem (\`which script\`).\n` +
      `Raw buffer:\n\`\`\`\n${esc(login.buf).slice(0, 1500)}\n\`\`\``, { parse_mode: 'Markdown' });
  }

  const codeTimer = setTimeout(async () => {
    if (!pendingLogins.has(chatId)) return;
    pendingLogins.delete(chatId);
    try { login.kill(); } catch {}
    try { await ctx.reply('⌛ Batas waktu login habis (60s). Jalankan /login lagi untuk membuat tautan baru.'); } catch {}
  }, 75_000);
  login._codeTimer = codeTimer;

  const loginKeyboard = Markup.inlineKeyboard([
    [{ ...Markup.button.url('🔗 Login dengan Google Antigravity', url), style: 'primary' }],
    [{ ...Markup.button.callback('❌ Batal Login', 'cancel_proc'), style: 'danger' }]
  ]);

  await safeEdit(ctx, intro.message_id,
    `${titlePrefix}\n\n` +
    `1. Klik tombol *Login dengan Google Antigravity* di bawah ini.\n` +
    `2. Masuk menggunakan akun Google ${isAddAccount ? 'cadangan ' : ''}yang memiliki langganan Antigravity.\n` +
    `3. Salin *kode autentikasi* (\`4/0AX...\`) atau *seluruh URL callback* (\`https://antigravity.google/oauth-callback?code=4/...\`).\n` +
    `4. Kirimkan langsung ke chat ini dalam 60 detik.`,
    { parse_mode: 'Markdown', disable_web_page_preview: true, ...loginKeyboard }
  );

  login.waitResult(70_000).then(async (res) => {
    if (!pendingLogins.has(chatId)) return;
    clearTimeout(codeTimer);
    pendingLogins.delete(chatId);
    const q = await agy.getQuota(uctx).catch(() => ({ ok: false }));
    if (q.ok) {
      const saveRes = accounts.saveCurrentTokenAsAccount(uctx);
      const email = saveRes.account?.email || 'Akun Google';
      if (isAddAccount) {
        await safeReply(ctx,
          `✅ *Akun Google Cadangan Berhasil Ditambahkan!*\n\n` +
          `• Email: \`${esc(email)}\`\n` +
          `• Status: \`Ready\`\n` +
          `• Total Terdaftar: \`${saveRes.totalAccounts || 1}\` akun\n\n` +
          `Fitur *Auto-Failover* aktif: Jika akun aktif kamu mencapai batas kuota, bot akan otomatis beralih ke akun ini! ✨`,
          { parse_mode: 'Markdown' }
        );
      } else {
        await safeReply(ctx,
          `✅ *Login Berhasil!*\n\n` +
          `• Akun: \`${esc(email)}\`\n\n` +
          `\`\`\`\n${esc(String(q.j?.response || 'Kuota OK')).slice(0, 1500)}\n\`\`\``,
          { parse_mode: 'Markdown' }
        );
      }
    } else {
      await safeReply(ctx, `Proses login selesai (exit ${res.code}).\n\`\`\`\n${esc(res.out).slice(0, 2000)}\n\`\`\`\n` + (q.error ? `\nCek Kuota: \`${esc(String(q.error).slice(0, 500))}\`` : ''), { parse_mode: 'Markdown' });
    }
  }).catch(async (e) => {
    clearTimeout(codeTimer);
    pendingLogins.delete(chatId);
    await safeReply(ctx, `⚠️ Kendala saat login: ${esc(String(e).slice(0, 800))}`);
  });
}

bot.command('login', async (ctx) => {
  const arg = (ctx.message.text || '').split(/\s+/)[1]?.toLowerCase();
  const isForce = arg === 'force' || arg === 'new' || arg === 'ulang';
  return startLoginFlow(ctx, isForce);
});
bot.command(['addaccount', 'addacc'], async (ctx) => startLoginFlow(ctx, true));

bot.command(['listaccount', 'listaccounts', 'accounts', 'accs'], async (ctx) => {
  const uctx = getContext(ctx);
  const accList = accounts.listAccounts(uctx);
  if (!accList.length) {
    return safeReply(ctx, 'Belum ada akun Antigravity yang terdaftar. Jalankan /login atau /addaccount.', { parse_mode: 'Markdown' });
  }

  const rows = accList.map(a => {
    const isAct = a.isActive ? '🟢 *(Aktif)*' : '⚪ *(Cadangan)*';
    const statusText = a.status === 'limited' ? '🔴 Limit Kuota' : '✅ Ready';
    return `${a.index}. ${isAct} \`${esc(a.email)}\`\n   • Status: ${statusText}`;
  }).join('\n\n');

  const keyboard = Markup.inlineKeyboard([
    [
      { ...Markup.button.callback('➕ Tambah Akun', 'act:addaccount'), style: 'success' },
      { ...Markup.button.callback('🔄 Cek Kuota', 'act:quota'), style: 'primary' }
    ]
  ]);

  return safeReply(ctx,
    `👥 *Daftar Akun Antigravity (${accList.length} Akun):*\n\n` +
    `${rows}\n\n` +
    `_⚡ Auto-Failover:_ Aktif (Otomatis ganti akun jika limit)\n` +
    `_Ganti manual:_ \`/switchaccount <nomor|email>\`\n` +
    `_Hapus akun:_ \`/delaccount <nomor|email>\``,
    { parse_mode: 'Markdown', ...keyboard }
  );
});

bot.command(['switchaccount', 'switchacc'], async (ctx) => {
  const uctx = getContext(ctx);
  const arg = (ctx.message.text || '').split(/\s+/).slice(1).join(' ').trim();
  if (!arg) {
    return safeReply(ctx, 'Gunakan: `/switchaccount <nomor|email>`\nLihat daftar akun: /listaccount', { parse_mode: 'Markdown' });
  }
  const res = accounts.switchAccount(uctx, arg);
  if (!res.ok) {
    return safeReply(ctx, `⚠️ ${esc(res.error)}\nLihat daftar: /listaccount`, { parse_mode: 'Markdown' });
  }
  return safeReply(ctx, `✅ *Akun aktif berhasil dialihkan ke:* \`${esc(res.account.email)}\``, { parse_mode: 'Markdown' });
});

bot.command(['delaccount', 'delacc', 'rmaccount'], async (ctx) => {
  const uctx = getContext(ctx);
  const arg = (ctx.message.text || '').split(/\s+/).slice(1).join(' ').trim();
  if (!arg) {
    return safeReply(ctx, 'Gunakan: `/delaccount <nomor|email>`\nLihat daftar akun: /listaccount', { parse_mode: 'Markdown' });
  }
  const res = accounts.removeAccount(uctx, arg);
  if (!res.ok) {
    return safeReply(ctx, `⚠️ ${esc(res.error)}\nLihat daftar: /listaccount`, { parse_mode: 'Markdown' });
  }
  return safeReply(ctx, `🗑 Akun \`${esc(res.removed.email)}\` berhasil dihapus. (Tersisa ${res.totalAccounts} akun terdaftar)`, { parse_mode: 'Markdown' });
});

bot.action('act:addaccount', async (ctx) => {
  return startLoginFlow(ctx, true);
});

bot.action('act:quota', async (ctx) => {
  const uctx = getContext(ctx);
  const m = await ctx.reply('⏳ Memeriksa kuota…');
  const q = await agy.getQuota(uctx);
  if (q.ok) {
    const detail = q.j?.response ? String(q.j.response).slice(0, 3000) : JSON.stringify(q.j, null, 2).slice(0, 3000);
    return safeEdit(ctx, m.message_id, `✅ *Informasi Kuota:*\n\`\`\`\n${esc(detail)}\n\`\`\``, { parse_mode: 'Markdown' });
  }
  return safeEdit(ctx, m.message_id, `⚠️ Gagal cek kuota: \`${esc(q.error)}\``, { parse_mode: 'Markdown' });
});

// File uploads
async function saveFileFromCtx(ctx) {
  const dir = wsDir(ctx.chat.id);
  let fileId = null, fileName = null;

  const m = ctx.message;
  if (m.document) {
    fileId = m.document.file_id;
    fileName = m.document.file_name || `file-${Date.now()}`;
  } else if (m.photo) {
    const p = m.photo[m.photo.length - 1];
    fileId = p.file_id;
    fileName = `photo-${Date.now()}.jpg`;
  } else if (m.video) {
    fileId = m.video.file_id;
    fileName = m.video.file_name || `video-${Date.now()}.mp4`;
  } else if (m.animation) {
    fileId = m.animation.file_id;
    fileName = m.animation.file_name || `anim-${Date.now()}.mp4`;
  } else if (m.audio) {
    fileId = m.audio.file_id;
    fileName = m.audio.file_name || `audio-${Date.now()}.mp3`;
  } else if (m.voice) {
    fileId = m.voice.file_id;
    fileName = `voice-${Date.now()}.ogg`;
  } else if (m.video_note) {
    fileId = m.video_note.file_id;
    fileName = `videonote-${Date.now()}.mp4`;
  } else if (m.sticker) {
    fileId = m.sticker.file_id;
    const ext = m.sticker.is_video ? 'webm' : m.sticker.is_animated ? 'tgs' : 'webp';
    fileName = `sticker-${Date.now()}.${ext}`;
  } else return null;

  const link = await ctx.telegram.getFileLink(fileId);
  const res = await fetch(link.href);
  const buf = Buffer.from(await res.arrayBuffer());
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  let dest = path.join(dir, safe);
  let i = 1;
  while (fs.existsSync(dest)) {
    const ext = path.extname(safe), base = path.basename(safe, ext);
    dest = path.join(dir, `${base}_${i}${ext}`);
    i++;
  }
  fs.writeFileSync(dest, buf);
  return { dest, fileName: path.basename(dest), size: buf.length, href: link.href };
}

// Execute prompt
async function handleAgyRequest(ctx, userText, opts = {}) {
  const chatId = String(ctx.chat.id);
  if (busy.has(chatId)) {
    await safeReply(ctx, '⏳ Masih memproses permintaan sebelumnya. Gunakan /cancel jika ingin membatalkan.');
    return;
  }
  busy.add(chatId);

  const uctx = getContext(ctx);
  const s = getSession(chatId);
  const dir = wsDir(chatId);
  const startMs = Date.now();
  const model = s.model || DEFAULT_MODEL;

  const tgCtx = buildTelegramContext(ctx, dir, s);
  const extra = opts.fileHint ? `\n[BERKAS] ${opts.fileHint}\n` : '';
  const histSlice = s.history.slice(-20);
  let prompt;
  if (!histSlice.length) {
    prompt = `${tgCtx}\n${extra}\nUser: ${userText}`;
  } else {
    const conv = histSlice.map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`).join('\n\n');
    prompt = `${tgCtx}\nRiwayat percakapan:\n${conv}\n${extra}\nUser: ${userText}\nAssistant:`;
  }

  const cancelKeyboard = Markup.inlineKeyboard([
    [{ ...Markup.button.callback('🛑 Batalkan', 'cancel_proc'), style: 'danger' }]
  ]);

  let msg = null;
  try {
    msg = await ctx.reply('💭 Sedang memikir.', cancelKeyboard);
  } catch {}

  let full = '';
  let currentTool = null;
  let toolCalls = [];
  let lastEdit = 0;
  let isDone = false;
  let dotCount = 0;
  let isEditing = false;

  const scheduleProgressEdit = async () => {
    if (isDone || !msg || isEditing) return;
    const now = Date.now();
    if (now - lastEdit < 1000) return;
    lastEdit = now;
    isEditing = true;

    let content = '';
    const dots = '.'.repeat((dotCount % 6) + 1);
    if (full) {
      const snippet = full.slice(0, 3600);
      const toolNote = currentTool ? `\n\n_⚡ Tool: \`${esc(currentTool)}\`…_` : '';
      content = snippet + toolNote;
    } else if (currentTool) {
      content = `💭 *Sedang memikir${dots}*\n⚡ Menjalankan: \`${esc(currentTool)}\``;
    } else {
      content = `💭 *Sedang memikir${dots}*`;
    }

    try {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        msg.message_id,
        undefined,
        content,
        { parse_mode: 'Markdown', ...cancelKeyboard }
      );
    } catch (err) {
      if (err.message && err.message.includes('message is not modified')) return;
      try {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          msg.message_id,
          undefined,
          content.replace(/[*_`]/g, ''),
          cancelKeyboard
        );
      } catch {}
    } finally {
      isEditing = false;
    }
  };

  const progressInterval = setInterval(() => {
    if (isDone) {
      clearInterval(progressInterval);
      return;
    }
    dotCount++;
    scheduleProgressEdit();
  }, 1200);

  try {
    const runner = agy.runPrompt({
      userContext: uctx,
      prompt,
      workspaceDir: dir,
      model,
      mode: s.mode,
      effort: s.effort,
      agent: s.agent,
      onDelta: (delta, acc) => {
        full = acc;
        scheduleProgressEdit();
      },
      onTool: (name) => {
        currentTool = name;
        if (!toolCalls.includes(name)) toolCalls.push(name);
        scheduleProgressEdit();
      }
    });

    activeProcesses.set(chatId, runner);
    const res = await runner;

    isDone = true;
    clearInterval(progressInterval);
    activeProcesses.delete(chatId);
    busy.delete(chatId);

    // Handled user cancellation
    if (res.cancelled) {
      if (msg) await safeEdit(ctx, msg.message_id, '🛑 *Proses dibatalkan oleh pengguna.*', { parse_mode: 'Markdown' });
      return;
    }

    if (res.needLogin) {
      if (msg) await safeEdit(ctx, msg.message_id, `🔐 Belum login Antigravity. Jalankan /login terlebih dahulu.\n\`${esc(res.error).slice(0, 800)}\``, { parse_mode: 'Markdown' });
      else await safeReply(ctx, `🔐 Belum login. Jalankan /login terlebih dahulu.\n${esc(res.error).slice(0, 800)}`);
      return;
    }

    // Auto-Failover: jika akun terkena limit kuota, beralih ke akun cadangan secara otomatis
    const isRateLimited = res.quota || /quota|rate limit|resource_exhausted|429|limit reached|out of credits/i.test(res.error || '');
    if (isRateLimited) {
      const currentAcc = accounts.getActiveAccount(uctx);
      if (currentAcc) {
        accounts.markAccountLimited(uctx, currentAcc.id);
      }
      const next = accounts.getNextAvailableAccount(uctx, currentAcc?.id);
      if (next.ok) {
        const switchText = `⚠️ *Akun \`${esc(currentAcc?.email || 'utama')}\` mencapai limit kuota.*\n🔄 *Otomatis beralih ke akun cadangan: \`${esc(next.account.email)}\`…*`;
        if (msg) {
          try {
            await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, switchText, { parse_mode: 'Markdown' });
          } catch {}
        } else {
          try { await ctx.reply(switchText, { parse_mode: 'Markdown' }); } catch {}
        }
        await new Promise(r => setTimeout(r, 1200));
        return handleAgyRequest(ctx, userText, { ...opts, retriedWithNextAccount: true });
      } else {
        const allAccs = accounts.listAccounts(uctx);
        const errDesc = `❌ *Semua Akun Antigravity Telah Mencapai Limit*\n\n` +
          `Semua ${allAccs.length} akun yang terdaftar telah mencapai batas kuota pemakaian.\n\n` +
          `• Tambah akun cadangan: \`/addaccount\`\n` +
          `• Cek daftar akun: \`/listaccount\``;
        if (msg) await safeEdit(ctx, msg.message_id, errDesc, { parse_mode: 'Markdown' });
        else await safeReply(ctx, errDesc, { parse_mode: 'Markdown' });
        return;
      }
    }

    if (!res.ok) {
      const err = (res.error || res.stderr || 'unknown').slice(0, 1500);
      if (msg) await safeEdit(ctx, msg.message_id, `⚠️ Kendala pada agy:\n\`\`\`\n${esc(err)}\n\`\`\``, { parse_mode: 'Markdown' });
      else await safeReply(ctx, `⚠️ Kendala pada agy:\n${esc(err)}`);
      return;
    }

    full = res.text || full || '(kosong)';
    s.history.push({ role: 'user', content: userText.slice(0, 4000) + (opts.fileHint ? `\n[${opts.fileHint}]` : '') });
    s.history.push({ role: 'assistant', content: full.slice(0, 8000) });
    if (res.conversationId) s.conversationId = res.conversationId;
    persist();

    // Only show approval buttons if the message explicitly asks for confirmation before executing
    const endsWithApprovalQuestion = /\b(apakah kamu setuju|apakah anda setuju|konfirmasi untuk melanjutkan|apakah ingin saya terapkan|lanjutkan eksekusi\?)\b/i.test(full.trim().slice(-200));
    const actionButtons = [];
    if (endsWithApprovalQuestion) {
      actionButtons.push([
        { ...Markup.button.callback('✅ Setujui & Lanjutkan', 'act:accept'), style: 'success' },
        { ...Markup.button.callback('❌ Batal', 'act:reject'), style: 'danger' }
      ]);
    }
    actionButtons.push([
      { ...Markup.button.callback('📁 Workspace', 'act:files'), style: 'primary' },
      { ...Markup.button.callback('🔄 Sesi Baru', 'act:new'), style: 'danger' }
    ]);
    const finalKeyboard = Markup.inlineKeyboard(actionButtons);

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    const toolSummary = toolCalls.length ? ` • 🔧 ${toolCalls.slice(0, 3).join(', ')}${toolCalls.length > 3 ? ` (+${toolCalls.length - 3})` : ''}` : '';
    const wm = CHAT_WATERMARK ? `\n${esc(CHAT_WATERMARK)}` : '';
    const footer = `\n\n_⏱ ${elapsed}s • \`${esc(model)}\`${toolSummary}_${wm}`;

    const chunks = chunkText(full, 3700);

    if (msg && chunks.length === 1) {
      await safeEdit(ctx, msg.message_id, esc(chunks[0]) + footer, { parse_mode: 'Markdown', ...finalKeyboard });
    } else {
      if (msg) {
        try { await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id); } catch {}
      }
      for (let i = 0; i < chunks.length; i++) {
        const isLast = (i === chunks.length - 1);
        if (isLast) {
          await safeReply(ctx, esc(chunks[i]) + footer, { parse_mode: 'Markdown', ...finalKeyboard });
        } else {
          await safeReply(ctx, esc(chunks[i]));
        }
      }
    }

    const doneTime = new Date().toLocaleTimeString('id-ID', { hour12: false });
    console.log(`\x1b[90m[${doneTime}]\x1b[0m \x1b[32m[DONE]\x1b[0m   User: \x1b[1m${chatId}\x1b[0m | Duration: \x1b[32m${elapsed}s\x1b[0m | Tools: \x1b[33m${toolCalls.length}\x1b[0m`);

    // Auto-send files newly created during this turn
    try {
      const newFiles = findNewFiles(dir, startMs);
      const uploadedBase = opts.uploadedFile ? path.basename(opts.uploadedFile) : null;
      const toSend = newFiles.filter(f => f.path !== opts.uploadedFile && f.name !== uploadedBase);
      const mentionsFile = /file|berkas|disimpan|saved|workspace|\.pdf|\.png|\.jpg|\.zip|\.txt|\.docx|\.xlsx|\.mp4|\.json|\.js|\.ts|\.py/i.test(full);
      const shouldSend = toSend.length > 0 && (mentionsFile || toSend.length <= 2);
      if (shouldSend) {
        for (const f of toSend.slice(0, 3)) {
          if (f.size > 45*1024*1024) continue;
          try {
            await ctx.replyWithDocument({ source: f.path, filename: f.name }, { caption: `📄 ${f.name} (${humanSize(f.size)})` });
          } catch {}
        }
      }
    } catch {}

  } catch (e) {
    isDone = true;
    clearInterval(progressInterval);
    activeProcesses.delete(chatId);
    busy.delete(chatId);
    const err = String(e.stack || e).slice(0, 1500);
    if (msg) try { await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `💥 Terjadi kendala:\n\`\`\`\n${esc(err)}\n\`\`\``, { parse_mode: 'Markdown' }); } catch {}
    else await ctx.reply(`💥 Terjadi kendala: ${esc(err)}`);
  }
}

// File message handler
async function handleFileMessage(ctx) {
  try {
    const chatId = String(ctx.chat.id);
    if (chatSteps.get(chatId) === 'awaiting_broadcast') {
      chatSteps.delete(chatId);
      const photo = ctx.message.photo ? ctx.message.photo.slice(-1)[0] : null;
      const caption = (ctx.message.caption || '').trim();
      if (photo) {
        return executeBroadcast(ctx, caption, { photoId: photo.file_id });
      }
    }

    const m = await ctx.reply('⏳ Menyimpan berkas…');
    const saved = await saveFileFromCtx(ctx);
    if (!saved) return safeEdit(ctx, m.message_id, '⚠️ Gagal menyimpan berkas.');
    const caption = (ctx.message.caption || '').trim();
    const dir = wsDir(ctx.chat.id);
    const s = getSession(ctx.chat.id);
    s.history.push({ role: 'user', content: `[file: ${saved.fileName} (${humanSize(saved.size)}) -> ${saved.dest}${caption ? ` | caption: ${caption}` : ''}]` });
    persist();

    await safeEdit(ctx, m.message_id,
      `✅ Disimpan: \`${esc(saved.fileName)}\` (${humanSize(saved.size)})\n` +
      `Lokasi: \`${esc(saved.dest)}\`\n` +
      (caption ? `Catatan: ${esc(caption)}\n` : '') +
      `Aksi: /cat ${saved.fileName} | /get ${saved.fileName}`, { parse_mode: 'Markdown' });

    if (caption) {
      const hint = `Berkas baru diunggah: ${saved.fileName} (${humanSize(saved.size)}) di ${saved.dest}. Instruksi: "${caption}". Analisis/proses berkas sesuai kebutuhan (workspace: ${dir}).`;
      setTimeout(() => handleAgyRequest(ctx, caption, { fileHint: hint, uploadedFile: saved.dest }), 400);
    }
  } catch (e) {
    await safeReply(ctx, `⚠️ Gagal memproses berkas: ${esc(String(e).slice(0, 800))}`);
  }
}

bot.on(['document', 'photo', 'video', 'animation', 'audio', 'voice', 'video_note', 'sticker'], handleFileMessage);

// Text message handler
bot.on('text', async (ctx, next) => {
  const chatId = String(ctx.chat.id);
  const uctx = getContext(ctx);
  const textRaw = ctx.message.text || '';
  const trimmed = textRaw.trim();

  // Intercept broadcast message step
  if (chatSteps.get(chatId) === 'awaiting_broadcast') {
    chatSteps.delete(chatId);
    if (trimmed.startsWith('/cancel') || trimmed.toLowerCase() === 'batal') {
      return safeReply(ctx, '🛑 *Broadcast dibatalkan.*', { parse_mode: 'Markdown' });
    }
    return executeBroadcast(ctx, textRaw);
  }

  // 1. Intercept custom persona setting step
  if (chatSteps.get(chatId) === 'awaiting_persona') {
    if (trimmed.startsWith('/')) {
      chatSteps.delete(chatId);
      // Let command proceed
    } else {
      chatSteps.delete(chatId);
      const s = getSession(chatId);
      s.persona = trimmed;
      persist();
      return safeReply(ctx,
        `✅ *Karakter Persona Berhasil Disimpan!*\n\n` +
        `_Prompt:_ "${esc(trimmed)}"\n\n` +
        `Mulai sekarang AI akan berbicara dengan gaya tersebut. Coba sapa AI! ✨`,
        { parse_mode: 'Markdown' }
      );
    }
  }

  // 2. Intercept git skill repository link input
  if (chatSteps.get(chatId) === 'awaiting_skill_repo') {
    if (trimmed.startsWith('/')) {
      chatSteps.delete(chatId);
      // Let command proceed
    } else {
      chatSteps.delete(chatId);
      const waitMsg = await ctx.reply(`⏳ Mengunduh dan memasang skill dari \`${esc(trimmed)}\`…`, { parse_mode: 'Markdown' });
      const res = await agy.addSkillFromGit(uctx, trimmed);
      if (!res.ok) {
        return safeEdit(ctx, waitMsg.message_id, `⚠️ Gagal menambahkan skill:\n\`${esc(res.error)}\``, { parse_mode: 'Markdown' });
      }
      const list = res.installed.map(s => `• \`${esc(s.name)}\` — ${esc(s.title || s.name)}`).join('\n');
      return safeEdit(ctx, waitMsg.message_id,
        `✅ *Skill Berhasil Ditambahkan!*\n\n` +
        `Sumber: \`${esc(res.url)}\`\n` +
        `Skill terpasang:\n${list}\n\n` +
        `Gunakan \`/skill <nama>\` untuk membaca instruksi, atau \`/skills\` untuk melihat semua skill. ✨`,
        { parse_mode: 'Markdown' }
      );
    }
  }

  // 3. Intercept github token input
  if (chatSteps.get(chatId) === 'awaiting_github_token') {
    try { await ctx.deleteMessage(); } catch {}
    if (trimmed.startsWith('/')) {
      chatSteps.delete(chatId);
    } else {
      chatSteps.delete(chatId);
      const wait = await ctx.reply('⏳ Menghubungkan akun GitHub…');
      const res = await agy.loginGithub(uctx, trimmed);
      if (!res.ok) {
        return safeEdit(ctx, wait.message_id, `⚠️ Gagal menghubungkan akun GitHub:\n\`${esc(res.error)}\``, { parse_mode: 'Markdown' });
      }
      return safeEdit(ctx, wait.message_id,
        `🐙 *Akun GitHub Berhasil Terhubung!*\n\n` +
        `• Username: \`@${esc(res.user?.login || 'ok')}\`\n` +
        `• Nama: \`${esc(res.user?.name || '-')}\`\n\n` +
        `Agent Antigravity sekarang memiliki akses ke GitHub kamu! ✨`,
        { parse_mode: 'Markdown' }
      );
    }
  }

  // 4. Intercept vercel token input
  if (chatSteps.get(chatId) === 'awaiting_vercel_token') {
    try { await ctx.deleteMessage(); } catch {}
    if (trimmed.startsWith('/')) {
      chatSteps.delete(chatId);
    } else {
      chatSteps.delete(chatId);
      const wait = await ctx.reply('⏳ Menghubungkan akun Vercel…');
      const res = await agy.loginVercel(uctx, trimmed);
      if (!res.ok) {
        return safeEdit(ctx, wait.message_id, `⚠️ Gagal menghubungkan akun Vercel:\n\`${esc(res.error)}\``, { parse_mode: 'Markdown' });
      }
      return safeEdit(ctx, wait.message_id,
        `▲ *Akun Vercel Berhasil Terhubung!*\n\n` +
        `• Akun: \`${esc(res.username)}\`\n\n` +
        `Agent Antigravity sekarang dapat mendeploy proyek ke Vercel! 🚀`,
        { parse_mode: 'Markdown' }
      );
    }
  }

  // 2. Intercept code paste when OAuth login is pending
  const pending = pendingLogins.get(chatId);
  if (pending) {
    let code = null;
    const urlMatch = trimmed.match(/https?:\/\/antigravity\.google\/oauth-callback[^\s]*/i);
    if (urlMatch) {
      try {
        const u = new URL(urlMatch[0]);
        code = u.searchParams.get('code');
      } catch {}
      if (!code) {
        const m2 = urlMatch[0].match(/[?&]code=([^&]+)/);
        if (m2) code = decodeURIComponent(m2[1]);
      }
    }
    if (!code) {
      const bare = trimmed.match(/4\/[0-9A-Za-z_\-]{20,}/);
      if (bare) code = bare[0];
    }
    if (code) {
      try {
        clearTimeout(pending._codeTimer);
        await safeReply(ctx, `📥 Kode otorisasi diterima (\`${esc(code.slice(0, 16))}…\`), meneruskan ke agy…`, { parse_mode: 'Markdown' });
        pending.sendCode(code);
        const res = await pending.waitResult(65_000);
        pendingLogins.delete(String(ctx.chat.id));
        const q = await agy.getQuota(uctx).catch(() => ({ ok: false, error: 'Gagal cek kuota' }));
        if (q.ok) {
          const saveRes = accounts.saveCurrentTokenAsAccount(uctx);
          const email = saveRes.account?.email || 'Akun Google';
          await safeReply(ctx, `✅ *Login Google Antigravity Berhasil!*\n• Akun: \`${esc(email)}\`\n\`\`\`\n${esc(String(q.j?.response || 'OK')).slice(0, 1500)}\n\`\`\``, { parse_mode: 'Markdown' });
        } else {
          await safeReply(ctx, `Proses PTY selesai (exit ${res.code}).\n\`\`\`\n${esc(res.out).slice(0, 2000)}\n\`\`\`\nKuota: ${esc(String(q.error || res.out).slice(0, 800))}`, { parse_mode: 'Markdown' });
        }
      } catch (e) {
        pendingLogins.delete(String(ctx.chat.id));
        await safeReply(ctx, `⚠️ Gagal memproses kode: ${esc(String(e).slice(0, 800))}`);
      }
      return;
    }
    if (trimmed.startsWith('/')) {
      // Let command execute (e.g. /cancel)
    } else {
      await safeReply(ctx, '⏳ Menunggu kode login. Tempel kode `4/0AX...` atau kirim /cancel untuk batal.');
      return;
    }
  }

  if (!trimmed.startsWith('/')) {
    handleAgyRequest(ctx, trimmed).catch(err => console.error('[handleAgyRequest error]', err));
    return;
  }
  return next();
});

// Startup
bot.catch((err, ctx) => {
  console.error('[bot error]', err);
  try { ctx.reply(`💥 ${String(err).slice(0, 800)}`); } catch {}
});

let isBotRunning = false;

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  gray: '\x1b[90m'
};

function printBanner(me, ver) {
  const ascii = String.raw`
   ___   ______ __  __ _    __ _____  __   
  /   | / ____/ \ \/ /| |  / // ____// /   
 / /| |/ / __    \  / | | / // __/  / /    
/ ___ / /_/ /    / /  | |/ // /___ / /___  
/_/  |_\____/   /_/   |___//_____//_____/  `;

  const modeStr = getIsPublic() ? `${ANSI.green}Public${ANSI.reset}` : `${ANSI.yellow}Private${ANSI.reset}`;
  console.log(ANSI.cyan + ANSI.bold + ascii + ANSI.reset);
  console.log(ANSI.magenta + ANSI.bold + '       AGYVEL — Telegram Antigravity Bot' + ANSI.reset);
  console.log(ANSI.gray + '────────────────────────────────────────────────────' + ANSI.reset);
  console.log(ANSI.gray + ' • ' + ANSI.cyan + 'Bot Name   ' + ANSI.reset + ': ' + ANSI.bold + `${BOT_NAME} (@${me.username})` + ANSI.reset);
  console.log(ANSI.gray + ' • ' + ANSI.cyan + 'Agy CLI    ' + ANSI.reset + ': ' + ANSI.green + `v${ver.version || 'unknown'}` + ANSI.reset);
  console.log(ANSI.gray + ' • ' + ANSI.cyan + 'Model      ' + ANSI.reset + ': ' + ANSI.yellow + DEFAULT_MODEL + ANSI.reset);
  console.log(ANSI.gray + ' • ' + ANSI.cyan + 'Access     ' + ANSI.reset + ': ' + modeStr + ANSI.gray + (getIsPublic() ? ' (Semua orang)' : ` (${ALLOWED.length} Whitelist)`) + ANSI.reset);
  console.log(ANSI.gray + ' • ' + ANSI.cyan + 'Watermark  ' + ANSI.reset + ': ' + (CHAT_WATERMARK ? ANSI.dim + CHAT_WATERMARK + ANSI.reset : ANSI.gray + '(Nonaktif)' + ANSI.reset));
  console.log(ANSI.gray + ' • ' + ANSI.cyan + 'Status     ' + ANSI.reset + ': ' + ANSI.green + ANSI.bold + 'Online & Ready!' + ANSI.reset);
  console.log(ANSI.gray + '────────────────────────────────────────────────────' + ANSI.reset);
}

async function main() {
  try {
    // Pastikan agy CLI terpasang (auto-install via native Node.js untuk Pterodactyl egg)
    try {
      const setup = require('./setup.js');
      await setup.ensureAgyInstalled();
    } catch (e) {
      console.warn('[agy-telegram-bot] Peringatan saat cek agy CLI:', e.message);
    }

    const me = await bot.telegram.getMe();
    const ver = await agy.agyVersion().catch(() => ({ version: 'unknown' }));
    printBanner(me, ver);

    bot.launch({ dropPendingUpdates: true });
    isBotRunning = true;
  } catch (err) {
    console.error('[agy-telegram-bot] Gagal memulai bot:', err);
    process.exit(1);
  }
}

process.once('SIGINT', () => {
  if (isBotRunning) {
    try { bot.stop('SIGINT'); } catch {}
  }
  process.exit(0);
});
process.once('SIGTERM', () => {
  if (isBotRunning) {
    try { bot.stop('SIGTERM'); } catch {}
  }
  process.exit(0);
});

main();