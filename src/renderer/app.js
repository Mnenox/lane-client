/* lane 客户端渲染层：五视图 + 首次向导（零代码） */
const $ = (s, r = document) => r.querySelector(s);
const api = (t, p) => window.lane.invoke(t, p);
const state = { info: null, posts: [], current: null, settings: null, view: 'write', mode: 'edit', previewUrl: null, dirty: false };
let saveTimer = null;

function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (err ? ' err' : '');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), 3200);
}
async function guard(fn) {
  try { return await fn(); } catch (e) { toast(e.message || String(e), true); throw e; }
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const assetUrl = (rel) => 'lane-asset:///' + rel;
const mdCover = (rel) => (rel ? '../../' + rel.replace(/^src\//, '') : null);
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
function localInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fromLocalInput(v) {
  if (!v) return null;
  const d = new Date(v);
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const s = off >= 0 ? '+' : '-';
  return `${v}:00${s}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
}

/* ---------- 启动 ---------- */
async function init() {
  state.info = await api('app:info');
  $('#sideFoot').textContent = state.info.repoPath || '未连接内容库';
  $('#repoName').textContent = state.info.repoPath ? state.info.repoPath.split(/[\\/]/).pop() : '';
  window.lane.onStatus((s) => {
    if (s.kind === 'new-draft') { newDraft(); return; }
    setStatus(s.label || '…', s.label === '已上线' ? 'ok' : s.label === '失败' ? 'err' : 'busy');
  });
  $('#nav').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (b) switchView(b.dataset.view);
  });
  const sb = document.querySelector('.sidebar');
  if (localStorage.getItem('lane-sidebar') === '1' || new URLSearchParams(location.search).get('collapse') === '1') sb.classList.add('collapsed');
  const toggleSidebar = () => {
    sb.classList.toggle('collapsed');
    localStorage.setItem('lane-sidebar', sb.classList.contains('collapsed') ? '1' : '0');
  };
  $('#logoBtn').onclick = toggleSidebar;
  $('#logoBtn').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') toggleSidebar(); };
  $('#publishBtn').addEventListener('click', () => guard(async () => {
    await api('publish:push', {});
    toast('已提交并推送，云端构建中');
    setStatus('已提交', 'busy');
  }));
  const q = new URLSearchParams(location.search);
  if (q.get('view')) state.view = q.get('view');
  if (q.get('mode') === 'preview' || q.get('mode') === 'edit') state.mode = q.get('mode');
  if (!state.info.hasRepo) { showWizard(); return; }
  await loadAll();
  switchView(state.view);
  refreshStatus();
}
async function loadAll() {
  state.posts = await api('posts:list');
  state.settings = await api('settings:get');
  if (!state.current && state.posts.length) state.current = { ...state.posts[0] };
}
function setStatus(text, cls) {
  $('#statusText').textContent = text;
  $('#statusPill').className = 'pill' + (cls ? ' ' + cls : '');
}
async function refreshStatus() {
  try {
    const s = await api('publish:status');
    setStatus(s.label, s.label === '已上线' ? 'ok' : s.label === '失败' ? 'err' : s.label === '未连接 GitHub' ? '' : 'busy');
  } catch { setStatus('离线', ''); }
}
function switchView(v) {
  state.view = v;
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  document.querySelectorAll('.view').forEach((s) => s.classList.add('hidden'));
  $('#view-' + v).classList.remove('hidden');
  ({ write: renderWrite, assets: renderAssets, settings: renderSettings, publish: renderPublish, backup: renderBackup })[v]();
}
async function ensurePreview() {
  if (state.previewUrl) return state.previewUrl;
  toast('预览服务启动中…');
  const r = await api('preview:start');
  state.previewUrl = r.url;
  return r.url;
}

/* ---------- 写作台 ---------- */
function newDraft() {
  state.current = { id: null, title: '未命名草稿', summary: '', tags: [], draft: true, cover: null, publishAt: new Date().toISOString(), publishAtRaw: null, body: '' };
  switchView('write');
}
function renderWrite() {
  const v = $('#view-write');
  const c = state.current;
  v.innerHTML = `
  <div class="write-grid">
    <div class="panel">
      <h3>稿件列表 <button class="link" id="newBtn" style="float:right">＋ 新建</button></h3>
      <input class="search" id="search" placeholder="搜索稿件标题或标签" />
      <div class="post-list" id="postList"></div>
    </div>
    <div class="panel">
      <div class="editor-tabs">
        <button data-m="edit" class="${state.mode === 'edit' ? 'active' : ''}">编辑</button>
        <button data-m="preview" class="${state.mode === 'preview' ? 'active' : ''}">预览</button>
      </div>
      ${state.mode === 'edit' ? `
        <input class="title-input" id="titleInput" value="${esc(c?.title || '')}" placeholder="标题" />
        <div class="toolbar" id="toolbar">
          <button data-md="**" title="加粗">B</button>
          <button data-md="*" title="斜体">I</button>
          <button data-md="## " title="小节">H2</button>
          <button data-md="link" title="链接">🔗</button>
          <button data-md="img" title="图片">🖼</button>
          <button data-md="> " title="引用">❝</button>
          <button data-md="code" title="代码">&lt;/&gt;</button>
          <button data-md="---" title="分隔">—</button>
        </div>` : ''}
      <div id="editorBody" style="flex:1;display:flex;gap:10px;min-height:0">
        ${state.mode === 'edit' ? '<textarea class="md" id="md" placeholder="开始写……（Markdown）"></textarea>' : ''}
        ${state.mode === 'preview' ? '<iframe class="preview" id="pv"></iframe>' : ''}
      </div>
      <div class="autosave" id="autosave">自动保存已开启</div>
    </div>
    <div class="panel meta-panel" id="metaPanel"></div>
  </div>`;
  $('#newBtn').onclick = newDraft;
  $('#search').oninput = (e) => fillList(e.target.value);
  fillList('');
  v.querySelectorAll('.editor-tabs button').forEach((b) => (b.onclick = async () => {
    state.mode = b.dataset.m;
    if (state.mode !== 'edit') await guard(ensurePreview);
    renderWrite();
    syncPreview();
  }));
  if (c) {
    if ($('#md')) $('#md').value = c.body || '';
    const ti = $('#titleInput');
    if (ti) ti.oninput = (e) => { c.title = e.target.value; scheduleSave(); };
    if ($('#md')) $('#md').oninput = (e) => { c.body = e.target.value; scheduleSave(); };
    $('#toolbar')?.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      insertMd(b.dataset.md);
    });
  }
  renderMeta();
  syncPreview();
}
function fillList(q) {
  const list = $('#postList');
  const now = Date.now();
  const items = state.posts.filter((p) => !q || p.title.includes(q) || p.tags.some((t) => t.includes(q)));
  list.innerHTML = items.map((p) => `
    <div class="post-item ${state.current && state.current.id === p.id ? 'active' : ''}" data-id="${esc(p.id)}">
      ${p.cover ? `<img class="thumb" src="${assetUrl(p.cover)}" alt="">` : '<div class="thumb thumb-empty">lane</div>'}
      <div>
        <div class="t">${esc(p.title)}${p.draft ? '<span class="badge draft">草稿</span>' : ''}${!p.draft && p.publishAt && new Date(p.publishAt) > now ? '<span class="badge">定时</span>' : ''}</div>
        <div class="m">${esc(p.tags[0] || '随笔')} · ${fmtDate(p.publishAt)}</div>
      </div>
    </div>`).join('') || '<div class="hint">没有稿件</div>';
  list.querySelectorAll('.post-item').forEach((el) => (el.onclick = () => {
    state.current = { ...state.posts.find((p) => p.id === el.dataset.id) };
    renderWrite();
  }));
}
function insertMd(kind) {
  const ta = $('#md'); if (!ta) return;
  const [s, e] = [ta.selectionStart, ta.selectionEnd];
  const sel = ta.value.slice(s, e) || '文字';
  let ins = '';
  if (kind === 'link') ins = `[${sel}](https://)`;
  else if (kind === 'img') ins = `![${sel}](../../assets/)`;
  else if (kind === 'code') ins = '```\n' + sel + '\n```';
  else if (kind === '---') ins = '\n---\n';
  else if (kind.endsWith(' ')) ins = kind + sel;
  else ins = kind + sel + kind;
  ta.value = ta.value.slice(0, s) + ins + ta.value.slice(e);
  ta.focus();
  state.current.body = ta.value;
  scheduleSave();
}
function scheduleSave() {
  const c = state.current;
  if (!c) return;
  $('#autosave').textContent = '编辑中…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (state.current !== c) return; // 稿件已切换 / 删除：禁止回写复活
    await guard(async () => {
      const r = await api('posts:save', { ...c, cover: mdCover(c.cover) });
      if (!c.id) c.id = r.id;
      $('#autosave').textContent = '自动保存成功 ' + new Date().toLocaleTimeString('zh-CN');
      state.posts = await api('posts:list');
      fillList($('#search')?.value || '');
      if (state.mode === 'preview') syncPreview(true);
    });
  }, 900);
}
async function syncPreview(bust) {
  const pv = $('#pv'); if (!pv) return;
  const url = await ensurePreview().catch(() => null);
  if (!url || !pv.isConnected) return;
  const c = state.current;
  // v1.31：切换与保存一律带缓存失效参数强制重载，杜绝 iframe 复用缓存旧文档
  const suffix = '?v=' + Date.now();
  pv.src = c && c.id ? url + 'posts/' + (c.slug || c.id) + '/' + suffix : url + suffix;
}
function renderMeta() {
  const m = $('#metaPanel'); const c = state.current;
  if (!c) { m.innerHTML = '<div class="meta-scroll"><div class="hint">选择或新建一篇稿件</div></div>'; return; }
  const bodyImages = [...(c.body || '').matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)].map((mm) => ({ alt: mm[1], src: mm[2], raw: mm[0] }));
  m.innerHTML = `
    <div class="meta-scroll">
    <div class="meta-group"><h4>标签</h4>
      <div class="chips">${c.tags.map((t) => `<span class="chip" data-t="${esc(t)}">${esc(t)} ×</span>`).join('')}</div>
      <button class="add-chip" id="addTag">添加标签</button>
    </div>
    <div class="meta-group"><h4>封面</h4>
      <div class="cover-drop" id="coverDrop">${c.cover ? `<img src="${assetUrl(c.cover)}" alt="">` : '点击或拖入图片（自动压缩为 WebP）'}</div>
      ${c.cover ? '<button class="link danger" id="coverRemove" style="margin-top:6px">移除封面</button>' : ''}
    </div>
    <div class="meta-group"><h4>正文图片</h4>
      ${bodyImages.length ? bodyImages.map((im, i) => `
        <div class="form-row" style="display:flex;gap:6px;align-items:center">
          <span style="flex:1;font-size:12px;color:var(--muted);word-break:break-all">${esc(im.alt || im.src)}</span>
          <button class="link danger" data-bimg="${i}">移除</button>
        </div>`).join('') : '<div class="hint">正文暂无图片</div>'}
    </div>
    <div class="meta-group"><h4>发布时间</h4>
      <input type="datetime-local" id="pubAt" value="${localInput(c.publishAt)}" />
      <div class="hint">未来时间 = 定时发布；云端每 30 分钟兜底重建，客户端在线时分钟级准点。</div>
      <label class="check"><input type="checkbox" id="draftChk" ${c.draft ? 'checked' : ''}> 存为草稿（不上线）</label>
    </div>
    <div class="meta-group"><h4>摘要</h4><textarea class="small" id="summary">${esc(c.summary)}</textarea></div>
    <div class="meta-group"><h4>路径别名</h4><input type="text" id="slug" value="${esc(c.slug || c.id || '')}" placeholder="留空用文件名" />
      <div class="hint">小写字母 / 数字 / 连字符；失焦或回车提交，输入过程不打断。</div></div>
    </div>
    <button class="link danger meta-del" id="delPost">删除此稿</button>`;
  m.querySelectorAll('.chip').forEach((ch) => (ch.onclick = () => { c.tags = c.tags.filter((t) => t !== ch.dataset.t); renderMeta(); scheduleSave(); }));
  $('#addTag').onclick = () => {
    const t = prompt('新标签名称'); if (!t) return;
    c.tags = [...new Set([...c.tags, t.trim()])]; renderMeta(); scheduleSave();
  };
  $('#coverDrop').onclick = () => pickFiles(async (paths) => {
    const r = await api('assets:import', { paths });
    c.cover = r[0].rel; renderMeta(); scheduleSave(); toast('封面已设置');
  });
  $('#coverDrop').ondragover = (e) => e.preventDefault();
  $('#coverDrop').ondrop = async (e) => {
    e.preventDefault();
    const paths = [...e.dataTransfer.files].map((f) => window.lane.getPathForFile(f));
    const r = await api('assets:import', { paths });
    c.cover = r[0].rel; renderMeta(); scheduleSave();
  };
  const coverRemove = $('#coverRemove');
  if (coverRemove) coverRemove.onclick = () => { c.cover = null; renderMeta(); scheduleSave(); };
  m.querySelectorAll('[data-bimg]').forEach((b) => (b.onclick = () => {
    const im = bodyImages[+b.dataset.bimg];
    if (!im) return;
    c.body = (c.body || '').replace(im.raw, '').replace(/\n{3,}/g, '\n\n');
    if ($('#md')) $('#md').value = c.body;
    renderMeta(); scheduleSave();
    if (state.mode === 'preview') syncPreview(true);
  }));
  $('#pubAt').onchange = (e) => { c.publishAt = fromLocalInput(e.target.value); c.publishAtRaw = c.publishAt; scheduleSave(); };
  $('#draftChk').onchange = (e) => { c.draft = e.target.checked; scheduleSave(); };
  $('#summary').oninput = (e) => { c.summary = e.target.value; scheduleSave(); };
  $('#slug').oninput = (e) => { c.slug = e.target.value; };
  $('#slug').onchange = () => scheduleSave();
  $('#slug').onblur = () => scheduleSave();
  $('#slug').onkeydown = (e) => { if (e.key === 'Enter') { e.target.blur(); } };
  $('#delPost').onclick = () => guard(async () => {
    if (!confirm(`删除《${c.title}》？此操作不可撤销（Git 历史仍可找回）。`)) return;
    if (c.id) await api('posts:delete', { id: c.id });
    state.current = null; state.posts = await api('posts:list');
    renderWrite(); toast('已删除');
  });
}
function pickFiles(cb, multiple = false) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = multiple;
  inp.onchange = () => cb([...inp.files].map((f) => window.lane.getPathForFile(f)));
  inp.click();
}

/* ---------- 素材库 ---------- */
async function renderAssets() {
  const v = $('#view-assets');
  const assets = await api('assets:list');
  const total = assets.reduce((s, a) => s + a.size, 0);
  v.innerHTML = `
    <div class="dropzone" id="dz">拖拽图片到此处，或 <button class="link" id="upBtn">选择文件上传</button> · 自动压缩 / WebP / 规范命名 · 共 ${assets.length} 项 ${(total / 1048576).toFixed(1)} MB</div>
    <div class="assets-grid">${assets.map((a) => `
      <div class="asset-card">
        <img src="${assetUrl(a.rel)}" alt="">
        <div class="n">${esc(a.name)} · ${(a.size / 1024).toFixed(0)} KB</div>
        <div class="row"><button class="link" data-ins="${esc(a.rel)}">插入文章</button><button class="link danger" data-del="${esc(a.name)}">删除</button></div>
      </div>`).join('')}</div>`;
  $('#upBtn').onclick = () => pickFiles(async (paths) => { await api('assets:import', { paths }); toast('已导入并压缩'); renderAssets(); }, true);
  const dz = $('#dz');
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = async (e) => {
    e.preventDefault(); dz.classList.remove('over');
    const paths = [...e.dataTransfer.files].map((f) => window.lane.getPathForFile(f));
    await guard(async () => { await api('assets:import', { paths }); toast('已导入并压缩'); renderAssets(); });
  };
  v.querySelectorAll('[data-ins]').forEach((b) => (b.onclick = () => {
    if (!state.current) newDraft();
    const md = `![${b.dataset.ins.split('/').pop()}](../../${b.dataset.ins.replace(/^src\//, '')})`;
    state.current.body = (state.current.body || '') + '\n\n' + md + '\n';
    scheduleSave(); switchView('write'); toast('已插入当前稿件');
  }));
  v.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => guard(async () => {
    if (!confirm(`删除素材 ${b.dataset.del}？请先确认无文章引用。`)) return;
    await api('assets:delete', { name: b.dataset.del }); renderAssets();
  })));
}

/* ---------- 页面设置 ---------- */
async function renderSettings() {
  const v = $('#view-settings');
  const s = state.settings || (await api('settings:get'));
  s.theme = s.theme || {};
  s.social = s.social || [];
  state.settings = s;
  const t = s.theme;
  let lastBase = s.basePath;
  v.innerHTML = `
  <div class="settings-grid">
    <div class="panel" style="overflow:auto">
      <h3>站点信息</h3>
      <div class="form-row"><label>站名</label><input type="text" id="sName" value="${esc(s.siteName)}"></div>
      <div class="form-row"><label>一句话简介</label><input type="text" id="sTag" value="${esc(s.tagline)}"></div>
      <div class="form-row"><label>作者</label><input type="text" id="sAuthor" value="${esc(s.author)}"></div>
      <div class="form-row"><label>站点 URL</label><input type="text" id="sUrl" value="${esc(s.siteUrl)}"></div>
      <div class="form-row"><label>basePath（Pages 项目页路径）</label><input type="text" id="sBase" value="${esc(s.basePath)}"></div>
      <h3>导航（增删排序）</h3><div id="navRows"></div><button class="add-chip" id="navAdd">添加导航项</button>
      <h3 style="margin-top:14px">社交链接</h3><div id="socRows"></div><button class="add-chip" id="socAdd">添加链接</button>
      <h3 style="margin-top:14px">主题外观</h3>
      <div class="form-row"><label>墙面预设</label><select id="tWall">
        <option value="midnight" selected>午夜霓虹巷（默认）</option>
      </select></div>
      <div class="form-row"><label>海报圆角</label><div class="range-row"><input type="range" id="tRadius" min="6" max="14" step="1" value="${t.radius ?? 10}"><output>${t.radius ?? 10}px</output></div></div>
      <div class="form-row"><label>倾斜幅度</label><div class="range-row"><input type="range" id="tTilt" min="0" max="3" step="0.5" value="${t.tilt ?? 1.5}"><output>${t.tilt ?? 1.5}°</output></div></div>
      <div class="form-row"><label>拼贴密度</label><select id="tDensity">
        <option value="loose" ${t.density === 'loose' ? 'selected' : ''}>疏</option>
        <option value="mid" ${t.density === 'mid' ? 'selected' : ''}>中</option>
        <option value="dense" ${t.density === 'dense' ? 'selected' : ''}>密</option>
      </select></div>
      <div class="form-row"><label>字体搭配</label><select id="tFont">
        <option value="default" ${!t.fontPair || t.fontPair === 'default' ? 'selected' : ''}>默认（黑体标题 + 宋体正文）</option>
        <option value="sans" ${t.fontPair === 'sans' ? 'selected' : ''}>全无衬线</option>
        <option value="serif" ${t.fontPair === 'serif' ? 'selected' : ''}>全衬线</option>
      </select></div>
      <div class="form-row"><label>自定义标题字体（留空用预设）</label><input type="text" id="fDisplay" value="${esc(t.fontDisplay || '')}" placeholder='"Archivo Black", sans-serif'></div>
      <div class="form-row"><label>自定义正文字体（留空用预设）</label><input type="text" id="fBody" value="${esc(t.fontBody || '')}" placeholder='"Inter", serif'></div>
      <label class="check"><input type="checkbox" id="tStickers" ${t.stickers !== false ? 'checked' : ''}> 星爆贴纸</label>
      <label class="check"><input type="checkbox" id="tAnim" ${t.entranceAnimation !== false ? 'checked' : ''}> 巷口霓虹动画</label>
      <h3 style="margin-top:14px">关于页正文</h3>
      <textarea class="small" id="sAbout" style="min-height:110px">${esc(s.about)}</textarea>
      <div class="wizard-actions"><button class="primary-btn" id="saveSettings">保存设置</button></div>
      <div class="hint">改动自动保存并即时刷新预览；basePath 变更会自动重启预览服务；随发布流水线上线。</div>
    </div>
    <div class="panel"><h3>即时预览</h3><iframe class="preview" id="setPv"></iframe></div>
  </div>`;
  let saveTimer = null;
  const doSave = async (notify) => {
    await api('settings:save', s);
    if (s.basePath !== lastBase) {
      lastBase = s.basePath;
      await api('preview:stop');
      state.previewUrl = null;
    }
    const pv = $('#setPv');
    if (pv) pv.src = (await ensurePreview()) + '?v=' + Date.now();
    if (notify) toast('设置已保存');
  };
  const queue = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => guard(() => doSave(false)), 700); };
  const navRows = $('#navRows');
  const drawNav = () => {
    navRows.innerHTML = s.nav.map((n, i) => `
      <div class="form-row" style="display:flex;gap:6px">
        <input type="text" data-nl="${i}" value="${esc(n.label)}" style="flex:1">
        <input type="text" data-nh="${i}" value="${esc(n.href)}" style="flex:1">
        <button class="link" data-nu="${i}" title="上移">↑</button>
        <button class="link" data-nd="${i}" title="下移">↓</button>
        <button class="link danger" data-nx="${i}">×</button>
      </div>`).join('');
    navRows.querySelectorAll('[data-nl]').forEach((inp) => (inp.oninput = () => { s.nav[+inp.dataset.nl].label = inp.value; queue(); }));
    navRows.querySelectorAll('[data-nh]').forEach((inp) => (inp.oninput = () => { s.nav[+inp.dataset.nh].href = inp.value; queue(); }));
    navRows.querySelectorAll('[data-nx]').forEach((b) => (b.onclick = () => { s.nav.splice(+b.dataset.nx, 1); drawNav(); queue(); }));
    navRows.querySelectorAll('[data-nu]').forEach((b) => (b.onclick = () => { const i = +b.dataset.nu; if (i > 0) { [s.nav[i - 1], s.nav[i]] = [s.nav[i], s.nav[i - 1]]; drawNav(); queue(); } }));
    navRows.querySelectorAll('[data-nd]').forEach((b) => (b.onclick = () => { const i = +b.dataset.nd; if (i < s.nav.length - 1) { [s.nav[i + 1], s.nav[i]] = [s.nav[i], s.nav[i + 1]]; drawNav(); queue(); } }));
  };
  drawNav();
  $('#navAdd').onclick = () => { s.nav.push({ label: '新页面', href: '/' }); drawNav(); queue(); };
  const socRows = $('#socRows');
  const drawSoc = () => {
    socRows.innerHTML = s.social.map((n, i) => `
      <div class="form-row" style="display:flex;gap:6px">
        <input type="text" data-sl="${i}" value="${esc(n.label)}" style="flex:1">
        <input type="text" data-sh="${i}" value="${esc(n.href)}" style="flex:1">
        <button class="link danger" data-sx="${i}">×</button>
      </div>`).join('') || '<div class="hint">暂无社交链接</div>';
    socRows.querySelectorAll('[data-sl]').forEach((inp) => (inp.oninput = () => { s.social[+inp.dataset.sl].label = inp.value; queue(); }));
    socRows.querySelectorAll('[data-sh]').forEach((inp) => (inp.oninput = () => { s.social[+inp.dataset.sh].href = inp.value; queue(); }));
    socRows.querySelectorAll('[data-sx]').forEach((b) => (b.onclick = () => { s.social.splice(+b.dataset.sx, 1); drawSoc(); queue(); }));
  };
  drawSoc();
  $('#socAdd').onclick = () => { s.social.push({ label: '链接', href: 'https://' }); drawSoc(); queue(); };
  const bind = (id, fn) => ($(id).oninput = (e) => { fn(e.target); queue(); });
  bind('#sName', (el) => (s.siteName = el.value));
  bind('#sTag', (el) => (s.tagline = el.value));
  bind('#sAuthor', (el) => (s.author = el.value));
  bind('#sUrl', (el) => (s.siteUrl = el.value));
  bind('#sBase', (el) => (s.basePath = el.value));
  bind('#sAbout', (el) => (s.about = el.value));
  bind('#tWall', (el) => (s.theme.wall = el.value));
  bind('#tDensity', (el) => (s.theme.density = el.value));
  bind('#tFont', (el) => (s.theme.fontPair = el.value));
  bind('#fDisplay', (el) => (s.theme.fontDisplay = el.value || undefined));
  bind('#fBody', (el) => (s.theme.fontBody = el.value || undefined));
  $('#tRadius').oninput = (e) => { s.theme.radius = +e.target.value; e.target.nextElementSibling.textContent = e.target.value + 'px'; queue(); };
  $('#tTilt').oninput = (e) => { s.theme.tilt = +e.target.value; e.target.nextElementSibling.textContent = e.target.value + '°'; queue(); };
  $('#tStickers').onchange = (e) => { s.theme.stickers = e.target.checked; queue(); };
  $('#tAnim').onchange = (e) => { s.theme.entranceAnimation = e.target.checked; queue(); };
  $('#saveSettings').onclick = () => guard(() => doSave(true));
  guard(async () => { $('#setPv').src = await ensurePreview(); });
}

/* ---------- 发布管理 ---------- */
async function renderPublish() {
  const v = $('#view-publish');
  const [sched, hist] = await Promise.all([
    api('publish:scheduled').catch(() => []),
    api('publish:history').catch(() => [])
  ]);
  const drafts = state.posts.filter((p) => p.draft).length;
  const published = state.posts.filter((p) => !p.draft && p.publishAt && new Date(p.publishAt) <= Date.now());
  v.innerHTML = `
    <div class="card-row">
      <div class="stat-card"><div class="k">GitHub 连接</div><div class="hint">连接账号并从模板创建博客仓库（首次向导）；已连接后可在此重新进入向导。</div><br><button class="ghost-btn" id="wizBtn">连接 / 新建博客</button></div>
      <div class="stat-card"><div class="k">云端状态</div><div class="v" id="pubState">…</div><button class="link" id="refStatus">刷新</button></div>
      <div class="stat-card"><div class="k">定时待发</div><div class="v">${sched.length}</div></div>
      <div class="stat-card"><div class="k">草稿</div><div class="v">${drafts}</div></div>
      <div class="stat-card"><div class="k">已上线</div><div class="v">${published.length}</div></div>
    </div>
    <div class="panel" style="margin-bottom:16px">
      <h3>定时发布队列</h3>
      <table class="list"><tr><th>标题</th><th>发布时间</th><th>机制</th></tr>
      ${sched.map((p) => `<tr><td>${esc(p.title)}</td><td>${fmtDate(p.publishAt)}</td><td>客户端准点 + 云端兜底</td></tr>`).join('') || '<tr><td colspan="3">无</td></tr>'}
      </table>
    </div>
    <div class="panel" style="margin-bottom:16px">
      <h3>已上线文章</h3>
      <table class="list"><tr><th>标题</th><th>发布时间</th><th>操作</th></tr>
      ${published.map((p) => `<tr><td>${esc(p.title)}</td><td>${fmtDate(p.publishAt)}</td><td><button class="link danger" data-unpub="${esc(p.id)}">撤回</button></td></tr>`).join('') || '<tr><td colspan="3">无</td></tr>'}
      </table>
    </div>
    <div class="panel"><h3>发布历史（Git）</h3>
      <table class="list"><tr><th>提交</th><th>时间</th><th>说明</th></tr>
      ${hist.map((h) => `<tr><td>${esc(h.hash)}</td><td>${fmtDate(h.date)}</td><td>${esc(h.message)}</td></tr>`).join('')}
      </table>
    </div>`;
  const refresh = async () => { const s = await api('publish:status'); $('#pubState').textContent = s.label; };
  refresh();
  $('#wizBtn').onclick = () => showWizard();
  $('#refStatus').onclick = refresh;
  v.querySelectorAll('[data-unpub]').forEach((b) => (b.onclick = () => guard(async () => {
    if (!confirm('撤回后线上立即移除该文章，确认？')) return;
    await api('publish:unpublish', { id: b.dataset.unpub });
    toast('已撤回并推送'); state.posts = await api('posts:list'); renderPublish();
  })));
}

/* ---------- 备份导出 ---------- */
function renderBackup() {
  const v = $('#view-backup');
  v.innerHTML = `
    <div class="card-row">
      <div class="stat-card"><div class="k">一键导出</div><div class="hint">全部文章 + 图片 + 站点设置打包为 zip。</div><br><button class="primary-btn" id="expBtn">导出备份</button></div>
      <div class="stat-card"><div class="k">导入恢复</div><div class="hint">从备份包完整恢复内容库，可迁移到新电脑；目标目录需已含主题（先克隆 lane-theme 或复制模板）。</div><br><button class="ghost-btn" id="impBtn">导入备份</button></div>
      <div class="stat-card"><div class="k">Git 历史</div><div class="hint">每次发布自动提交，历史即天然版本备份；发布管理页可查看。</div></div>
    </div>`;
  $('#expBtn').onclick = () => guard(async () => {
    const d = await api('dialog:save', { defaultPath: `lane-backup-${new Date().toISOString().slice(0, 10)}.zip` });
    if (!d || d.canceled) return;
    await api('backup:export', { dest: d.filePath });
    toast('备份已导出：' + d.filePath);
  });
  $('#impBtn').onclick = () => guard(async () => {
    const f = await api('dialog:open', { filters: [{ name: 'Zip', extensions: ['zip'] }] });
    if (!f || f.canceled) return;
    let r = await api('backup:import', { file: f.filePaths[0] });
    if (r.needDir) {
      toast('默认恢复目录已存在，请选择恢复目标目录');
      const dir = await api('dialog:openDir', { defaultPath: r.defaultPath });
      if (!dir || dir.canceled) return;
      r = await api('backup:import', { file: f.filePaths[0], dest: dir.filePaths[0] });
    }
    state.info.repoPath = r.repoPath; state.current = null;
    await loadAll(); switchView('write'); toast('已恢复内容库：' + r.repoPath);
  });
}

/* ---------- 首次向导 ---------- */
function showWizard() {
  const w = $('#wizard');
  w.classList.remove('hidden');
  let step = 0;
  const tl = state.info.templateLocal || '';
  const defParent = tl ? tl.replace(/[\\/][^\\/]+$/, '') : (state.info.documentsPath || '');
  const data = { token: '', repoName: 'lane', private: false, mode: 'local', templateOwner: '', templateRepo: 'lane-theme', parentDir: defParent };
  const draw = () => {
    const steps = `<div class="steps">${[0, 1, 2].map((i) => `<span class="${i <= step ? 'on' : ''}"></span>`).join('')}</div>`;
    if (step === 0) w.innerHTML = `<div class="wizard-card">${steps}
      <h2>连接 GitHub</h2><div class="sub">只需一个账号。粘贴 Personal Access Token（勾选 repo 与 workflow 权限），或打开已有内容库。</div>
      <div class="form-row"><label>Token</label><input type="password" id="wToken" value="${esc(data.token)}" placeholder="github_pat_… / ghp_…"></div>
      <div class="hint"><button class="link" id="wTokenLink">在 GitHub 创建 Token</button>（scopes: repo, workflow）${state.info.hasToken ? '；已保存 Token，可留空直接继续' : ''}</div>
      <div class="wizard-actions"><button class="ghost-btn" id="wOpen">打开已有内容库</button><button class="primary-btn" id="wNext">验证并继续</button></div></div>`;
    if (step === 1) w.innerHTML = `<div class="wizard-card">${steps}
      <h2>创建博客仓库</h2><div class="sub">从 lane-theme 模板初始化：本地模板复制（推荐，离线可用）或 GitHub 模板仓库生成。</div>
      <div class="form-row"><label>仓库名</label><input type="text" id="wName" value="${esc(data.repoName)}"></div>
      <div class="form-row"><label>存放目录</label><input type="text" id="wParent" value="${esc(data.parentDir)}"></div>
      <div class="hint">将创建「存放目录 / 仓库名」；存放目录须与模板同级或其外，不能位于模板目录内部。</div>
      <label class="check"><input type="radio" name="wMode" value="local" ${data.mode === 'local' ? 'checked' : ''}> 本地模板初始化</label>
      <label class="check"><input type="radio" name="wMode" value="template" ${data.mode === 'template' ? 'checked' : ''}> GitHub 模板仓库生成</label>
      <div id="wTpl" class="${data.mode === 'template' ? '' : 'hidden'}">
        <div class="form-row"><label>模板 owner/repo</label><input type="text" id="wTplRepo" value="${esc(data.templateOwner)}/lane-theme" placeholder="你的用户名/lane-theme"></div>
      </div>
      <label class="check"><input type="checkbox" id="wPriv" ${data.private ? 'checked' : ''}> 私有仓库（Actions 免费额度有限，建议公开）</label>
      <div class="wizard-actions"><button class="ghost-btn" id="wBack">上一步</button><button class="primary-btn" id="wNext">创建并开通 Pages</button></div></div>`;
    if (step === 2) w.innerHTML = `<div class="wizard-card">${steps}
      <h2>完成</h2><div class="sub">内容库已就绪，示例文章已装配。写第一篇吧。</div>
      <div class="wizard-actions"><button class="primary-btn" id="wDone">进入写作台</button></div></div>`;
    $('#wTokenLink') && ($('#wTokenLink').onclick = () => api('open:external', { url: 'https://github.com/settings/tokens/new?scopes=repo,workflow&description=lane-client' }));
    $('#wOpen') && ($('#wOpen').onclick = () => guard(async () => {
      const d = await api('dialog:openDir', {});
      if (!d || d.canceled) return;
      await api('repo:open', { path: d.filePaths[0] });
      w.classList.add('hidden'); state.info.hasRepo = true; state.info.repoPath = d.filePaths[0];
      await loadAll(); switchView('write');
    }));
    $('#wBack') && ($('#wBack').onclick = () => { step = 0; draw(); });
    $('#wDone') && ($('#wDone').onclick = async () => { w.classList.add('hidden'); await loadAll(); switchView('write'); });
    $('#wNext') && ($('#wNext').onclick = () => guard(async () => {
      if (step === 0) {
        data.token = $('#wToken').value.trim() || (await api('wizard:stored')).token;
        if (!data.token) throw new Error('请填写 Token');
        const u = await api('wizard:verify', { token: data.token });
        toast('已连接：' + u.login);
        step = 1; draw();
      } else if (step === 1) {
        data.repoName = $('#wName').value.trim() || 'lane';
        data.parentDir = $('#wParent').value.trim();
        data.private = $('#wPriv').checked;
        data.mode = document.querySelector('input[name=wMode]:checked').value;
        const tpl = ($('#wTplRepo')?.value || '').split('/');
        data.templateOwner = tpl[0] || ''; data.templateRepo = tpl[1] || 'lane-theme';
        if (!data.parentDir) throw new Error('请填写存放目录');
        const r = await api('wizard:setup', data);
        state.info.repoPath = r.repoPath; state.info.hasRepo = true;
        step = 2; draw();
      }
    }));
  };
  draw();
}

init();