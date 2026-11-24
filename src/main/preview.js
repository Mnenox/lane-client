const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

let child = null;
let currentRepo = null;
let ready = false;
let port = null;
let stdoutBuf = '';
let starting = null; // 并发启动守卫：多次调用共享同一次启动

const START_PORT = 4321;
const SCAN_PORTS = [4321, 4322, 4323, 4324, 4325, 4326];

function detectPort(chunk) {
  stdoutBuf += chunk;
  const m = stdoutBuf.match(/http:\/\/(?:127\.0\.0\.1|localhost):(\d{4,5})/);
  if (m) port = Number(m[1]);
}

function url(repo) {
  let base = '/';
  try {
    base = JSON.parse(fs.readFileSync(path.join(repo, 'site.config.json'), 'utf8')).basePath || '/';
  } catch { /* noop */ }
  return `http://127.0.0.1:${port || START_PORT}${base.endsWith('/') ? base : base + '/'}`;
}

async function probe(p) {
  try {
    const res = await fetch(`http://127.0.0.1:${p}/`, { signal: AbortSignal.timeout(1500) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function waitReady(timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    // 只信本进程 stdout 声明的端口，避免误连其他库的遗留服务（v1.24）
    if (port && (await probe(port))) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function doStart(repo) {
  if (child && currentRepo === repo && ready) return { url: url(repo), already: true };
  await stop();
  currentRepo = repo;
  ready = false;
  port = null;
  stdoutBuf = '';
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  child = spawn(npmCmd, ['run', 'dev', '--', '--port', String(START_PORT), '--host', '127.0.0.1'], {
    cwd: repo,
    shell: process.platform === 'win32',
    env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (d) => detectPort(d.toString()));
  child.stderr.on('data', (d) => detectPort(d.toString()));
  child.on('exit', () => { child = null; ready = false; });
  ready = await waitReady();
  if (!ready) throw new Error('预览服务启动超时（请确认内容库已 npm install）');
  return { url: url(repo) };
}

function start(repo) {
  if (!starting) {
    starting = doStart(repo).finally(() => { starting = null; });
  }
  return starting;
}

async function stop() {
  if (!child) return;
  const pid = child.pid;
  child = null;
  ready = false;
  port = null;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { shell: true });
  } else {
    try { process.kill(-pid); } catch { try { process.kill(pid); } catch { /* noop */ } }
  }
}

module.exports = { start, stop, url, isReady: () => ready };