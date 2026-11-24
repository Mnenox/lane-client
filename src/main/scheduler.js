const { Notification } = require('electron');
const store = require('./store');
const content = require('./content');
const git = require('./git');

let timer = null;

function duePosts(repo) {
  const now = Date.now();
  return content.listPosts(repo).filter(
    (p) => !p.draft && p.publishAt && new Date(p.publishAt).getTime() <= now
  );
}

function scheduledPosts(repo) {
  const now = Date.now();
  return content.listPosts(repo).filter(
    (p) => !p.draft && p.publishAt && new Date(p.publishAt).getTime() > now
  );
}

async function tick(repo, remoteUrl, onStatus) {
  const cfg = store.load();
  const triggered = new Set(cfg.triggered || []);
  for (const p of duePosts(repo)) {
    const key = `${p.id}@${p.publishAt}`;
    if (triggered.has(key)) continue;
    triggered.add(key);
    store.save({ triggered: [...triggered] });
    try {
      // 先入库未提交稿件（客户端自动保存只写盘不提交），再触发推送；TLS/网络瞬断重试 3 次
      let lastErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await git.commitContent(repo, `schedule: 入库到期稿件 ${p.title}`);
          await git.emptyCommitAndPush(repo, `chore: 定时发布触发 ${p.title}`, remoteUrl);
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          await new Promise((r) => setTimeout(r, 20000));
        }
      }
      if (lastErr) throw lastErr;
      new Notification({ title: 'lane-client 定时发布', body: `《${p.title}》已触发云端构建` }).show();
      onStatus && onStatus({ kind: 'scheduled', title: p.title });
    } catch (e) {
      new Notification({ title: 'lane-client 定时发布失败', body: e.message + '（云端每 30 分钟兜底重建仍会发布）' }).show();
    }
  }
}

function start(repo, remoteUrl, onStatus) {
  stop();
  // 首次接管：把"当前已到期"的文章标记为已发布，避免对历史文章重复触发推送
  const cfg = store.load();
  if (!cfg.triggeredInit) {
    const keys = duePosts(repo).map((p) => `${p.id}@${p.publishAt}`);
    store.save({ triggered: keys, triggeredInit: true });
  }
  timer = setInterval(() => { tick(repo, remoteUrl, onStatus).catch(() => {}); }, 30000);
  tick(repo, remoteUrl, onStatus).catch(() => {});
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, scheduledPosts, duePosts };