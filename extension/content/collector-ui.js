/**
 * collector-ui.js — 通用采集面板（隔离世界）
 * 提供悬浮按钮 + 采集面板；平台扫描器通过 window.__IMGCOLLECTOR__ 接入；
 * MAIN world 提取器（豆包/即梦）通过 postMessage 桥接投递素材。
 */
(function () {
  'use strict';

  if (window.__IMGCOLLECTOR__) return;

  const state = {
    platform: '图片收集',
    scanFn: null,
    items: [],
    selected: new Set(),
    knownIds: null,       // 已见过的素材 id（用于区分「用户取消勾选」与「新素材」）
    pushedLinks: new Map(), // id -> 推送后的链接
    filters: { type: 'all', format: 'all', minHeight: 0, minSizeMB: 0 },
    sizes: {}             // url -> 字节数（由 background 探测）
  };

  /* ---------- 基础工具 ---------- */

  function filenameFor(it) {
    if (it.filename) return it.filename;
    const ext = it.ext || (window.ImgNormalize && window.ImgNormalize.extFromUrl(it.url)) || 'jpg';
    let base = 'image';
    try {
      const seg = new URL(it.url).pathname.split('/').filter(Boolean).pop();
      if (seg && seg.indexOf('.') > 0) base = seg.replace(/\.[^.]+$/, '').slice(0, 60);
    } catch (e) { /* ignore */ }
    return (it.platform || 'image').toLowerCase() + '_' + Date.now().toString(36) + '_' + base + '.' + ext;
  }

  function normalizeItem(it, idx) {
    const item = Object.assign({}, it);
    // 媒体身份：归一化掉尺寸/质量标记，用于合并同一素材的不同清晰度版本
    item.identity = item.identity ||
      (window.ImgNormalize && window.ImgNormalize.mediaIdentity(item.url)) || item.url;
    // 稳定的 id：优先自带 id，否则由身份哈希生成（版本变化时选择状态不漂移）
    item.id = item.id ||
      'auto_' + ((window.ImgNormalize && window.ImgNormalize.shortHash(item.identity)) || (idx || 0));
    item.platform = item.platform || state.platform;
    item.ext = item.ext || (window.ImgNormalize && window.ImgNormalize.extFromUrl(item.url)) || 'jpg';
    item.type = item.type || (window.ImgNormalize && window.ImgNormalize.mediaTypeFromExt(item.ext)) || 'image';
    item.filename = filenameFor(item);
    item.thumb = item.thumb || item.url;
    return item;
  }

  // 清晰度得分：越小越好（低优先级 > 高清晰度 > 大尺寸 > 大文件）
  function resScore(it) {
    const area = (it.width || 0) * (it.height || 0);
    const q = (window.ImgNormalize && window.ImgNormalize.urlQuality(it.url)) || 0;
    return ((it.priority || 0) + 1) * 1000000000000 - q * 1000000 - area * 1000 - (it.sizeBytes || 0);
  }

  /* ---------- DOM 构建 ---------- */

  const host = document.createElement('div');
  host.id = 'imgcollector-root';
  const shadow = host.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
<style>
:host { all: initial; color-scheme: light dark; }
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; -webkit-font-smoothing: antialiased; }
/* ===== 悬浮按钮（纯白） ===== */
#fab {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483640;
  width: 42px; height: 42px; border-radius: 50%; border: .5px solid rgba(0,0,0,.1); cursor: pointer;
  background: #fff; color: #1a1a1a;
  font-size: 17px; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 14px rgba(0,0,0,.12);
  transition: transform .18s ease, box-shadow .18s ease;
}
#fab:hover { transform: scale(1.05); box-shadow: 0 6px 20px rgba(0,0,0,.16); }
#badge {
  position: absolute; top: -3px; right: -3px; min-width: 18px; height: 18px; padding: 0 5px;
  background: #e5484d; color: #fff; border-radius: 9px; font-size: 10.5px; font-weight: 600;
  display: flex; align-items: center; justify-content: center; line-height: 1;
  box-shadow: 0 1px 4px rgba(0,0,0,.2);
}
/* ===== 面板（居中弹窗，类似无印豆包） ===== */
#modal {
  position: fixed; inset: 0; z-index: 2147483641;
  background: rgba(0,0,0,.42);
  display: flex; align-items: center; justify-content: center;
  animation: icFadeIn .2s ease;
}
#modal.hidden { display: none; }
@keyframes icFadeIn { from { opacity: 0; } to { opacity: 1; } }
.panel {
  position: relative; width: 92%; max-width: 900px; max-height: 84vh;
  background: #fff; color: #1a1a1a;
  border: .5px solid rgba(0,0,0,.09); border-radius: 16px;
  box-shadow: 0 24px 64px rgba(0,0,0,.32), 0 2px 8px rgba(0,0,0,.1);
  display: flex; flex-direction: column; overflow: hidden;
  animation: icPanelIn .22s cubic-bezier(.32,.72,.35,1);
}
@keyframes icPanelIn { from { transform: scale(.97) translateY(10px); opacity: 0; } to { transform: none; opacity: 1; } }
/* ===== 头部 ===== */
.header { padding: 14px 16px 8px; display: flex; align-items: flex-start; justify-content: space-between; }
.header .t { font-size: 15px; font-weight: 700; letter-spacing: -.01em; }
.header .sub { font-size: 11px; color: #8a8a8a; margin-top: 2px; font-weight: 400; }
.header .close {
  background: #f2f2f2; border: none; color: #1a1a1a; width: 26px; height: 26px;
  border-radius: 50%; cursor: pointer; font-size: 12px; line-height: 1; transition: background .15s ease;
}
.header .close:hover { background: #e5e5e5; }
/* ===== 工具栏 ===== */
.toolbar { padding: 0 16px 8px; display: flex; gap: 2px; flex-wrap: wrap; align-items: center; }
.toolbar .status { margin-left: auto; font-size: 11.5px; color: #8a8a8a; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.btn {
  border: none; background: transparent; color: #444; border-radius: 7px;
  padding: 5px 10px; font-size: 12.5px; cursor: pointer; transition: background .15s ease; white-space: nowrap;
  font-weight: 400;
}
.btn:hover { background: rgba(0,0,0,.05); }
.btn:active { background: rgba(0,0,0,.09); }
.btn.primary { background: #1a1a1a; color: #fff; font-weight: 600; }
.btn.primary:hover { background: #333; }
.btn.primary:active { background: #444; }
.btn.github { background: transparent; color: #1a1a1a; border: 1px solid rgba(0,0,0,.3); font-weight: 600; }
.btn.github:hover { background: rgba(0,0,0,.05); border-color: rgba(0,0,0,.5); }
.btn.ghost { color: #999; }
.btn.ghost:hover { background: rgba(0,0,0,.05); }
.btn:disabled { opacity: .4; cursor: not-allowed; }
/* ===== 筛选条 ===== */
.filterbar { padding: 6px 16px 10px; display: flex; gap: 5px; flex-wrap: wrap; align-items: center; border-bottom: 1px solid #f0f0f0; }
.filterbar .flabel { font-size: 10.5px; color: #999; margin-right: -1px; }
.filterbar select {
  border: 1px solid #e0e0e0; background: #fff; border-radius: 7px;
  padding: 4px 20px 4px 7px; font-size: 12px; color: #333; outline: none; max-width: 108px;
  -webkit-appearance: none; appearance: none;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M1 1l3 3 3-3' fill='none' stroke='%23999' stroke-width='1.4' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 6px center;
}
.filterbar select:focus { border-color: #1a1a1a; box-shadow: 0 0 0 3px rgba(0,0,0,.1); }
/* ===== 网格与卡片 ===== */
.grid { flex: 1; overflow-y: auto; padding: 12px 16px 16px; display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; align-content: start; }
.grid::-webkit-scrollbar { width: 7px; }
.grid::-webkit-scrollbar-thumb { background: rgba(0,0,0,.16); border-radius: 4px; }
.card {
  position: relative; border: 1px solid #ececec; border-radius: 12px; overflow: hidden;
  background: #fff; cursor: pointer; user-select: none;
  transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease;
}
.card:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,.08); }
.card.checked { border-color: #1a1a1a; box-shadow: 0 0 0 1px rgba(0,0,0,.3); }
.card .thumb { width: 100%; height: 150px; object-fit: cover; display: block; background: #f2f2f2; }
.card .check {
  position: absolute; top: 6px; left: 6px; width: 18px; height: 18px; margin: 0; cursor: pointer;
  -webkit-appearance: none; appearance: none; border-radius: 6px;
  border: 1.5px solid rgba(0,0,0,.3); background: #fff;
  transition: background .12s ease, border-color .12s ease;
}
.card .check:checked { background: #1a1a1a; border-color: #1a1a1a; }
.card .check:checked::after {
  content: ''; position: absolute; left: 5px; top: 2px; width: 4px; height: 7.5px;
  border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg);
}
.card .dims { position: absolute; right: 6px; bottom: 31px; background: rgba(0,0,0,.6); color: #fff; font-size: 9.5px; padding: 2px 6px; border-radius: 6px; }
.card .type-badge {
  position: absolute; top: 6px; right: 6px; font-size: 9.5px; padding: 2px 6px; border-radius: 6px;
  background: rgba(0,0,0,.06); color: #666;
}
.card .type-badge.video { background: rgba(0,0,0,.08); color: #333; }
.card .acts { display: flex; gap: 4px; padding: 6px; }
.card .acts button {
  flex: 1; border: none; background: #f2f2f2; border-radius: 6px; font-size: 11px;
  padding: 4px 0; cursor: pointer; color: #333; transition: background .12s ease;
}
.card .acts button:hover { background: #e5e5e5; }
.empty { grid-column: 1 / -1; text-align: center; color: #999; padding: 44px 12px; font-size: 12.5px; line-height: 2; }
/* ===== 底部 ===== */
.footer { padding: 8px 16px 12px; border-top: 1px solid #f0f0f0; display: flex; gap: 6px; flex-wrap: wrap; }
.footer .hint { width: 100%; font-size: 10.5px; color: #aaa; }
/* ===== 推送结果浮层 ===== */
.result-overlay {
  position: absolute; inset: 0; background: #fff; z-index: 5;
  display: flex; flex-direction: column; padding: 14px; overflow-y: auto;
}
.result-overlay h4 { margin: 0 0 8px; font-size: 13px; font-weight: 600; }
.result-list { flex: 1; overflow-y: auto; font-size: 11.5px; color: #444; }
.result-list .row { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px solid #f0f0f0; }
.result-list .row.ok { color: #1f7a3d; }
.result-list .row.fail { color: #c53d43; }
.result-list .row .path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.result-list .row a { color: #333; text-decoration: none; }
.result-list .row a:hover { text-decoration: underline; }
.result-list .row button { border: none; background: #f2f2f2; color: #333; border-radius: 6px; padding: 3px 8px; cursor: pointer; font-size: 10.5px; }
/* ===== Toast ===== */
.toast {
  position: fixed; left: 50%; bottom: 88px; transform: translateX(-50%); z-index: 2147483642;
  background: rgba(20,20,20,.88); color: #fff; padding: 9px 16px; border-radius: 11px;
  font-size: 12.5px; max-width: 70vw; box-shadow: 0 8px 28px rgba(0,0,0,.3);
}
/* ===== 深色模式 ===== */
@media (prefers-color-scheme: dark) {
  #fab { background: #2c2c2c; color: #f5f5f5; border-color: rgba(255,255,255,.12); box-shadow: 0 4px 14px rgba(0,0,0,.45); }
  .panel { background: #1c1c1c; color: #f5f5f5; border-color: rgba(255,255,255,.1); box-shadow: 0 24px 64px rgba(0,0,0,.6), 0 2px 8px rgba(0,0,0,.4); }
  .header .sub { color: #8c8c8c; }
  .header .close { background: rgba(255,255,255,.1); color: #f5f5f5; }
  .header .close:hover { background: rgba(255,255,255,.18); }
  .toolbar .status { color: #8c8c8c; }
  .btn { color: #ccc; }
  .btn:hover { background: rgba(255,255,255,.08); }
  .btn.primary { background: #f5f5f5; color: #1a1a1a; }
  .btn.primary:hover { background: #fff; }
  .btn.github { color: #f5f5f5; border-color: rgba(255,255,255,.4); }
  .btn.github:hover { background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.6); }
  .btn.ghost { color: #666; }
  .filterbar { border-bottom-color: rgba(255,255,255,.1); }
  .filterbar .flabel { color: #666; }
  .filterbar select { background-color: rgba(255,255,255,.08); border-color: rgba(255,255,255,.16); color: #f5f5f5; }
  .filterbar select:focus { border-color: #f5f5f5; box-shadow: 0 0 0 3px rgba(255,255,255,.16); }
  .card { background: #242424; border-color: rgba(255,255,255,.1); }
  .card:hover { box-shadow: 0 4px 12px rgba(0,0,0,.4); }
  .card .check { border-color: rgba(255,255,255,.4); background: transparent; }
  .card .check:checked { background: #f5f5f5; border-color: #f5f5f5; }
  .card .check:checked::after { border-color: #1a1a1a; }
  .card .type-badge { background: rgba(255,255,255,.1); color: #aaa; }
  .card .type-badge.video { background: rgba(255,255,255,.16); color: #eee; }
  .card .acts button { background: rgba(255,255,255,.1); color: #ccc; }
  .card .acts button:hover { background: rgba(255,255,255,.18); }
  .footer { border-top-color: rgba(255,255,255,.1); }
  .footer .hint { color: #666; }
  .result-overlay { background: #1c1c1c; }
  .result-list { color: #ccc; }
  .result-list .row { border-bottom-color: rgba(255,255,255,.08); }
  .result-list .row.ok { color: #3d9a5f; }
  .result-list .row.fail { color: #e36c71; }
  .result-list .row a { color: #ccc; }
  .result-list .row button { background: rgba(255,255,255,.12); color: #ccc; }
  .empty { color: #666; }
  .toast { background: rgba(245,245,245,.94); color: #1a1a1a; }
}
</style>
<button id="fab" title="图片收集器"><span>📷</span><span id="badge" class="badge">0</span></button>
<div id="modal" class="hidden">
  <div class="panel" id="panel">
  <div class="header">
    <div>
      <div class="t" id="title">图片收集器</div>
      <div class="sub" id="subtitle">0 张图片</div>
    </div>
    <button class="close" id="close" title="关闭">✕</button>
  </div>
  <div class="toolbar">
    <button class="btn" id="selAll">全选</button>
    <button class="btn" id="selNone">清空</button>
    <button class="btn" id="invert">反选</button>
    <button class="btn" id="refresh">刷新</button>
    <span class="status" id="status"></span>
  </div>
  <div class="filterbar">
    <span class="flabel">类型</span>
    <select id="fType">
      <option value="all">全部</option>
      <option value="image">图片</option>
      <option value="video">视频</option>
    </select>
    <span class="flabel">格式</span>
    <select id="fFormat">
      <option value="all">全部</option>
      <option value="jpg">JPG</option>
      <option value="png">PNG</option>
      <option value="webp">WEBP</option>
      <option value="gif">GIF</option>
      <option value="other">其他</option>
    </select>
    <span class="flabel">清晰度</span>
    <select id="fHeight">
      <option value="0">不限</option>
      <option value="480">≥480p</option>
      <option value="720">≥720p</option>
      <option value="1080">≥1080p</option>
    </select>
    <span class="flabel">大小</span>
    <select id="fSize">
      <option value="0">不限</option>
      <option value="0.5">≥0.5MB</option>
      <option value="1">≥1MB</option>
      <option value="5">≥5MB</option>
      <option value="10">≥10MB</option>
      <option value="50">≥50MB</option>
    </select>
  </div>
  <div class="grid" id="grid"></div>
  <div class="footer">
    <button class="btn primary" id="downloadSel">⬇ 下载选中 (<span id="selCount">0</span>)</button>
    <button class="btn github" id="pushSel">⬆ 推送 GitHub</button>
    <button class="btn" id="copyMd">复制 Markdown</button>
    <button class="btn ghost" id="settingsBtn">设置</button>
    <div class="hint">提示：滚动页面加载更多后点「刷新」；推送需先在设置中配置 GitHub Token。</div>
  </div>
  </div>
</div>
`;

  (document.body || document.documentElement).appendChild(host);

  const $ = function (id) { return shadow.getElementById(id); };
  const fab = $('fab');
  const modal = $('modal');
  const badge = $('badge');
  const title = $('title');
  const subtitle = $('subtitle');
  const grid = $('grid');
  const statusEl = $('status');
  const selCountEl = $('selCount');

  /* ---------- 筛选 ---------- */

  function visibleItems() {
    const enriched = state.items.map(function (it) {
      if (state.sizes[it.url] != null) return Object.assign({}, it, { sizeBytes: state.sizes[it.url] });
      return it;
    });
    return (window.ImgNormalize && window.ImgNormalize.applyFilters(enriched, state.filters)) || enriched;
  }

  let probeTimer = null;
  function scheduleSizeProbe() {
    clearTimeout(probeTimer);
    probeTimer = setTimeout(function () {
      const need = state.items.filter(function (it) { return state.sizes[it.url] == null; });
      if (!need.length) return;
      chrome.runtime.sendMessage({
        type: 'probeSizes',
        items: need.map(function (it) { return { url: it.url }; })
      }).then(function (res) {
        (res && res.results || []).forEach(function (r) {
          if (r.sizeBytes != null) state.sizes[r.url] = r.sizeBytes;
        });
        render();
      }).catch(function () { /* ignore */ });
    }, 600);
  }

  /* ---------- 渲染 ---------- */

  function setStatus(text, timeout) {
    statusEl.textContent = text || '';
    if (timeout) setTimeout(function () { if (statusEl.textContent === text) statusEl.textContent = ''; }, timeout);
  }

  function toast(text) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    shadow.appendChild(el); // 追加到 shadow 内，样式才能生效（position: fixed 仍相对视口）
    setTimeout(function () { el.remove(); }, 2600);
  }

  function render() {
    badge.textContent = state.items.length;
    title.textContent = state.platform;
    const vis = visibleItems();
    subtitle.textContent = state.items.length + ' 个素材 · 显示 ' + vis.length + ' · 已选 ' + state.selected.size + selectedSizeText();
    selCountEl.textContent = state.selected.size;
    if (modal.classList.contains('hidden')) return;

    if (!vis.length) {
      grid.innerHTML = '<div class="empty">📭 没有符合条件的素材<br>' +
        (state.items.length
          ? '试试放宽筛选条件（类型 / 格式 / 清晰度 / 大小）'
          : '滚动页面加载更多内容后，点击「刷新」重试') +
        '</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    vis.forEach(function (it) {
      const card = document.createElement('div');
      card.className = 'card' + (state.selected.has(it.id) ? ' checked' : '');
      card.dataset.id = it.id;
      const isVid = it.type === 'video';
      const dimsParts = [];
      if (it.width && it.height) dimsParts.push(it.width + '×' + it.height);
      const sizeText = window.ImgNormalize && window.ImgNormalize.formatBytes(state.sizes[it.url]);
      if (sizeText) dimsParts.push(sizeText);
      const dims = dimsParts.length ? '<div class="dims">' + dimsParts.join(' · ') + '</div>' : '';
      const badgeHtml = isVid ? '<div class="type-badge video">🎬 视频</div>' : '<div class="type-badge">🖼 图片</div>';
      card.innerHTML =
        '<img class="thumb" loading="lazy" src="' + escapeAttr(it.thumb) + '" alt="">' +
        '<input type="checkbox" class="check"' + (state.selected.has(it.id) ? ' checked' : '') + '>' +
        badgeHtml +
        dims +
        '<div class="acts">' +
        '  <button data-act="download">下载</button>' +
        '  <button data-act="copy">复制链接</button>' +
        '</div>';
      card.addEventListener('click', function () {
        toggleSelect(it.id, card);
      });
      card.querySelector('.check').addEventListener('click', function (e) {
        e.stopPropagation();
        toggleSelect(it.id, card);
      });
      card.querySelector('[data-act="download"]').addEventListener('click', function (e) {
        e.stopPropagation();
        doDownload([it]);
      });
      card.querySelector('[data-act="copy"]').addEventListener('click', function (e) {
        e.stopPropagation();
        copyText(it.url);
        toast('已复制链接');
      });
      frag.appendChild(card);
    });
    grid.innerHTML = '';
    grid.appendChild(frag);
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function toggleSelect(id, card) {
    if (state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
    if (card) card.classList.toggle('checked', state.selected.has(id));
    render();
  }

  function setItems(items) {
    const normalized = (items || []).map(normalizeItem);
    // 刷新时自动选最大清晰度：同一素材（identity）只保留分辨率/优先级最高的一个版本
    const best = new Map();
    for (const it of normalized) {
      const key = it.identity || it.url;
      const prev = best.get(key);
      if (!prev || resScore(it) < resScore(prev)) best.set(key, it);
    }
    state.items = Array.from(best.values());
    const priorSel = state.selected;
    const known = state.knownIds || new Set();
    const next = new Set();
    state.items.forEach(function (it) {
      // 保持已勾选状态；新出现的素材默认选中
      if (priorSel.has(it.id) || !known.has(it.id)) next.add(it.id);
    });
    state.knownIds = new Set(state.items.map(function (it) { return it.id; }));
    state.selected = next;
    if (state.filters.minSizeMB > 0) scheduleSizeProbe();
    render();
  }

  /* ---------- 动作 ---------- */

  function selectedItems() {
    const set = state.selected;
    const vis = visibleItems();
    return vis.filter(function (it) { return set.has(it.id); });
  }

  // 已选素材合计大小（仅统计已知大小的）
  function selectedSizeText() {
    const sel = selectedItems();
    let bytes = 0;
    let known = 0;
    sel.forEach(function (it) {
      const b = state.sizes[it.url];
      if (b != null) { bytes += b; known++; }
    });
    if (!known) return '';
    return ' · 合计 ' + ((window.ImgNormalize && window.ImgNormalize.formatBytes(bytes)) || '');
  }

  async function doDownload(items) {
    if (!items.length) { toast('请先选择图片'); return; }
    setStatus('正在下载 ' + items.length + ' 张…');
    try {
      const res = await chrome.runtime.sendMessage({ type: 'downloadItems', items: items });
      const failed = (res && res.filter ? res.filter(function (r) { return !r.ok; }) : []);
      if (res && res.ok === false && res.error) { setStatus('下载失败: ' + res.error); toast('下载失败: ' + res.error); return; }
      if (failed.length) {
        setStatus('完成：成功 ' + (items.length - failed.length) + '，失败 ' + failed.length);
        toast('有 ' + failed.length + ' 张下载失败（可能链接已过期）');
      } else {
        setStatus('已开始下载 ' + items.length + ' 张');
        toast('已开始下载 ' + items.length + ' 张到本地下载文件夹');
      }
    } catch (e) {
      setStatus('下载失败: ' + e.message);
      toast('下载失败: ' + e.message);
    }
  }

  async function doPush(items) {
    if (!items.length) { toast('请先选择图片'); return; }
    setStatus('正在推送 ' + items.length + ' 张到 GitHub…');
    try {
      const res = await chrome.runtime.sendMessage({ type: 'pushToGithub', items: items });
      if (!res || res.ok === false) {
        setStatus('推送失败: ' + ((res && res.error) || '未知错误'));
        toast('推送失败: ' + ((res && res.error) || '未知错误'));
        return;
      }
      state.pushedLinks = new Map();
      (res.results || []).forEach(function (r) {
        if (r.ok && r.link) state.pushedLinks.set(r.id, r.link);
      });
      setStatus('推送完成：成功 ' + res.successCount + '，失败 ' + res.failedCount);
      toast('已推送 ' + res.successCount + ' 张到 GitHub' + (res.failedCount ? '，失败 ' + res.failedCount : ''));
      showPushResult(res);
      render();
    } catch (e) {
      setStatus('推送失败: ' + e.message);
      toast('推送失败: ' + e.message);
    }
  }

  function showPushResult(res) {
    const overlay = document.createElement('div');
    overlay.className = 'result-overlay';
    const rows = (res.results || []).map(function (r) {
      if (r.ok) {
        return '<div class="row ok">✅ <span class="path">' + escapeAttr((r.path || '').split('/').pop()) + '</span>' +
          '<a href="' + escapeAttr(r.link) + '" target="_blank">打开</a>' +
          '<button data-copy="' + escapeAttr(r.link) + '">复制链接</button></div>';
      }
      return '<div class="row fail">❌ <span class="path" title="' + escapeAttr(r.error || '') + '">' + escapeAttr(r.error || '失败') + '</span></div>';
    }).join('');
    overlay.innerHTML =
      '<h4>推送结果：成功 ' + res.successCount + ' / 失败 ' + res.failedCount + '</h4>' +
      '<div class="result-list">' + rows + '</div>' +
      '<div style="display:flex;gap:6px;margin-top:10px">' +
      '  <button class="btn" id="copyAllLinks">复制全部 CDN 链接</button>' +
      '  <button class="btn" id="copyAllMd">复制全部 Markdown</button>' +
      '  <button class="btn" id="closeOverlay">关闭</button>' +
      '</div>';
    $('panel').appendChild(overlay);
    overlay.querySelectorAll('[data-copy]').forEach(function (b) {
      b.addEventListener('click', function () { copyText(b.dataset.copy); toast('已复制链接'); });
    });
    overlay.querySelector('#copyAllLinks').addEventListener('click', function () {
      const links = (res.results || []).filter(function (r) { return r.ok && r.link; }).map(function (r) { return r.link; });
      copyText(links.join('\n'));
      toast('已复制 ' + links.length + ' 条链接');
    });
    overlay.querySelector('#copyAllMd').addEventListener('click', function () {
      const lines = (res.results || []).filter(function (r) { return r.ok && r.link; })
        .map(function (r) { return '![](' + r.link + ')'; });
      copyText(lines.join('\n'));
      toast('已复制 ' + lines.length + ' 条 Markdown');
    });
    overlay.querySelector('#closeOverlay').addEventListener('click', function () { overlay.remove(); });
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e2) { /* ignore */ }
      ta.remove();
    }
  }

  function copyMarkdown() {
    const items = selectedItems();
    if (!items.length) { toast('请先选择图片'); return; }
    const lines = items.map(function (it) {
      const link = state.pushedLinks.get(it.id) || it.url;
      return '![' + (it.platform || 'img') + '](' + link + ')';
    });
    copyText(lines.join('\n'));
    toast('已复制 ' + lines.length + ' 条 Markdown 引用');
  }

  /* ---------- 扫描 ---------- */

  async function requestScan() {
    if (state.scanFn) {
      setStatus('扫描中…');
      try {
        const items = await state.scanFn();
        setItems(items || []);
        setStatus('找到 ' + (items || []).length + ' 张图片');
      } catch (e) {
        setStatus('扫描失败: ' + e.message);
      }
    } else {
      // 豆包/即梦：请求 MAIN world 提取器回传
      window.postMessage({ __imgcollector: 1, type: 'request' }, '*');
      setStatus('已请求刷新，等待页面数据…');
    }
  }

  /* ---------- 事件绑定 ---------- */

  fab.addEventListener('click', function () { open(); });
  $('close').addEventListener('click', close);
  modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
  $('selAll').addEventListener('click', function () {
    const vis = visibleItems();
    state.selected = new Set(vis.map(function (it) { return it.id; }));
    render();
  });
  $('selNone').addEventListener('click', function () {
    state.selected = new Set();
    render();
  });
  $('invert').addEventListener('click', function () {
    const vis = visibleItems();
    const next = new Set();
    vis.forEach(function (it) { if (!state.selected.has(it.id)) next.add(it.id); });
    state.selected = next;
    render();
  });
  $('refresh').addEventListener('click', requestScan);
  $('downloadSel').addEventListener('click', function () { doDownload(selectedItems()); });
  $('pushSel').addEventListener('click', function () { doPush(selectedItems()); });
  $('copyMd').addEventListener('click', copyMarkdown);
  $('settingsBtn').addEventListener('click', function () { chrome.runtime.openOptionsPage(); });

  // 筛选条件
  function bindFilter(selId, key) {
    $('f' + selId).addEventListener('change', function () {
      state.filters[key] = $('f' + selId).value;
      if (key === 'type') {
        // 视频筛选时格式条件不适用，重置
        if (state.filters.type === 'video') state.filters.format = 'all';
        $('fFormat').disabled = state.filters.type === 'video';
      }
      if (key === 'minSizeMB' && parseFloat(state.filters.minSizeMB) > 0) scheduleSizeProbe();
      render();
    });
  }
  bindFilter('Type', 'type');
  bindFilter('Format', 'format');
  bindFilter('Height', 'minHeight');
  bindFilter('Size', 'minSizeMB');
  $('fFormat').disabled = state.filters.type === 'video';

  function open() {
    modal.classList.remove('hidden');
    render();
    // 面板为空且存在扫描器时自动扫描（通用采集 / 首次打开场景）
    if (state.scanFn && state.items.length === 0) requestScan();
  }
  function close() {
    modal.classList.add('hidden');
  }
  function hideFab() {
    fab.style.display = 'none';
  }
  function showFab() {
    fab.style.display = '';
  }

  // 按 Esc 关闭面板
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });

  /* ---------- MAIN world 桥接 ---------- */

  window.addEventListener('message', function (e) {
    if (e.source !== window || !e.data || e.data.__imgcollector !== 1) return;
    const d = e.data;
    if (d.type === 'items') {
      state.platform = d.platform || state.platform;
      setItems(d.items || []);
    }
  });

  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg) return;
    if (msg.type === 'imgcollector-open') {
      open();
    } else if (msg.type === 'imgcollector-progress') {
      if (msg.phase === 'download') setStatus('正在下载 ' + msg.done + '/' + msg.total + '…');
      else if (msg.phase === 'push') setStatus('正在推送 ' + msg.done + '/' + msg.total + ' 到 GitHub…');
    }
  });

  /* ---------- 对外 API ---------- */

  window.__IMGCOLLECTOR__ = {
    init: function (opts) {
      if (opts && opts.platform) state.platform = opts.platform;
      if (opts && opts.scanFn) state.scanFn = opts.scanFn;
      render();
    },
    setItems: setItems,
    requestScan: requestScan,
    open: open,
    close: close,
    hideFab: hideFab,
    showFab: showFab,
    getItems: function () { return state.items.slice(); }
  };

  // 允许被「扫描当前页」反复注入时保留状态
  window.__IMGCOLLECTOR__.__ready = true;
  render();
})();
