const { app, BrowserWindow, Tray, Menu, ipcMain, protocol, net, Notification, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const store = require('./store');
const git = require('./git');
const github = require('./github');
const content = require('./content');
const preview = require('./preview');
const scheduler = require('./scheduler');

const TEMPLATE_LOCAL = path.join(__dirname, '..', '..', '..', 'lane-theme');
let win = null;
let tray = null;
let quitting = false;
let runPoll = null;

const argv = process.argv;
const captureArg = argv.find((a) => a.startsWith('--capture='));
const repoArg = argv.find((a) => a.startsWith('--repo='));
const viewArg = argv.find((a) => a.startsWith('--view='));

// 单实例锁（截图 / 调试实例豁免）：重复启动时聚焦已有窗口
if (!captureArg && !process.env.LANE_DEBUG) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (win) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
    });
  }
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'lane-asset', privileges: { secure: true, supportFetchAPI: true, stream: true } }
]);

function repo() {
  if (repoArg) return repoArg.slice(7);
  return store.load().repoPath || null;
}
function token() {
  return store.load().token || null;
}
function remoteUrl(withToken) {
  const cfg = store.load();
  if (!cfg.owner || !cfg.repoName) return null;
  const cred = withToken && cfg.token ? `x-access-token:${cfg.token}@` : '';
  return `https://${cred}github.com/${cfg.owner}/${cfg.repoName}.git`;
}

function sendStatus(s) {
  if (win && !win.isDestroyed()) win.webContents.send('status', s);
  if (tray) tray.setToolTip(`lane-client · ${s.label || s.kind || ''}`);
}

function pollRuns() {
  if (runPoll) clearInterval(runPoll);
  const cfg = store.load();
  if (!cfg.token || !cfg.owner || !cfg.repoName) return;
  let tries = 0;
  runPoll = setInterval(async () => {
    tries += 1;
    try {
      const r = await github.latestRun(cfg.token, cfg.owner, cfg.repoName);
      const run = r.workflow_runs && r.workflow_runs[0];
      if (run) {
        const label =
          run.status !== 'completed'
            ? run.status === 'queued' ? '已提交' : '构建中'
            : run.conclusion === 'success' ? '已上线' : '失败';
        sendStatus({ kind: 'run', label, conclusion: run.conclusion, status: run.status, url: run.html_url });
        if (run.status === 'completed' || tries > 20) clearInterval(runPoll);
      }
    } catch { /* offline */ }
    if (tries > 20) clearInterval(runPoll);
  }, 15000);
}

async function doPush(message) {
  const r = repo();
  await git.commitContent(r, message || 'content: 更新 via lane client');
  await git.push(r, remoteUrl(true));
  sendStatus({ kind: 'run', label: '已提交' });
  pollRuns();
  return { ok: true };
}

function copyTemplate(dest) {
  fs.cpSync(TEMPLATE_LOCAL, dest, {
    recursive: true,
    filter: (src) => {
      const b = path.basename(src);
      return !['node_modules', 'dist', '.git', '.astro'].includes(b);
    }
  });
}

async function wizardSetup(p) {
  const cfg = store.load();
  const login = cfg.login;
  let dest = path.join(p.parentDir, p.repoName);
  if (p.mode === 'template' && p.templateOwner && p.templateRepo) {
    const gen = await github.generateFromTemplate(cfg.token, p.templateOwner, p.templateRepo, p.repoName, p.private);
    dest = path.join(p.parentDir, p.repoName);
    await git.clone(`https://x-access-token:${cfg.token}@github.com/${gen.full_name}.git`, dest);
  } else {
    if (fs.existsSync(dest)) throw new Error(`目录已存在：${dest}`);
    const rel = path.relative(TEMPLATE_LOCAL, dest);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
      throw new Error('存放目录不能是模板目录自身或其子目录；请填模板的上级目录（如 E:\\webdata\\lane）');
    }
    copyTemplate(dest);
    await git.ensureRepo(dest);
    await git.commitAll(dest, 'init: 从 lane-theme 模板初始化（全量）');
    if (cfg.token) {
      const created = await github.createRepo(cfg.token, p.repoName, p.private);
      await git.push(dest, `https://x-access-token:${cfg.token}@github.com/${created.full_name}.git`);
    }
  }
  if (cfg.token && login) {
    await github.enablePages(cfg.token, login, p.repoName);
    try {
      const sc = content.readSettings(dest);
      sc.siteUrl = `https://${login}.github.io`;
      content.writeSettings(dest, sc);
    } catch { /* 配置缺失时忽略 */ }
  }
  store.save({ repoPath: dest, owner: login || null, repoName: p.repoName });
  scheduler.start(dest, remoteUrl(true), sendStatus);
  return { repoPath: dest };
}

function registerIpc() {
  ipcMain.handle('api', async (_e, type, p = {}) => {
    const r = repo();
    switch (type) {
      case 'app:info':
        return {
          repoPath: r,
          hasRepo: !!r && fs.existsSync(path.join(r, 'site.config.json')),
          login: store.load().login || null,
          hasToken: !!token(),
          templateLocal: TEMPLATE_LOCAL,
          documentsPath: app.getPath('documents'),
          version: app.getVersion()
        };
      case 'dialog:save':
        return dialog.showSaveDialog(win, { defaultPath: p.defaultPath, filters: [{ name: 'Zip', extensions: ['zip'] }] });
      case 'dialog:open':
        return dialog.showOpenDialog(win, { properties: ['openFile'], filters: p.filters || [] });
      case 'dialog:openDir':
        return dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: p.defaultPath });
      case 'open:external':
        shell.openExternal(p.url);
        return { ok: true };
      case 'repo:open': {
        if (!fs.existsSync(path.join(p.path, 'site.config.json'))) throw new Error('该目录不是 lane 内容库（缺少 site.config.json）');
        store.save({ repoPath: p.path });
        scheduler.start(p.path, remoteUrl(true), sendStatus);
        return { ok: true };
      }
      case 'wizard:verify': {
        const u = await github.verify(p.token);
        store.save({ token: p.token, login: u.login });
        return { login: u.login, avatar: u.avatar_url };
      }
      case 'wizard:stored':
        return { token: store.load().token || '' };
      case 'wizard:setup':
        return wizardSetup(p);
      case 'posts:list':
        return content.listPosts(r);
      case 'posts:save':
        return content.savePost(r, p.id, p);
      case 'posts:delete':
        content.deletePost(r, p.id);
        return { ok: true };
      case 'assets:list':
        return content.listAssets(r);
      case 'assets:import': {
        const out = [];
        for (const f of p.paths) out.push(await content.importAsset(r, f, path.basename(f)));
        return out;
      }
      case 'assets:delete': {
        const base = path.basename(p.name);
        const refs = content.listPosts(r).filter(
          (x) => (x.body || '').includes(base) || (x.cover || '').includes(base)
        );
        if (refs.length) {
          throw new Error('素材仍被引用：' + refs.map((x) => x.title).join('、') + '；请先在文章中移除引用');
        }
        content.deleteAsset(r, p.name);
        return { ok: true };
      }
      case 'settings:get':
        return content.readSettings(r);
      case 'settings:save':
        content.writeSettings(r, p);
        return { ok: true };
      case 'publish:push':
        return doPush(p.message);
      case 'publish:status': {
        const cfg = store.load();
        if (!cfg.token || !cfg.owner) return { label: '未连接 GitHub' };
        const res = await github.latestRun(cfg.token, cfg.owner, cfg.repoName);
        const run = res.workflow_runs && res.workflow_runs[0];
        if (!run) return { label: '尚无构建' };
        return {
          label: run.status !== 'completed' ? (run.status === 'queued' ? '已提交' : '构建中') : run.conclusion === 'success' ? '已上线' : '失败',
          url: run.html_url,
          updatedAt: run.updated_at
        };
      }
      case 'publish:unpublish': {
        const post = content.listPosts(r).find((x) => x.id === p.id);
        if (!post) throw new Error('文章不存在');
        content.savePost(r, p.id, {
          ...post,
          draft: true,
          publishAt: post.publishAtRaw,
          cover: post.cover ? '../../' + post.cover.replace(/^src\//, '') : undefined
        });
        return doPush(`unpublish: 撤回 ${post.title}`);
      }
      case 'publish:history':
        return git.history(r, 20);
      case 'publish:scheduled':
        return scheduler.scheduledPosts(r);
      case 'backup:export': {
        const AdmZip = require('adm-zip');
        const zip = new AdmZip();
        zip.addLocalFolder(path.join(r, 'src', 'content'), 'src/content');
        zip.addLocalFolder(path.join(r, 'src', 'assets'), 'src/assets');
        zip.addLocalFile(path.join(r, 'site.config.json'));
        zip.writeZip(p.dest);
        return { ok: true, dest: p.dest };
      }
      case 'backup:import': {
        const AdmZip = require('adm-zip');
        let dest = p.dest;
        if (!dest) {
          // 默认恢复到 zip 同级 <zip名>-restored，避免二次弹窗困惑；被占用时才询问目录
          dest = path.join(path.dirname(p.file), path.basename(p.file, '.zip') + '-restored');
          if (fs.existsSync(dest)) return { needDir: true, defaultPath: dest };
        }
        const zip = new AdmZip(p.file);
        zip.extractAllTo(dest, true);
        if (!fs.existsSync(path.join(p.dest || dest, 'site.config.json'))) throw new Error('备份包缺少 site.config.json');
        store.save({ repoPath: dest });
        scheduler.start(dest, remoteUrl(true), sendStatus);
        return { repoPath: dest };
      }
      case 'preview:start':
        return preview.start(r);
      case 'preview:stop':
        await preview.stop();
        return { ok: true };
      default:
        throw new Error(`未知操作：${type}`);
    }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: Number(process.env.CAPTURE_W || 1200),
    height: Number(process.env.CAPTURE_H || 800),
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: '#1B2438',
    autoHideMenuBar: true,
    title: 'lane-client',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  const query = new URLSearchParams();
  if (viewArg) query.set('view', viewArg.slice(7));
  if (repoArg) query.set('repo', repoArg.slice(7));
  if (argv.includes('--collapse')) query.set('collapse', '1');
  const modeArg = argv.find((a) => a.startsWith('--mode='));
  if (modeArg) query.set('mode', modeArg.slice(7));
  if (process.env.LANE_DEBUG) {
    const dbg = 'E:/webdata/lane/.verify/client-debug.log';
    fs.writeFileSync(dbg, '');
    const dlog = (m) => fs.appendFileSync(dbg, m + '\n');
    win.webContents.on('console-message', (_e, _l, m) => dlog('CONSOLE ' + m));
    win.webContents.on('render-process-gone', (_e, d) => dlog('GONE ' + JSON.stringify(d)));
    win.webContents.on('preload-error', (_e, p, err) => dlog('PRELOAD_ERR ' + p + ' ' + err));
    win.webContents.on('did-finish-load', () => dlog('LOADED ' + win.webContents.getURL()));
    require('electron').session.defaultSession.webRequest.onErrorOccurred((d) =>
      dlog('REQERR ' + d.url + ' ' + d.error)
    );
    setTimeout(() => { quitting = true; app.quit(); }, Number(process.env.CAPTURE_WAIT || 3000) + 2000);
    setTimeout(async () => {
      try {
        const probe = await win.webContents.executeJavaScript(`(async () => {
          if (!window.lane) return 'NO_LANE_BRIDGE';
          const t = new Promise((res) => setTimeout(() => res('IPC_TIMEOUT'), 3000));
          const r = await Promise.race([window.lane.invoke('app:info'), t]);
          return JSON.stringify(r).slice(0, 200);
        })()`);
        dlog('PROBE ' + probe);
        const type = await win.webContents.executeJavaScript(`(() => {
          const el = document.getElementById('slug');
          if (!el) return 'NO_SLUG_INPUT';
          el.focus();
          const before = el.value;
          document.execCommand('insertText', false, 'abc');
          return JSON.stringify({ before, after: el.value, focused: document.activeElement.id, readOnly: el.readOnly, disabled: el.disabled });
        })()`);
        dlog('TYPE ' + type);
        await new Promise((res) => setTimeout(res, 2000));
        const after = await win.webContents.executeJavaScript(`(() => {
          const el = document.getElementById('slug');
          return JSON.stringify({ value: el ? el.value : 'GONE', focused: document.activeElement.id });
        })()`);
        dlog('TYPE_AFTER_SAVE ' + after);
      } catch (e) { dlog('PROBE_ERR ' + e.message); }
    }, 2500);
  }
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), {
    search: query.toString()
  });
  win.on('close', (e) => {
    if (!quitting && !captureArg) {
      e.preventDefault();
      win.hide();
    }
  });
  if (captureArg) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise((res) => setTimeout(res, Number(process.env.CAPTURE_WAIT || 3000)));
      const img = await win.webContents.capturePage();
      fs.writeFileSync(captureArg.slice(10), img.toPNG());
      quitting = true;
      app.quit();
    });
  }
}

function createTray() {
  const iconPath = path.join(__dirname, 'icon.png');
  tray = new Tray(fs.existsSync(iconPath) ? iconPath : undefined);
  tray.setToolTip('lane-client');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 lane-client', click: () => win.show() },
    { label: '新建草稿', click: () => { win.show(); win.webContents.send('status', { kind: 'new-draft' }); } },
    { label: '重启客户端', click: () => { quitting = true; app.relaunch(); app.quit(); } },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('click', () => win.show());
}

app.whenReady().then(async () => {
  protocol.handle('lane-asset', (req) => {
    const r = repo();
    const rel = decodeURIComponent(req.url.slice('lane-asset:'.length)).replace(/^\/+/, '');
    const abs = path.resolve(r || '', rel);
    if (!r || !abs.startsWith(path.resolve(r))) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(abs).toString());
  });
  registerIpc();
  createWindow();
  createTray();
  const r = repo();
  if (r && fs.existsSync(path.join(r, 'site.config.json'))) {
    scheduler.start(r, remoteUrl(true), sendStatus);
  }
});

app.on('before-quit', async () => {
  scheduler.stop();
  await preview.stop();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && (quitting || captureArg)) app.quit();
});