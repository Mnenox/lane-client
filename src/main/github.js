const API = 'https://api.github.com';

function headers(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'lane-client'
  };
}

async function req(token, method, pathname, body) {
  const res = await fetch(API + pathname, {
    method,
    headers: { ...headers(token), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* noop */ }
  if (!res.ok) {
    const msg = (json && json.message) || text || res.statusText;
    throw new Error(`GitHub ${res.status}: ${msg}`);
  }
  return json;
}

const verify = (token) => req(token, 'GET', '/user');

const createRepo = (token, name, isPrivate) =>
  req(token, 'POST', '/user/repos', { name, private: !!isPrivate, auto_init: false });

const generateFromTemplate = (token, owner, template, name, isPrivate) =>
  req(token, 'POST', `/repos/${owner}/${template}/generate`, {
    owner, name, private: !!isPrivate, include_all_branches: false
  });

async function enablePages(token, owner, repo) {
  try {
    return await req(token, 'POST', `/repos/${owner}/${repo}/pages`, { build_type: 'workflow' });
  } catch (e) {
    if (/409|already exists/i.test(e.message)) return { already: true };
    throw e;
  }
}

const latestRun = (token, owner, repo) =>
  req(token, 'GET', `/repos/${owner}/${repo}/actions/runs?per_page=1`);

const getRepo = (token, owner, repo) => req(token, 'GET', `/repos/${owner}/${repo}`);

module.exports = { verify, createRepo, generateFromTemplate, enablePages, latestRun, getRepo };