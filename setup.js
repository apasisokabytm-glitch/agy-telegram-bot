#!/usr/bin/env node
/*Creator : Vellzyyy
 * Channel Creator : https://whatsapp.com/channel/0029VbDl6c1KmCPJErq9ox3F
 * Disclaimer : 
 * Note : Jangan hapus watermark
*/
// setup.js — CJS bootstrap untuk agy-telegram-bot di VPS fresh
// usage: node setup.js  (jalankan dari dalam folder agy-telegram-bot)
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const ROOT = __dirname;

function sh(cmd) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', shell: '/bin/bash' });
}
function has(cmd) {
  try { execSync(`command -v ${cmd} >/dev/null 2>&1`, { stdio: 'ignore' }); return true; } catch { return false; }
}
function needSudo() {
  try { execSync('sudo -n true 2>/dev/null', { stdio: 'ignore' }); return true; } catch { return process.getuid && process.getuid() === 0; }
}

console.log(`[setup] HOME=${HOME} ROOT=${ROOT} node=${process.version}`);

// 1. deps sistem — ponytail: apt only, add when support yum/pacman
const pkgs = [];
if (!has('curl')) pkgs.push('curl');
if (!has('unzip')) pkgs.push('unzip');
if (!has('script') && !has('script2')) { /* util-linux */ pkgs.push('util-linux'); }
if (pkgs.length) {
  console.log(`[setup] install sistem: ${pkgs.join(', ')}`);
  if (needSudo() || has('sudo')) sh(`sudo apt-get update -y && sudo apt-get install -y ${pkgs.join(' ')}`);
  else sh(`apt-get update -y && apt-get install -y ${pkgs.join(' ')}`);
} else console.log('[setup] curl/unzip/script OK');

// 2. agy CLI
let agyPath = '';
try { agyPath = execSync('command -v agy 2>/dev/null || which agy 2>/dev/null', { encoding: 'utf8' }).trim(); } catch {}
if (!agyPath || !fs.existsSync(agyPath)) {
  const cand = path.join(HOME, '.local/bin/agy');
  if (fs.existsSync(cand)) agyPath = cand;
}
if (!agyPath || !fs.existsSync(agyPath)) {
  console.log('[setup] agy belum ada → install via https://antigravity.google/cli/install.sh');
  // ponytail: curl|bash paling simpel, add when butuh verify checksum/signature
  if (has('curl')) sh('curl -fsSL https://antigravity.google/cli/install.sh | bash');
  else sh('wget -qO- https://antigravity.google/cli/install.sh | bash');
  // coba detect lagi
  try { agyPath = execSync(`PATH="${HOME}/.local/bin:$PATH" command -v agy 2>/dev/null`, { encoding: 'utf8' }).trim(); } catch {}
  console.log(`[setup] agy → ${agyPath || 'cek manual: ls ~/.local/bin/agy; exec $SHELL -l; which agy'}`);
} else console.log(`[setup] agy OK → ${agyPath}`);
try { execSync(`"${agyPath || 'agy'}" --version`, { stdio: 'inherit' }); } catch {}

// 3. npm deps
console.log('[setup] npm install...');
sh('npm install');

// 4. .env
const ex = path.join(ROOT, '.env.example');
const env = path.join(ROOT, '.env');
if (!fs.existsSync(env) && fs.existsSync(ex)) {
  fs.copyFileSync(ex, env);
  console.log(`[setup] .env dibuat dari .env.example → edit dulu:`);
  console.log(`  nano ${env}`);
} else if (fs.existsSync(env)) console.log('[setup] .env sudah ada');
else console.log('[setup] .env.example tidak ketemu, buat manual');

// auto isi AGY_COMMAND kalau kosong
try {
  let t = fs.readFileSync(env, 'utf8');
  if (/^AGY_COMMAND=\s*$/m.test(t) && agyPath) {
    t = t.replace(/^AGY_COMMAND=.*$/m, `AGY_COMMAND=${agyPath}`);
    fs.writeFileSync(env, t);
    console.log(`[setup] AGY_COMMAND diisi → ${agyPath}`);
  }
} catch {}

// 5. ringkasan
console.log(`
[setup] selesai. Selanjutnya:
  1) nano .env  → isi TELEGRAM_BOT_TOKEN (buat baru di @BotFather, jangan pakai token Hermes)
                 ALLOWED_USERS=ID_Telegram_kamu
                 AGY_COMMAND=${agyPath || '$HOME/.local/bin/agy'}
  2) npm start  (atau pm2 start ecosystem.config.js)
  3) di Telegram: /login → buka link → paste code 4/0AX... balik (60s)
  4) /quota harus SUCCESS, lalu chat biasa
  Cek: which agy; agy --version; agy -p=/quota --output-format json
`);
