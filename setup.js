#!/usr/bin/env node
/*Creator : Vellzyyy
 * Channel Creator : https://whatsapp.com/channel/0029VbDl6c1KmCPJErq9ox3F
 * Disclaimer : 
 * Note : Jangan hapus watermark
*/
// setup.js — CJS bootstrap untuk agy-telegram-bot (didukung penuh untuk VPS & Pterodactyl Egg)
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dns = require('dns');
const crypto = require('crypto');
const zlib = require('zlib');

try { dns.setDefaultResultOrder('ipv4first'); } catch {}

const HOME = os.homedir() || process.env.HOME || '/home/container';
const ROOT = path.resolve(__dirname);
const IS_PTERODACTYL = Boolean(process.env.P_SERVER_UUID || fs.existsSync('/home/container'));

function sh(cmd) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', shell: '/bin/bash' });
}

function has(cmd) {
  try { execSync(`command -v ${cmd} >/dev/null 2>&1`, { stdio: 'ignore' }); return true; } catch { return false; }
}

function needSudo() {
  try { execSync('sudo -n true 2>/dev/null', { stdio: 'ignore' }); return true; } catch { return false; }
}

function detectPlatform() {
  const platform = os.platform();
  const arch = os.arch();

  let osName = platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : platform;
  let archName = arch === 'x64' ? 'amd64' : arch === 'arm64' ? 'arm64' : arch;

  if (osName === 'linux') {
    try {
      if (fs.existsSync('/lib/libc.musl-x86_64.so.1') || fs.existsSync('/lib/libc.musl-aarch64.so.1')) {
        return `linux_${archName}_musl`;
      }
      const lddOut = execSync('ldd /bin/ls 2>&1 || true', { encoding: 'utf8' });
      if (lddOut.includes('musl')) return `linux_${archName}_musl`;
    } catch {}
    return `linux_${archName}`;
  }

  return `${osName}_${archName}`;
}

function extractFileFromTarGz(buffer, targetFileName) {
  try {
    const decompressed = zlib.gunzipSync(buffer);
    let offset = 0;
    while (offset + 512 <= decompressed.length) {
      const header = decompressed.subarray(offset, offset + 512);
      if (header[0] === 0) break;
      const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '').trim();
      const sizeStr = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
      const size = parseInt(sizeStr, 8) || 0;
      offset += 512;
      const baseName = path.basename(name);
      if (baseName === targetFileName || name === targetFileName) {
        return decompressed.subarray(offset, offset + size);
      }
      offset += Math.ceil(size / 512) * 512;
    }
  } catch (err) {
    console.warn('[extractFileFromTarGz] error:', err.message);
  }
  return null;
}

async function installAgyPureNode() {
  console.log('[setup] Mengunduh agy CLI via Pure Node.js (tanpa butuh curl/sudo)…');
  const platform = detectPlatform();
  console.log(`[setup] Platform terdeteksi: ${platform}`);

  const manifestUrl = `https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/${platform}.json`;
  console.log(`[setup] Mengambil manifest: ${manifestUrl}`);

  const manifestRes = await fetch(manifestUrl);
  if (!manifestRes.ok) {
    throw new Error(`Gagal mengambil manifest rilis: HTTP ${manifestRes.status}`);
  }
  const manifest = await manifestRes.json();
  const { version, url, sha512 } = manifest;
  console.log(`[setup] Rilis agy versi v${version}`);
  console.log(`[setup] Mengunduh paket: ${url}`);

  const pkgRes = await fetch(url);
  if (!pkgRes.ok) {
    throw new Error(`Gagal mengunduh paket binary: HTTP ${pkgRes.status}`);
  }

  const arrayBuf = await pkgRes.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  console.log(`[setup] Berkas terunduh: ${(buf.length / (1024 * 1024)).toFixed(2)} MB`);

  // Verifikasi SHA512
  const actualHash = crypto.createHash('sha512').update(buf).digest('hex');
  if (actualHash.toLowerCase() !== sha512.toLowerCase()) {
    throw new Error('Verifikasi SHA512 gagal! Hash tidak cocok.');
  }
  console.log('[setup] ✓ Verifikasi integritas SHA512 berhasil.');

  // Target direktori binary: prioritas ~/.local/bin, lalu ./bin
  const candidateDirs = [
    path.join(HOME, '.local/bin'),
    path.join(ROOT, 'bin')
  ];

  let targetDir = null;
  for (const d of candidateDirs) {
    try {
      fs.mkdirSync(d, { recursive: true });
      fs.accessSync(d, fs.constants.W_OK);
      targetDir = d;
      break;
    } catch {}
  }

  if (!targetDir) {
    targetDir = path.join(ROOT, 'bin');
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const binaryDest = path.join(targetDir, 'agy');

  if (url.endsWith('.tar.gz') || url.includes('.tar.gz')) {
    console.log('[setup] Mengekstrak binary dari archive tar.gz…');
    let extracted = false;
    // Coba tar sistem jika tersedia
    if (has('tar')) {
      const tmpTar = path.join(os.tmpdir(), `agy-${Date.now()}.tar.gz`);
      try {
        fs.writeFileSync(tmpTar, buf);
        execSync(`tar -xzf "${tmpTar}" -C "${targetDir}" antigravity 2>/dev/null && mv "${path.join(targetDir, 'antigravity')}" "${binaryDest}" 2>/dev/null || tar -xzf "${tmpTar}" -C "${targetDir}" agy 2>/dev/null`);
        if (fs.existsSync(binaryDest)) extracted = true;
      } catch {}
      try { fs.unlinkSync(tmpTar); } catch {}
    }

    // Pure Node.js tar parser fallback
    if (!extracted) {
      const binData = extractFileFromTarGz(buf, 'antigravity') || extractFileFromTarGz(buf, 'agy');
      if (!binData) throw new Error('Gagal mengekstrak binary agy dari archive tar.gz');
      fs.writeFileSync(binaryDest, binData, { mode: 0o755 });
    }
  } else {
    fs.writeFileSync(binaryDest, buf, { mode: 0o755 });
  }

  try { fs.chmodSync(binaryDest, 0o755); } catch {}
  console.log(`[setup] ✓ Binary agy CLI berhasil dipasang di: ${binaryDest}`);
  return binaryDest;
}

async function ensureAgyInstalled() {
  const extraPath = `${HOME}/.local/bin:${ROOT}/bin:/usr/local/bin:/home/container/.local/bin`;
  let agyPath = '';
  try {
    agyPath = execSync(`PATH="${extraPath}:${process.env.PATH || ''}" command -v agy 2>/dev/null || which agy 2>/dev/null`, { encoding: 'utf8' }).trim().split('\n')[0]?.trim();
  } catch {}

  const candidates = [
    agyPath,
    path.join(HOME, '.local/bin/agy'),
    path.join(ROOT, 'bin/agy'),
    '/home/container/.local/bin/agy',
    '/usr/local/bin/agy'
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        fs.chmodSync(c, 0o755);
        const out = execSync(`"${c}" --version`, { encoding: 'utf8' }).trim();
        if (require.main === module) {
          console.log(`[setup] agy sudah terpasang: ${c} (${out})`);
        }
        return c;
      } catch {}
    }
  }

  // Jika belum ada, download langsung via Pure Node.js (aman untuk Pterodactyl egg yang tidak punya curl -fsSL)
  return await installAgyPureNode();
}

async function main() {
  console.log(`[setup] HOME=${HOME} ROOT=${ROOT} node=${process.version} pterodactyl=${IS_PTERODACTYL}`);

  // 1. Deps sistem (hanya jika ada akses root / sudo di VPS biasa)
  if (!IS_PTERODACTYL && has('apt-get') && (needSudo() || process.getuid?.() === 0)) {
    try {
      const pkgs = [];
      if (!has('curl')) pkgs.push('curl');
      if (!has('unzip')) pkgs.push('unzip');
      if (!has('script') && !has('script2')) pkgs.push('util-linux');
      if (pkgs.length) {
        console.log(`[setup] Menginstall paket sistem: ${pkgs.join(', ')}`);
        const sudo = needSudo() ? 'sudo ' : '';
        sh(`${sudo}apt-get update -y && ${sudo}apt-get install -y ${pkgs.join(' ')}`);
      }
    } catch (e) {
      console.log(`[setup] Melewati apt-get: ${e.message}`);
    }
  } else {
    console.log('[setup] Lingkungan Pterodactyl / Non-Root: menggunakan native Node.js (melewati apt-get).');
  }

  // 2. Antigravity CLI installation
  const agyPath = await ensureAgyInstalled();

  // 3. NPM Dependencies
  if (!fs.existsSync(path.join(ROOT, 'node_modules/telegraf'))) {
    console.log('[setup] npm install dependencies…');
    sh('npm install --omit=dev');
  } else {
    console.log('[setup] Dependensi npm sudah terpasang.');
  }

  // 4. Konfigurasi .env
  const ex = path.join(ROOT, '.env.example');
  const env = path.join(ROOT, '.env');
  if (!fs.existsSync(env) && fs.existsSync(ex)) {
    fs.copyFileSync(ex, env);
    console.log('[setup] .env dibuat dari .env.example.');
  }

  if (fs.existsSync(env) && agyPath) {
    try {
      let t = fs.readFileSync(env, 'utf8');
      if (/^AGY_COMMAND=\s*$/m.test(t) || !/^AGY_COMMAND=/m.test(t)) {
        if (/^AGY_COMMAND=/m.test(t)) {
          t = t.replace(/^AGY_COMMAND=.*$/m, `AGY_COMMAND=${agyPath}`);
        } else {
          t += `\nAGY_COMMAND=${agyPath}\n`;
        }
        fs.writeFileSync(env, t);
        console.log(`[setup] AGY_COMMAND diperbarui ke: ${agyPath}`);
      }
    } catch {}
  }

  console.log(`
[setup] Selesai dengan sukses! ✨
Untuk menjalankan bot:
  npm start  (atau: node bot.js)
`);
}

module.exports = {
  ensureAgyInstalled,
  installAgyPureNode,
  detectPlatform
};

if (require.main === module) {
  main().catch(err => {
    console.error('[setup fatal error]', err);
    process.exit(1);
  });
}