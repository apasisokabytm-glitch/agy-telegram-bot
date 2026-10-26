/*Creator : Vellzyyy
 * Channel Creator : https://whatsapp.com/channel/0029VbDl6c1KmCPJErq9ox3F
 * Disclaimer : 
 * Note : Jangan hapus watermark
*/

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir() || process.env.HOME || '/home/container';
const LOCAL_BIN = path.resolve(__dirname, '../bin');
const EXTRA_PATH = `${HOME}/.local/bin:${LOCAL_BIN}:/usr/local/bin:/opt/homebrew/bin:/snap/bin:/home/container/.local/bin`;
const AGY = (() => {
  const raw = (process.env.AGY_COMMAND || 'agy').trim();
  if (raw.includes('/')) return raw;
  try {
    const p = execSync(`PATH="${EXTRA_PATH}:${process.env.PATH || ''}" which agy 2>/dev/null; PATH="${EXTRA_PATH}:${process.env.PATH || ''}" command -v agy 2>/dev/null`, { encoding: 'utf8' }).trim().split('\n')[0]?.trim();
    if (p && fs.existsSync(p)) return p;
  } catch {}
  for (const c of [`${HOME}/.local/bin/agy`, `${LOCAL_BIN}/agy`, '/home/container/.local/bin/agy', '/usr/local/bin/agy', '/opt/homebrew/bin/agy']) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return raw;
})();

// --- helpers ---
function spawnCapture(cmd, args, opts = {}) {
  const env = { ...process.env, PATH: `${EXTRA_PATH}:${process.env.PATH || ''}`, ...(opts.env || {}) };
  const useOpts = { ...opts, env };
  return new Promise((resolve) => {
    const p = spawn(cmd, args, useOpts);
    let out = '', err = '';
    p.stdout?.on('data', d => out += d);
    p.stderr?.on('data', d => err += d);
    p.on('close', (code) => resolve({ code, out, err }));
    p.on('error', (e) => resolve({ code: 1, out, err: String(e) }));
  });
}

function resolveUserHome(userContext) {
  if (!userContext || !userContext.userHome) {
    throw new Error('userContext.userHome is required for multi-tenant isolation');
  }
  return userContext.userHome;
}

let cachedAgyVersion = null;
async function agyVersion() {
  if (cachedAgyVersion) return { ok: true, version: cachedAgyVersion };
  const r = await spawnCapture(AGY, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const v = (r.out || r.err).trim().split('\n')[0];
  if (r.code === 0 && v) cachedAgyVersion = v;
  return { ok: r.code === 0, version: v, raw: r };
}

async function getQuota(userContext) {
  const userHome = resolveUserHome(userContext);
  const env = { ...process.env, HOME: userHome, PATH: `${EXTRA_PATH}:${process.env.PATH || ''}` };
  return new Promise((resolve) => {
    const p = spawn(AGY, ['-p=/quota', '--output-format', 'json'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '', err = '';
    let killedForAuth = false;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      killedForAuth = true;
      try { p.kill('SIGKILL'); } catch {}
    }, 8000);

    const checkAuthPrompt = (txt) => {
      if (!killedForAuth && /Authentication required|Please visit the URL to log in|Please sign in|oauth2\/auth/i.test(txt)) {
        killedForAuth = true;
        try { p.kill('SIGKILL'); } catch {}
      }
    };

    p.stdout?.on('data', d => {
      out += d;
      checkAuthPrompt(out);
    });
    p.stderr?.on('data', d => {
      err += d;
      checkAuthPrompt(err);
    });

    p.on('close', (code) => {
      settled = true;
      clearTimeout(timer);
      if (killedForAuth) {
        return resolve({ ok: false, needLogin: true, error: 'Authentication required. Silakan /login dulu.' });
      }
      const last = (out.trim().split('\n').pop() || '').trim();
      try {
        const j = JSON.parse(last);
        if (j.status === 'SUCCESS') return resolve({ ok: true, j, raw: { out, err, code } });
        return resolve({ ok: false, error: j.error || j.response || err.trim(), j, raw: { out, err, code } });
      } catch {
        const errTxt = (err || out).trim();
        if (/not logged|authentication|sign in/i.test(errTxt)) {
          return resolve({ ok: false, error: errTxt, needLogin: true });
        }
        return resolve({ ok: false, error: errTxt || 'quota probe failed' });
      }
    });

    p.on('error', (e) => resolve({ ok: false, error: String(e) }));
  });
}

async function listModels(userContext) {
  const userHome = resolveUserHome(userContext);
  const r = await spawnCapture(AGY, ['models'], {
    env: { HOME: userHome },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (r.code !== 0) return { ok: false, error: (r.err || r.out).trim().slice(0, 800) };
  const rows = r.out.split('\n').filter(Boolean).map(l => {
    const [id, ...rest] = l.split('\t');
    return { id: id.trim(), label: (rest.join('\t') || id).trim() };
  }).filter(r => r.id && !r.id.includes(' '));
  return { ok: true, models: rows, raw: r.out.slice(0, 4000) };
}

async function listAgents(userContext) {
  const userHome = resolveUserHome(userContext);
  const r = await spawnCapture(AGY, ['agent'], {
    env: { HOME: userHome },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (r.code !== 0) return { ok: false, error: (r.err || r.out).trim().slice(0, 800) };
  return { ok: true, raw: r.out.slice(0, 4000) };
}

function getSkillsBaseDirs(userContext) {
  const dirs = [];
  if (userContext && userContext.skillsDir) {
    dirs.push(userContext.skillsDir);
  }
  if (userContext && userContext.userHome) {
    dirs.push(path.join(userContext.userHome, '.gemini/antigravity-cli/builtin/skills'));
  }
  dirs.push(path.join(HOME, '.gemini/antigravity-cli/builtin/skills'));
  dirs.push('/home/container/.gemini/antigravity-cli/builtin/skills');
  return [...new Set(dirs)];
}

async function listSkills(userContext) {
  const baseDirs = getSkillsBaseDirs(userContext);
  const seen = new Set();
  const allSkills = [];

  for (const base of baseDirs) {
    try {
      if (!fs.existsSync(base)) continue;
      const dirs = fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
      for (const n of dirs) {
        if (seen.has(n)) continue;
        seen.add(n);
        try {
          const mdPath = path.join(base, n, 'SKILL.md');
          if (fs.existsSync(mdPath)) {
            const lines = fs.readFileSync(mdPath, 'utf8').split('\n');
            const title = lines.find(l => l.startsWith('# '))?.replace(/^#\s*/, '') || lines.find(l => l.startsWith('description:'))?.replace(/^description:\s*["']?/, '').replace(/["']$/, '') || lines[0] || '';
            allSkills.push(`• \`${n}\` — ${title.slice(0, 80)}`);
          } else {
            allSkills.push(`• \`${n}\``);
          }
        } catch {
          allSkills.push(`• \`${n}\``);
        }
      }
    } catch {}
  }

  if (!allSkills.length) {
    return { ok: false, error: 'Belum ada skills yang terpasang.' };
  }
  return { ok: true, raw: allSkills.join('\n'), count: allSkills.length };
}

async function getSkillDetail(userContext, name) {
  const baseDirs = getSkillsBaseDirs(userContext);
  for (const base of baseDirs) {
    const mdPath = path.join(base, name, 'SKILL.md');
    try {
      if (fs.existsSync(mdPath)) {
        const content = fs.readFileSync(mdPath, 'utf8');
        return { ok: true, content: content.slice(0, 3800) };
      }
    } catch {}
  }
  return { ok: false, error: `Skill "${name}" tidak ditemukan` };
}

async function addSkillFromGit(userContext, repoInput) {
  let url = (repoInput || '').trim();
  if (!url) return { ok: false, error: 'URL repositori tidak boleh kosong.' };

  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(url)) {
    url = `https://github.com/${url}.git`;
  } else if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('git@')) {
    url = `https://${url}`;
  }
  if (url.includes('github.com') && !url.endsWith('.git')) {
    url = `${url}.git`;
  }

  const tempDir = path.join(os.tmpdir(), `skill-git-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);

  try {
    const cloneRes = await spawnCapture('git', ['clone', '--depth', '1', url, tempDir]);
    if (cloneRes.code !== 0) {
      const err = (cloneRes.err || cloneRes.out).trim();
      return { ok: false, error: `Gagal clone repositori: ${err}` };
    }

    function findSkillFiles(dir) {
      let results = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results = results.concat(findSkillFiles(fullPath));
        } else if (entry.name.toLowerCase() === 'skill.md') {
          results.push(fullPath);
        }
      }
      return results;
    }

    const skillFiles = findSkillFiles(tempDir);
    const installed = [];
    const targetDirs = [];
    if (userContext && userContext.skillsDir) {
      targetDirs.push(userContext.skillsDir);
    }
    if (userContext && userContext.userHome) {
      targetDirs.push(path.join(userContext.userHome, '.gemini/antigravity-cli/builtin/skills'));
    }
    if (!targetDirs.length) {
      targetDirs.push(path.join(HOME, '.gemini/antigravity-cli/builtin/skills'));
    }

    for (const b of targetDirs) {
      try { fs.mkdirSync(b, { recursive: true }); } catch {}
    }

    if (skillFiles.length > 0) {
      for (const sf of skillFiles) {
        const skillDir = path.dirname(sf);
        const content = fs.readFileSync(sf, 'utf8');

        let skillName = '';
        const nameMatch = content.match(/^name:\s*["']?([a-zA-Z0-9_-]+)["']?/m);
        if (nameMatch) {
          skillName = nameMatch[1];
        } else if (skillDir !== tempDir) {
          skillName = path.basename(skillDir);
        } else {
          const repoSlug = path.basename(url.replace(/\.git$/, ''));
          skillName = repoSlug.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
        }

        const titleMatch = content.match(/^#\s+(.+)$/m) || content.match(/^description:\s*["']?(.+?)["']?$/m);
        const title = titleMatch ? titleMatch[1].trim() : skillName;

        for (const b of targetDirs) {
          const dest = path.join(b, skillName);
          try { fs.rmSync(dest, { recursive: true, force: true }); } catch {}
          try { fs.mkdirSync(dest, { recursive: true }); } catch {}
          fs.cpSync(skillDir, dest, {
            recursive: true,
            filter: (src) => !src.includes('.git') && !src.includes('node_modules')
          });
        }

        installed.push({ name: skillName, title });
      }
    } else {
      const readmePath = path.join(tempDir, 'README.md');
      if (fs.existsSync(readmePath)) {
        const repoSlug = path.basename(url.replace(/\.git$/, '')).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
        const readmeContent = fs.readFileSync(readmePath, 'utf8');
        const skillMd = `---\nname: ${repoSlug}\ndescription: "Skill diimpor dari ${url}"\n---\n\n${readmeContent}`;

        for (const b of targetDirs) {
          const dest = path.join(b, repoSlug);
          try { fs.mkdirSync(dest, { recursive: true }); } catch {}
          fs.writeFileSync(path.join(dest, 'SKILL.md'), skillMd);
        }

        installed.push({ name: repoSlug, title: `Skill ${repoSlug}` });
      } else {
        return { ok: false, error: 'Repositori tidak memiliki file SKILL.md atau README.md yang valid.' };
      }
    }

    return { ok: true, installed, url };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}

async function removeSkill(userContext, name) {
  if (!name) return { ok: false, error: 'Nama skill harus diisi.' };
  const baseDirs = getSkillsBaseDirs(userContext);
  let deleted = false;
  for (const b of baseDirs) {
    const p = path.join(b, name);
    if (fs.existsSync(p)) {
      try {
        fs.rmSync(p, { recursive: true, force: true });
        deleted = true;
      } catch {}
    }
  }
  return { ok: deleted, name };
}

// ── GitHub & Vercel Auth Helpers ─────────────────────────────────────
async function checkGithubAuth(userContext) {
  const userHome = resolveUserHome(userContext);
  const res = await spawnCapture('gh', ['api', 'user', '--jq', '{login: .login, name: .name, email: .email}'], {
    env: { HOME: userHome }
  });
  if (res.code === 0) {
    try {
      const user = JSON.parse(res.out.trim());
      return { ok: true, user };
    } catch {}
    return { ok: true, user: { login: res.out.trim() } };
  }
  return { ok: false, error: (res.err || res.out).trim() };
}

async function loginGithub(userContext, token) {
  const cleanToken = (token || '').trim();
  if (!cleanToken) return { ok: false, error: 'Token GitHub tidak boleh kosong.' };

  const userHome = resolveUserHome(userContext);
  const p = spawn('gh', ['auth', 'login', '--with-token'], {
    env: { ...process.env, HOME: userHome, PATH: `${EXTRA_PATH}:${process.env.PATH || ''}` },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let out = '', err = '';
  p.stdout.on('data', d => out += d);
  p.stderr.on('data', d => err += d);
  p.stdin.write(cleanToken + '\n');
  p.stdin.end();

  const code = await new Promise(resolve => p.on('close', resolve));
  if (code !== 0) {
    return { ok: false, error: (err || out).trim() || 'Gagal login GitHub (token tidak valid)' };
  }

  try {
    await spawnCapture('gh', ['auth', 'setup-git'], { env: { HOME: userHome } });
  } catch {}

  const userCheck = await checkGithubAuth(userContext);
  return {
    ok: true,
    user: userCheck.ok ? userCheck.user : { login: 'authenticated' }
  };
}

async function checkVercelAuth(userContext) {
  const userHome = resolveUserHome(userContext);
  const res = await spawnCapture('vercel', ['whoami'], {
    env: { HOME: userHome }
  });
  if (res.code === 0) {
    const username = res.out.trim().split('\n')[0].replace(/^>\s*/, '').trim();
    return { ok: true, username };
  }
  return { ok: false, error: (res.err || res.out).trim() };
}

async function loginVercel(userContext, token) {
  const cleanToken = (token || '').trim();
  if (!cleanToken) return { ok: false, error: 'Token Vercel tidak boleh kosong.' };

  const userHome = resolveUserHome(userContext);
  const res = await spawnCapture('vercel', ['whoami', '--token', cleanToken], {
    env: { HOME: userHome }
  });
  if (res.code !== 0) {
    const err = (res.err || res.out).trim();
    return { ok: false, error: err || 'Token Vercel tidak valid.' };
  }

  const username = res.out.trim().split('\n')[0].replace(/^>\s*/, '').trim();

  const authConfigDirs = [
    path.join(userHome, '.config/com.vercel.cli'),
    path.join(userHome, '.vercel')
  ];

  for (const d of authConfigDirs) {
    try {
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'auth.json'), JSON.stringify({ token: cleanToken }, null, 2));
    } catch {}
  }

  return { ok: true, username };
}

async function listPlugins(userContext) {
  const userHome = resolveUserHome(userContext);
  const r = await spawnCapture(AGY, ['plugin', 'list'], {
    env: { HOME: userHome },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return { ok: r.code === 0, raw: (r.out || r.err).trim().slice(0, 4000), error: r.code !== 0 ? (r.err || r.out).trim().slice(0, 800) : null };
}

async function pluginInstall(userContext, target) {
  const userHome = resolveUserHome(userContext);
  const r = await spawnCapture(AGY, ['plugin', 'install', target], {
    env: { HOME: userHome },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return { ok: r.code === 0, output: (r.out + '\n' + r.err).trim().slice(0, 3500) };
}

async function pluginUninstall(userContext, name) {
  const userHome = resolveUserHome(userContext);
  const r = await spawnCapture(AGY, ['plugin', 'uninstall', name], {
    env: { HOME: userHome },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return { ok: r.code === 0, output: (r.out + '\n' + r.err).trim().slice(0, 3500) };
}

async function pluginEnable(userContext, name) {
  const userHome = resolveUserHome(userContext);
  const r = await spawnCapture(AGY, ['plugin', 'enable', name], {
    env: { HOME: userHome },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return { ok: r.code === 0, output: (r.out + '\n' + r.err).trim().slice(0, 3500) };
}

async function pluginDisable(userContext, name) {
  const userHome = resolveUserHome(userContext);
  const r = await spawnCapture(AGY, ['plugin', 'disable', name], {
    env: { HOME: userHome },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return { ok: r.code === 0, output: (r.out + '\n' + r.err).trim().slice(0, 3500) };
}

async function listMcp(userContext) {
  const userHome = resolveUserHome(userContext);
  const r = await spawnCapture(AGY, ['mcp', 'list'], {
    env: { HOME: userHome },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return { ok: r.code === 0, raw: (r.out || r.err).trim().slice(0, 4000), error: r.code !== 0 ? (r.err || r.out).trim().slice(0, 800) : null };
}

async function mcpAdd(userContext, name, cmdOrUrl, args = []) {
  const userHome = resolveUserHome(userContext);
  const cliArgs = ['mcp', 'add', name, cmdOrUrl, ...args];
  const r = await spawnCapture(AGY, cliArgs, {
    env: { HOME: userHome },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return { ok: r.code === 0, output: (r.out + '\n' + r.err).trim().slice(0, 3500) };
}

async function mcpRemove(userContext, name) {
  const userHome = resolveUserHome(userContext);
  const r = await spawnCapture(AGY, ['mcp', 'remove', name], {
    env: { HOME: userHome },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return { ok: r.code === 0, output: (r.out + '\n' + r.err).trim().slice(0, 3500) };
}

async function mcpEnable(userContext, name) {
  const userHome = resolveUserHome(userContext);
  const r = await spawnCapture(AGY, ['mcp', 'enable', name], {
    env: { HOME: userHome },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return { ok: r.code === 0, output: (r.out + '\n' + r.err).trim().slice(0, 3500) };
}

async function mcpDisable(userContext, name) {
  const userHome = resolveUserHome(userContext);
  const r = await spawnCapture(AGY, ['mcp', 'disable', name], {
    env: { HOME: userHome },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return { ok: r.code === 0, output: (r.out + '\n' + r.err).trim().slice(0, 3500) };
}

function isOutsideUserBoundary(params, effectiveWs, userHome) {
  if (!effectiveWs) return false;
  const wsNorm = path.resolve(effectiveWs);
  const homeNorm = userHome ? path.resolve(userHome) : null;
  const raw = JSON.stringify(params || {});

  // Block explicit references to bot handler, .env, other users' dirs, or parent traversal
  if (/agy-telegram-bot\/(bot|setup|lib|\.env)|data\/users\/(?!default)[0-9]+|\/home\/container\/(\.hermes|\.ssh|\.config|\.gemini|vercel_deploy|capcut-generator)|\.\.\//i.test(raw)) {
    // Allow only if the matched data/users/<id> is exclusively the user's own workspace/home
    const stripped = raw
      .split(wsNorm).join('')
      .split(homeNorm || '__NONE__').join('');
    if (/agy-telegram-bot\/(bot|setup|lib|\.env)|data\/users\/|\/home\/container\/|\.\.\//i.test(stripped)) {
      return true;
    }
  }

  for (const [k, v] of Object.entries(params || {})) {
    if (typeof v === 'string' && v.startsWith('/')) {
      const resolved = path.resolve(v);
      const inWs = resolved === wsNorm || resolved.startsWith(wsNorm + path.sep);
      const inHome = homeNorm && (resolved === homeNorm || resolved.startsWith(homeNorm + path.sep));
      const inTmp = resolved.startsWith('/tmp/') || resolved === '/tmp';
      if (!inWs && !inHome && !inTmp) return true;
    }
  }
  return false;
}

// --- streaming chat: one-shot agy -p with stream-json ---
function runPrompt({ userContext, prompt, workspaceDir, model, mode, effort, agent, onDelta, onTool }) {
  const userHome = resolveUserHome(userContext);
  const effectiveWs = path.resolve(workspaceDir || userContext?.workspaceDir);
  const userTmp = path.join(userContext.userDir, 'tmp');
  try { fs.mkdirSync(userTmp, { recursive: true }); } catch {}

  const args = ['--sandbox', '--dangerously-skip-permissions'];
  if (effectiveWs) { args.push('--add-dir', effectiveWs); }
  if (model) { args.push('--model', model); }
  if (mode) { args.push('--mode', mode); }
  if (effort) { args.push('--effort', effort); }
  if (agent) { args.push('--agent', agent); }
  args.push('--output-format', 'stream-json', '-p', prompt);

  // Sanitized environment: never leak TELEGRAM_BOT_TOKEN, SSH_PASSWORD, or host secrets into agent subprocess
  const env = {
    HOME: userHome,
    USER: `user_${userContext?.userId || 'guest'}`,
    LOGNAME: `user_${userContext?.userId || 'guest'}`,
    PATH: `${EXTRA_PATH}:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`,
    LANG: process.env.LANG || 'C.UTF-8',
    TZ: process.env.TZ || 'Asia/Jakarta',
    TERM: 'xterm-256color',
    TMPDIR: userTmp,
    TEMP: userTmp,
    TMP: userTmp,
    NODE_OPTIONS: '--dns-result-order=ipv4first'
  };
  const time = new Date().toLocaleTimeString('id-ID', { hour12: false });
  console.log(`\x1b[90m[${time}]\x1b[0m \x1b[36m[PROMPT]\x1b[0m User: \x1b[1m${userContext?.userId || 'guest'}\x1b[0m | Model: \x1b[33m${model || 'default'}\x1b[0m | Mode: \x1b[35m${mode || 'auto'}\x1b[0m`);

  let p = null;
  let isCancelled = false;
  let securityViolation = null;
  let timer = null;

  const killTree = (sig = 'SIGKILL') => {
    if (!p) return;
    try { process.kill(-p.pid, sig); } catch {}
    try { p.kill(sig); } catch {}
  };

  const promise = new Promise((resolve, reject) => {
    p = spawn(AGY, args, {
      cwd: effectiveWs,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderrBuf = '';
    let finalText = '';
    let streamText = '';
    let conversationId = null;
    let toolCalls = [];
    let lastResult = null;
    let rawLines = [];
    let rawStdout = '';

    p.stderr.on('data', d => stderrBuf += d.toString());

    const rl = require('readline').createInterface({ input: p.stdout });
    rl.on('line', (line) => {
      const t = line.trim();
      if (!t) return;
      rawStdout += line + '\n';
      if (rawLines.length < 80) rawLines.push(line.slice(0, 1200));
      try {
        const ev = JSON.parse(t);
        const kind = ev.event;
        if (kind === 'init' && ev.init?.conversation_id) conversationId = ev.init.conversation_id;
        if (kind === 'step_update') {
          const s = ev.step_update || {};
          if (s.step_type === 'agent_response' && s.text_delta) {
            streamText += s.text_delta;
            if (onDelta) onDelta(s.text_delta, streamText);
          }
          if (s.step_type === 'tool') {
            const name = s.tool_name || s.tool_info?.name || 'tool';
            const params = s.tool_info?.parameters || {};
            if (isOutsideUserBoundary(params, effectiveWs, userHome)) {
              securityViolation = `⛔ Akses ditolak: AI Agent tidak diizinkan mengakses file atau direktori di luar workspace kamu (${name}).`;
              killTree('SIGKILL');
              return;
            }
            toolCalls.push(name);
            const toolTime = new Date().toLocaleTimeString('id-ID', { hour12: false });
            console.log(`\x1b[90m[${toolTime}]\x1b[0m \x1b[33m[TOOL]\x1b[0m   \x1b[1m${name}\x1b[0m (user: ${userContext?.userId || 'guest'})`);
            if (onTool) onTool(name, s);
          }
        }
        if (kind === 'result') {
          const r = ev.result || {};
          lastResult = r;
          if (r.conversation_id) conversationId = r.conversation_id;
          if (r.response) finalText = r.response;
          else if (streamText) finalText = streamText;
        }
      } catch {
        if (!finalText && t.length > 10 && !t.startsWith('{')) rawLines.push(`[plain] ${t.slice(0, 600)}`);
      }
    });

    const timeoutMs = 600_000;
    timer = setTimeout(() => {
      killTree('SIGTERM');
      setTimeout(() => killTree('SIGKILL'), 2000);
    }, timeoutMs);

    p.on('close', (code) => {
      clearTimeout(timer);
      rl.close();

      if (securityViolation) {
        return resolve({ ok: false, error: securityViolation });
      }

      if (isCancelled) {
        return resolve({ ok: false, cancelled: true, error: 'Proses dibatalkan oleh pengguna' });
      }

      if (!finalText && streamText) finalText = streamText;

      if (lastResult) {
        const status = (lastResult.status || '').toUpperCase();
        const errTxt = String(lastResult.error || lastResult.response || '').trim();
        if (status && status !== 'SUCCESS') {
          const low = (errTxt + ' ' + stderrBuf).toLowerCase();
          if (low.includes('not logged') || low.includes('authentication') || low.includes('not signed') || low.includes('sign in')) {
            return resolve({ ok: false, needLogin: true, error: errTxt.slice(0, 800) || stderrBuf.trim().slice(0, 800) || `agy status ${status}`, conversationId, raw: rawLines.slice(0, 20).join('\n').slice(0, 2000), code });
          }
          if (/quota|rate limit|resource_exhausted|429|limit reached|out of credits/i.test(low)) {
            return resolve({ ok: false, quota: true, error: errTxt.slice(0, 800) || stderrBuf.trim().slice(0, 800), conversationId, raw: rawLines.slice(0, 20).join('\n').slice(0, 2000), code });
          }
          if (!finalText) {
            const debug = [
              `status=${status}`,
              errTxt ? `error=${errTxt.slice(0, 600)}` : '',
              stderrBuf.trim() ? `stderr=${stderrBuf.trim().slice(0, 600)}` : 'stderr=(empty)',
              `stdout lines=${rawLines.length} code=${code}`,
              `raw head:\n${rawLines.slice(0, 8).join('\n').slice(0, 1200)}`
            ].filter(Boolean).join('\n');
            return resolve({ ok: false, error: debug.slice(0, 1800), conversationId, raw: rawLines.join('\n').slice(0, 3000), code });
          }
        }
      }

      if (!finalText && stderrBuf) {
        const low = stderrBuf.toLowerCase();
        if (low.includes('not logged') || low.includes('authentication') || low.includes('not signed')) {
          return resolve({ ok: false, needLogin: true, error: stderrBuf.trim().slice(0, 800), conversationId, raw: rawLines.join('\n').slice(0, 2000), code });
        }
        if (/not found|ENOENT|no such file/i.test(stderrBuf)) {
          return resolve({ ok: false, error: `${AGY} not found — set AGY_COMMAND in .env to hasil 'which agy' (PATH=${process.env.PATH})`, conversationId, code });
        }
        if (code !== 0) {
          const debug = `agy exit ${code}\nstderr=${stderrBuf.trim().slice(0, 800)}\nstdout head:\n${rawLines.slice(0, 8).join('\n').slice(0, 1200)}`;
          return resolve({ ok: false, error: debug.slice(0, 1800), conversationId, raw: rawLines.join('\n').slice(0, 3000), code });
        }
      }

      if (!finalText) {
        if (/quota|rate limit|resource_exhausted|429/i.test(stderrBuf)) {
          return resolve({ ok: false, quota: true, error: stderrBuf.trim().slice(0, 800), conversationId, code });
        }
        const debug = [
          `agy returned empty (code=${code})`,
          stderrBuf.trim() ? `stderr=${stderrBuf.trim().slice(0, 600)}` : 'stderr=(empty)',
          lastResult ? `result status=${lastResult.status || '?'} error=${String(lastResult.error||'').slice(0, 400)}` : 'no result event',
          `stdout lines=${rawLines.length}`,
          rawLines.length ? `raw:\n${rawLines.slice(0, 10).join('\n').slice(0, 1500)}` : 'raw=(empty — agy produced no stream-json)',
          `AGY=${AGY}`,
          `Tip: coba di server: ${AGY} --output-format stream-json -p "hello" 2>&1 | head -n 100`,
        ].join('\n');
        return resolve({ ok: false, error: debug.slice(0, 2200), conversationId, raw: rawLines.join('\n').slice(0, 3000), code });
      }

      resolve({ ok: true, text: finalText || streamText, conversationId, toolCalls, stderr: stderrBuf.slice(0, 2000), raw: rawLines.join('\n').slice(0, 3000), code });
    });

    p.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });

  promise.proc = p;
  promise.cancel = () => {
    isCancelled = true;
    if (timer) clearTimeout(timer);
    killTree('SIGTERM');
    setTimeout(() => killTree('SIGKILL'), 500);
  };

  return promise;
}

// --- PTY login flow: capture OAuth URL via `script` ---
function startLoginPTY(opts = {}) {
  const isNewAccount = opts.isNewAccount || false;
  const userHome = resolveUserHome(opts.userContext);
  const tokenPath = path.join(userHome, '.gemini/antigravity-cli/antigravity-oauth-token');
  let backupPath = null;

  if (isNewAccount && fs.existsSync(tokenPath)) {
    backupPath = tokenPath + '.bak_' + Date.now();
    try {
      fs.copyFileSync(tokenPath, backupPath);
      fs.unlinkSync(tokenPath);
    } catch (err) {
      console.warn('Backup token error:', err.message);
    }
  }

  const agyQuoted = AGY.includes(' ') ? `"${AGY}"` : AGY;
  const cmd = `PATH="${EXTRA_PATH}:${process.env.PATH || ''}" ${agyQuoted} -p=/quota 2>&1`;
  const p = spawn('script', ['-q', '-c', cmd, '/dev/null'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, HOME: userHome, PATH: `${EXTRA_PATH}:${process.env.PATH || ''}`, TERM: 'xterm-256color' },
  });

  let buf = '';
  let url = null;
  let state = null;
  let restored = false;

  const restoreBackupIfNeeded = () => {
    if (restored) return;
    restored = true;
    if (backupPath && fs.existsSync(backupPath)) {
      if (!fs.existsSync(tokenPath)) {
        try { fs.copyFileSync(backupPath, tokenPath); } catch {}
      }
      try { fs.unlinkSync(backupPath); } catch {}
    }
  };

  const tryExtract = (chunk) => {
    buf += chunk;
    const clean = buf.replace(/\x1b\[[0-9;]*m/g, '');
    const m = clean.match(/https:\/\/accounts\.google\.com\/o\/oauth2\/auth[^\s\r\n"']+/);
    if (m && !url) {
      url = m[0];
      const sm = url.match(/[?&]state=([^&]+)/);
      if (sm) state = sm[1];
    }
  };

  p.stdout.on('data', d => tryExtract(d.toString()));
  p.stderr.on('data', d => tryExtract(d.toString()));

  const waitUrl = (ms = 9000) => new Promise((res) => {
    const start = Date.now();
    const iv = setInterval(() => {
      if (url) { clearInterval(iv); res(url); }
      else if (Date.now() - start > ms) { clearInterval(iv); res(null); }
    }, 200);
  });

  const sendCode = (code) => {
    try { p.stdin.write(code.trim() + '\n'); } catch {}
  };

  const waitResult = (ms = 70_000) => new Promise((res) => {
    let out = '';
    const onData = (d) => { out += d.toString(); };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    const timer = setTimeout(() => { try { p.kill('SIGTERM'); } catch {} }, ms);
    p.on('close', (code) => {
      clearTimeout(timer);
      p.stdout.off('data', onData);
      p.stderr.off('data', onData);
      restoreBackupIfNeeded();
      res({ code, out: out.slice(0, 6000), okByPty: out.includes('Auth succeeded') || /authenticated/i.test(out) });
    });
  });

  const kill = () => {
    restoreBackupIfNeeded();
    try { p.kill('SIGTERM'); } catch {}
    setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 1000);
  };

  return { proc: p, get buf() { return buf; }, get url() { return url; }, get state() { return state; }, waitUrl, sendCode, waitResult, kill };
}

module.exports = {
  agyVersion,
  getQuota,
  listModels,
  listAgents,
  listSkills,
  getSkillDetail,
  listPlugins,
  pluginInstall,
  pluginUninstall,
  pluginEnable,
  pluginDisable,
  listMcp,
  mcpAdd,
  mcpRemove,
  mcpEnable,
  mcpDisable,
  runPrompt,
  startLoginPTY,
  addSkillFromGit,
  removeSkill,
  checkGithubAuth,
  loginGithub,
  checkVercelAuth,
  loginVercel,
  AGY,
  EXTRA_PATH
};