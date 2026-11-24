// 截图工具：SHOOT_URL / SHOOT_OUT / SHOOT_WAIT 环境变量传参
// （electron CLI 对 "URL + 额外位置参数" 会异常退出，故不用 argv）
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const url = process.env.SHOOT_URL;
const out = process.env.SHOOT_OUT;
const waitMs = Number(process.env.SHOOT_WAIT || 2500);
const width = Number(process.env.SHOOT_W || 1600);
const height = Number(process.env.SHOOT_H || 1000);

const LOG = 'E:/webdata/lane/.verify/shoot.log';
fs.mkdirSync(path.dirname(LOG), { recursive: true });
const log = (m) => fs.appendFileSync(LOG, m + '\n');

app.commandLine.appendSwitch('lang', process.env.SHOOT_LANG || 'en-US');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  log('ready ' + url + ' -> ' + out);
  const win = new BrowserWindow({ width, height, show: true });
  win.webContents.on('did-fail-load', (_e, code, desc) => log('loadfail ' + code + ' ' + desc));
  await win.loadURL(url);
  log('loaded');
  await new Promise((r) => setTimeout(r, waitMs));
  try {
    const h = await win.webContents.executeJavaScript('document.body.scrollHeight');
    if (h > height) win.setSize(width, Math.min(h, 6000));
    await new Promise((r) => setTimeout(r, 800));
  } catch (e) {
    log('resize skip ' + e.message);
  }
  const img = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.toPNG());
  log('saved ' + out);
  app.quit();
}).catch((e) => {
  log('fatal ' + ((e && e.stack) || e));
  process.exit(1);
});