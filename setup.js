#!/usr/bin/env node
/*
 * Agy telegram bot 
 * Creator : Vellzyy
 * Channel Whatsapp : https://whatsapp.com/channel/0029VbDl6c1KmCPJErq9ox3F
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dns = require('dns');
const crypto = require('crypto');
const zlib = require('zlib');

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}

const HOME = os.homedir() || process.env.HOME || '/home/container';
const ROOT = path.resolve(__dirname);

function has(cmd) {
  try {
    execSync(`command -v ${cmd} >/dev/null 2>&1`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function detectPlatform() {
  const platform = os.platform();
  const arch = os.arch();

  const osName = platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : platform;
  const archName = arch === 'x64' ? 'amd64' : arch === 'arm64' ? 'arm64' : arch;

  if (osName === 'linux') {
    try {
      if (fs.existsSync('/lib/libc.musl-x86_64.so.1') || fs.existsSync('/lib/libc.musl-aarch64.so.1')) {
        return `linux_${archName}_musl`;
      }
      const out = execSync('ldd /bin/ls 2>&1 || true', { encoding: 'utf8' });
      if (out.includes('musl')) return `linux_${archName}_musl`;
    } catch {}
    return `linux_${archName}`;
  }

  return `${osName}_${archName}`;
}

function extractFileFromTarGz(buffer, targetName) {
  try {
    const unzipped = zlib.gunzipSync(buffer);
    let offset = 0;
    while (offset + 512 <= unzipped.length) {
      const header = unzipped.subarray(offset, offset + 512);
      if (header[0] === 0) break;
      const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '').trim();
      const sizeStr = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
      const size = parseInt(sizeStr, 8) || 0;
      offset += 512;
      if (name === targetName || path.basename(name) === targetName) {
        return unzipped.subarray(offset, offset + size);
      }
      offset += Math.ceil(size / 512) * 512;
    }
  } catch {}
  return null;
}

async function installAgyPureNode() {
  const platform = detectPlatform();
  const manifestUrl = `https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/${platform}.json`;

  const manifestRes = await fetch(manifestUrl);
  if (!manifestRes.ok) throw new Error(`HTTP ${manifestRes.status} saat fetch manifest`);
  const { version, url, sha512 } = await manifestRes.json();

  const pkgRes = await fetch(url);
  if (!pkgRes.ok) throw new Error(`HTTP ${pkgRes.status} saat download agy`);
  const buf = Buffer.from(await pkgRes.arrayBuffer());

  const hash = crypto.createHash('sha512').update(buf).digest('hex');
  if (hash.toLowerCase() !== sha512.toLowerCase()) {
    throw new Error('Verifikasi SHA512 agy binary gagal');
  }

  const targetDir = [path.join(HOME, '.local/bin'), path.join(ROOT, 'bin')].find(d => {
    try {
      fs.mkdirSync(d, { recursive: true });
      fs.accessSync(d, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }) || path.join(ROOT, 'bin');

  fs.mkdirSync(targetDir, { recursive: true });
  const binaryDest = path.join(targetDir, 'agy');

  if (url.includes('.tar.gz')) {
    let extracted = false;
    if (has('tar')) {
      const tmpFile = path.join(os.tmpdir(), `agy-${Date.now()}.tar.gz`);
      try {
        fs.writeFileSync(tmpFile, buf);
        execSync(`tar -xzf "${tmpFile}" -C "${targetDir}" antigravity 2>/dev/null && mv "${path.join(targetDir, 'antigravity')}" "${binaryDest}" 2>/dev/null || tar -xzf "${tmpFile}" -C "${targetDir}" agy 2>/dev/null`);
        if (fs.existsSync(binaryDest)) extracted = true;
      } catch {}
      try { fs.unlinkSync(tmpFile); } catch {}
    }

    if (!extracted) {
      const binData = extractFileFromTarGz(buf, 'antigravity') || extractFileFromTarGz(buf, 'agy');
      if (!binData) throw new Error('Gagal mengekstrak binary dari tar.gz');
      fs.writeFileSync(binaryDest, binData, { mode: 0o755 });
    }
  } else {
    fs.writeFileSync(binaryDest, buf, { mode: 0o755 });
  }

  try { fs.chmodSync(binaryDest, 0o755); } catch {}
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
        execSync(`"${c}" --version`, { encoding: 'utf8' });
        return c;
      } catch {}
    }
  }

  return await installAgyPureNode();
}

async function main() {
  console.log('[setup] Menyiapkan environment agy bot…');
  const agyPath = await ensureAgyInstalled();
  console.log(`[setup] agy binary siap: ${agyPath}`);

  if (!fs.existsSync(path.join(ROOT, 'node_modules/telegraf'))) {
    console.log('[setup] Menginstall dependensi npm…');
    execSync('npm install --omit=dev', { stdio: 'inherit' });
  }

  const ex = path.join(ROOT, '.env.example');
  const env = path.join(ROOT, '.env');
  if (!fs.existsSync(env) && fs.existsSync(ex)) {
    fs.copyFileSync(ex, env);
    console.log('[setup] File .env berhasil dibuat dari .env.example');
  }

  if (fs.existsSync(env) && agyPath) {
    try {
      let t = fs.readFileSync(env, 'utf8');
      if (!/^AGY_COMMAND=.+/m.test(t)) {
        t = /^AGY_COMMAND=/m.test(t)
          ? t.replace(/^AGY_COMMAND=.*$/m, `AGY_COMMAND=${agyPath}`)
          : t + `\nAGY_COMMAND=${agyPath}\n`;
        fs.writeFileSync(env, t);
      }
    } catch {}
  }

  console.log('[setup] Selesai! Jalankan bot dengan: npm start');
}

module.exports = {
  ensureAgyInstalled,
  installAgyPureNode,
  detectPlatform
};

if (require.main === module) {
  main().catch(err => {
    console.error('[setup error]', err.message);
    process.exit(1);
  });
}
