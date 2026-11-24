const fs = require('node:fs');
const path = require('node:path');
const matter = require('gray-matter');

const postsDir = (repo) => path.join(repo, 'src', 'content', 'posts');
const assetsDir = (repo) => path.join(repo, 'src', 'assets');

function isoWithOffset(d) {
  const pad = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const ah = pad(Math.floor(Math.abs(off) / 60));
  const am = pad(Math.abs(off) % 60);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:00${sign}${ah}:${am}`
  );
}

function yamlString(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
}

function serialize(data, body) {
  const lines = ['---'];
  lines.push(`title: ${yamlString(data.title || '未命名')}`);
  lines.push(`summary: ${yamlString(data.summary || '')}`);
  lines.push(`tags: [${(data.tags || []).map((t) => yamlString(t)).join(', ')}]`);
  if (data.cover) lines.push(`cover: ${data.cover}`);
  lines.push(`publishAt: ${data.publishAt}`);
  lines.push(`draft: ${data.draft ? 'true' : 'false'}`);
  if (data.slug) lines.push(`slug: ${yamlString(data.slug)}`);
  lines.push('---', '', body.trim(), '');
  return lines.join('\n');
}

function listPosts(repo) {
  const dir = postsDir(repo);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const raw = fs.readFileSync(path.join(dir, f), 'utf8');
      const { data, content } = matter(raw);
      const m = raw.match(/^publishAt:\s*(.+)$/m);
      const coverRel = data.cover
        ? path.relative(repo, path.resolve(dir, String(data.cover))).split(path.sep).join('/')
        : null;
      return {
        id: f.replace(/\.md$/, ''),
        title: data.title || f,
        summary: data.summary || '',
        tags: data.tags || [],
        draft: !!data.draft,
        slug: data.slug || null,
        cover: coverRel,
        publishAt: data.publishAt ? new Date(data.publishAt).toISOString() : null,
        publishAtRaw: m ? m[1].trim() : null,
        body: content
      };
    })
    .sort((a, b) => (b.publishAt || '').localeCompare(a.publishAt || ''));
}

function savePost(repo, id, payload) {
  const dir = postsDir(repo);
  fs.mkdirSync(dir, { recursive: true });
  const safeId = String(id || payload.title || 'post')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'post';
  const file = path.join(dir, `${safeId}.md`);
  const data = {
    title: payload.title,
    summary: payload.summary,
    tags: payload.tags,
    cover: payload.cover || undefined,
    publishAt: payload.publishAt || isoWithOffset(new Date()),
    draft: !!payload.draft,
    slug: payload.slug
      ? String(payload.slug).toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || undefined
      : undefined
  };
  fs.writeFileSync(file, serialize(data, payload.body || ''));
  return { id: safeId };
}

function deletePost(repo, id) {
  const file = path.join(postsDir(repo), `${id}.md`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function listAssets(repo) {
  const dir = assetsDir(repo);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((f) => {
    const st = fs.statSync(path.join(dir, f));
    return { name: f, rel: `src/assets/${f}`, size: st.size };
  });
}

async function importAsset(repo, srcPath, originalName) {
  const sharp = require('sharp');
  const dir = assetsDir(repo);
  fs.mkdirSync(dir, { recursive: true });
  const base = String(originalName || path.basename(srcPath))
    .replace(/\.[a-z0-9]+$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'image';
  const dest = path.join(dir, `${base}.webp`);
  await sharp(srcPath)
    .rotate()
    .resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(dest);
  return { rel: `src/assets/${base}.webp`, size: fs.statSync(dest).size };
}

function deleteAsset(repo, name) {
  const file = path.join(assetsDir(repo), path.basename(name));
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function readSettings(repo) {
  const file = path.join(repo, 'site.config.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeSettings(repo, cfg) {
  fs.writeFileSync(path.join(repo, 'site.config.json'), JSON.stringify(cfg, null, 2) + '\n');
}

module.exports = {
  isoWithOffset, listPosts, savePost, deletePost,
  listAssets, importAsset, deleteAsset, readSettings, writeSettings
};