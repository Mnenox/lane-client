const simpleGit = require('simple-git');
const fs = require('node:fs');
const path = require('node:path');

function git(repo) {
  return simpleGit(repo);
}

async function ensureRepo(repo) {
  if (!fs.existsSync(path.join(repo, '.git'))) {
    await git(repo).init();
    await git(repo).addConfig('user.name', 'lane client');
    await git(repo).addConfig('user.email', 'client@lane.local');
  }
  return git(repo);
}

async function commitContent(repo, message) {
  const g = await ensureRepo(repo);
  const targets = ['src/content', 'src/assets', 'site.config.json'].filter((p) =>
    fs.existsSync(path.join(repo, p))
  );
  if (!targets.length) return null;
  await g.add(targets);
  const st = await g.status();
  if (st.staged.length === 0 && st.created.length === 0 && st.modified.length === 0 && st.deleted.length === 0 && st.renamed.length === 0) {
    return null;
  }
  return g.commit(message);
}

async function commitAll(repo, message) {
  const g = await ensureRepo(repo);
  await g.add(['-A']);
  const st = await g.status();
  if (!st.isClean()) return g.commit(message);
  return null;
}

async function push(repo, remoteUrl) {
  const g = await ensureRepo(repo);
  const remotes = await g.getRemotes(true);
  if (!remotes.find((r) => r.name === 'origin')) {
    if (!remoteUrl) throw new Error('尚未配置远程仓库（origin）');
    await g.addRemote('origin', remoteUrl);
  } else if (remoteUrl) {
    await g.remote(['set-url', 'origin', remoteUrl]);
  }
  const branch = (await g.branch()).current || 'main';
  if (branch !== 'main') await g.branch(['-M', 'main']);
  return g.push(['-u', 'origin', 'main']);
}

async function emptyCommitAndPush(repo, message, remoteUrl) {
  const g = await ensureRepo(repo);
  await g.raw(['commit', '--allow-empty', '-m', message]);
  return push(repo, remoteUrl);
}

async function history(repo, n = 20) {
  const g = await ensureRepo(repo);
  try {
    const log = await g.log({ maxCount: n });
    return log.all.map((c) => ({ hash: c.hash.slice(0, 7), date: c.date, message: c.message }));
  } catch {
    return []; // 尚无提交（新内容库）时优雅降级
  }
}

async function clone(url, dest) {
  return simpleGit().clone(url, dest);
}

module.exports = { ensureRepo, commitContent, commitAll, push, emptyCommitAndPush, history, clone };