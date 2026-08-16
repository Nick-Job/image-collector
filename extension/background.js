/**
 * 图片收集器 — background service worker
 * 职责：下载图片到本地、推送到 GitHub（Contents API）、测试连接、通用页面注入
 */
'use strict';

const DEFAULTS = {
  token: '',           // GitHub Personal Access Token
  repo: '',            // owner/repo
  branch: 'main',      // 推送分支
  rootPath: 'images',  // 仓库内根目录
  collection: 'auto',  // auto | 自定义子目录名
  writeManifest: true, // 每次推送后写一份 JSON 索引
  downloadFolder: '图片收集', // 本地下载目录前缀
  cdn: 'jsdelivr',      // jsdelivr | raw | none（复制链接用）
  showFabEverywhere: false // 在所有网页显示采集悬浮按钮
};

async function getSettings() {
  const s = await chrome.storage.local.get(DEFAULTS);
  return Object.assign({}, DEFAULTS, s);
}

// MV3 service worker 空闲超时保护：定期调用扩展 API 重置计时器
async function keepAlive() {
  try { await chrome.storage.local.get({ _ka: true }); } catch (e) { /* ignore */ }
}

function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function safeName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120);
}

function dateStr(d) {
  d = d || new Date();
  const p = function (n) { return String(n).padStart(2, '0'); };
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
}

function extFromUrl(url) {
  try {
    const p = new URL(url).pathname;
    let m = p.match(/\.(png|jpe?g|webp|gif|avif|bmp)(?:$|[?#])/i);
    if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
    m = p.match(/\.(mp4|webm|mov|m4v|mkv)(?:$|[?#])/i);
    if (m) return m[1].toLowerCase();
  } catch (e) { /* ignore */ }
  return 'jpg';
}

// 根据真实文件类型修正扩展名（如即梦 URL 以 .image 结尾、实际是 webp）
function fixExtByBlob(blobType, name) {
  const map = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'image/gif': 'gif', 'image/avif': 'avif', 'image/bmp': 'bmp',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
    'video/x-matroska': 'mkv', 'video/x-m4v': 'm4v'
  };
  const ext = map[blobType];
  if (!ext) return name;
  if (/\.jpg$/i.test(name) && blobType !== 'image/jpeg') {
    return name.replace(/\.jpg$/i, '.' + ext);
  }
  return name;
}

// 探测文件大小（HEAD 优先，失败退回 Range 请求）
async function probeUrlSize(url) {
  try {
    const head = await fetch(url, { method: 'HEAD', credentials: 'include' });
    if (head.ok) {
      const cl = head.headers.get('content-length');
      if (cl) return parseInt(cl, 10);
    }
  } catch (e) { /* ignore */ }
  try {
    const range = await fetch(url, { headers: { 'Range': 'bytes=0-0' }, credentials: 'include' });
    if (range.ok) {
      const cr = range.headers.get('content-range');
      if (cr) {
        const m = cr.match(/\/(\d+)\s*$/);
        if (m) return parseInt(m[1], 10);
      }
      const cl = range.headers.get('content-length');
      if (cl) return parseInt(cl, 10);
    }
  } catch (e) { /* ignore */ }
  return null;
}

async function probeSizes(items) {
  const results = [];
  const queue = (items || []).slice();
  const workers = [0, 1, 2, 3, 4, 5].map(async function () {
    while (queue.length) {
      const it = queue.shift();
      await keepAlive();
      try {
        const sizeBytes = await probeUrlSize(it.url);
        results.push({ url: it.url, sizeBytes: sizeBytes });
      } catch (e) {
        results.push({ url: it.url, sizeBytes: null });
      }
    }
  });
  await Promise.all(workers);
  return { results: results };
}

// 下载图片字节（支持备用 URL）
async function fetchBytes(url, altUrls) {
  const candidates = [url].concat(altUrls || []);
  let lastErr = null;
  for (const u of candidates) {
    if (!u) continue;
    try {
      const resp = await fetch(u, { credentials: 'include', cache: 'no-store' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status + (resp.statusText ? ' ' + resp.statusText : ''));
      const buf = await resp.arrayBuffer();
      if (!buf || buf.byteLength === 0) throw new Error('空文件');
      return { data: buf, usedUrl: u };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('无法下载图片');
}

/* ---------------- GitHub API ---------------- */

async function ghApi(url, opts) {
  let resp;
  try {
    resp = await fetch(url, opts);
  } catch (e) {
    throw new Error('网络请求失败: ' + e.message);
  }
  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* ignore */ }
  if (!resp.ok) {
    const msg = json && json.message ? json.message : 'HTTP ' + resp.status;
    const err = new Error(msg);
    err.status = resp.status;
    err.json = json;
    throw err;
  }
  return json;
}

function ghUrl(repo, path) {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return 'https://api.github.com/repos/' + repo + '/contents/' + encoded;
}

async function ghPut(settings, path, base64, message) {
  return ghApi(ghUrl(settings.repo, path), {
    method: 'PUT',
    headers: {
      'Authorization': 'Bearer ' + settings.token,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: message || 'upload ' + path,
      content: base64,
      branch: settings.branch
    })
  });
}

async function testGithub(settings) {
  if (!settings.token) return { ok: false, error: '未配置 Token' };
  try {
    const user = await ghApi('https://api.github.com/user', {
      headers: { 'Authorization': 'Bearer ' + settings.token, 'Accept': 'application/vnd.github+json' }
    });
    return { ok: true, login: user.login };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// 生成推送路径：rootPath/collection/日期/文件名
function buildPushPath(settings, item) {
  const root = (settings.rootPath || 'images').replace(/^\/+|\/+$/g, '');
  let coll = settings.collection && settings.collection !== 'auto'
    ? settings.collection
    : (item.collection || item.platform || 'default');
  coll = safeName(coll);
  const parts = [root, coll, dateStr()].filter(Boolean);
  return parts.join('/') + '/' + safeName(item.filename);
}

// 推送后的可访问链接（jsDelivr CDN / raw）
function linkFor(settings, path) {
  const p = path.split('/').map(encodeURIComponent).join('/');
  if (settings.cdn === 'jsdelivr') {
    return 'https://cdn.jsdelivr.net/gh/' + settings.repo + '@' + settings.branch + '/' + p;
  }
  return 'https://raw.githubusercontent.com/' + settings.repo + '/' + settings.branch + '/' + p;
}

/* ---------------- 进度回传 ---------------- */

async function sendProgress(sender, phase, done, total) {
  if (!sender || !sender.tab || sender.tab.id == null) return;
  try {
    await chrome.tabs.sendMessage(sender.tab.id, {
      type: 'imgcollector-progress', phase: phase, done: done, total: total
    });
  } catch (e) { /* 面板可能已关闭 */ }
}

/* ---------------- 下载 ---------------- */

const blobDownloads = new Map(); // blobUrl -> objectUrl

chrome.downloads.onChanged.addListener(function (delta) {
  if (delta.state && (delta.state.current === 'complete' || delta.state.current === 'interrupted')) {
    const obj = blobDownloads.get(delta.url);
    if (obj) {
      blobDownloads.delete(delta.url);
      setTimeout(function () { try { URL.revokeObjectURL(obj); } catch (e) { /* ignore */ } }, 30000);
    }
  }
});

async function downloadItems(items, folder, sender) {
  const settings = await getSettings();
  const dir = folder || settings.downloadFolder || '图片收集';
  const results = [];
  const total = items.length;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      const { data } = await fetchBytes(item.url, item.altUrls);
      const blob = new Blob([data]);
      const objUrl = URL.createObjectURL(blob);
      const filename = dir + '/' + safeName(fixExtByBlob(blob.type, item.filename));
      const downloadId = await chrome.downloads.download({
        url: objUrl,
        filename: filename,
        saveAs: false,
        conflictAction: 'uniquify'
      });
      blobDownloads.set(objUrl, objUrl);
      results.push({ id: item.id, url: item.url, ok: true, downloadId: downloadId });
    } catch (e) {
      results.push({ id: item.id, url: item.url, ok: false, error: e.message });
    }
    await sendProgress(sender, 'download', i + 1, total);
  }
  return results;
}

/* ---------------- 推送到 GitHub ---------------- */

async function pushToGithub(items, sender) {
  const settings = await getSettings();
  if (!settings.token || !settings.repo) {
    return { ok: false, error: '未配置 GitHub（请先在设置中填写 Token 与仓库）' };
  }
  const results = [];
  const total = items.length;
  const queue = items.slice();
  const workers = [0, 1, 2].map(async function () {
    while (queue.length) {
      const item = queue.shift();
      await keepAlive();
      try {
        const { data } = await fetchBytes(item.url, item.altUrls);
        const blobType = new Blob([data]).type;
        const base = fixExtByBlob(blobType, item.filename || 'image');
        const path = buildPushPath(settings, Object.assign({}, item, { filename: base }));
        const b64 = bufToBase64(data);
        if (b64.length > 134217728) throw new Error('文件超过 GitHub API 100MB 限制');
        await keepAlive();
        await ghPut(settings, path, b64, 'upload ' + item.filename + ' by 图片收集器');
        results.push({ id: item.id, url: item.url, ok: true, path: path, link: linkFor(settings, path) });
      } catch (e) {
        const existed = e.status === 422 && /sha/i.test(e.message || '');
        results.push({
          id: item.id, url: item.url, ok: existed, existed: existed,
          error: existed ? '仓库中已存在同名文件，已跳过' : e.message
        });
      }
      await sendProgress(sender, 'push', results.length, total);
    }
  });
  await Promise.all(workers);

  // 批次索引文件（失败不影响主流程）
  if (settings.writeManifest) {
    const okItems = results.filter(function (r) { return r.ok; });
    if (okItems.length) {
      try {
        const ts = new Date();
        const manifest = {
          generated_at: ts.toISOString(),
          platform: items[0] && items[0].platform,
          source_page: items[0] && items[0].source,
          files: okItems.map(function (r) {
            return { path: r.path, source_url: r.url, link: r.link };
          })
        };
        const jsonStr = JSON.stringify(manifest, null, 2);
        const b64 = bufToBase64(new TextEncoder().encode(jsonStr));
        const root = (settings.rootPath || 'images').replace(/^\/+|\/+$/g, '');
        let coll = settings.collection && settings.collection !== 'auto'
          ? settings.collection
          : ((items[0] && items[0].collection) || (items[0] && items[0].platform) || 'default');
        coll = safeName(coll);
        const stamp = dateStr(ts) + '-' + String(ts.getHours()).padStart(2, '0') + String(ts.getMinutes()).padStart(2, '0') + String(ts.getSeconds()).padStart(2, '0');
        const mpath = root + '/' + coll + '/manifest-' + stamp + '.json';
        await ghPut(settings, mpath, b64, 'update manifest');
      } catch (e) { /* ignore */ }
    }
  }

  const failed = results.filter(function (r) { return !r.ok; });
  return {
    ok: failed.length === 0,
    results: results,
    successCount: results.length - failed.length,
    failedCount: failed.length
  };
}

/* ---------------- 消息路由 ---------------- */

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  (async function () {
    try {
      switch (msg && msg.type) {
        case 'getSettings': {
          const settings = await getSettings();
          return { ok: true, settings: settings, hasToken: !!settings.token };
        }
        case 'saveSettings': {
          await chrome.storage.local.set(msg.settings || {});
          return { ok: true };
        }
        case 'testGithub': {
          return await testGithub(await getSettings());
        }
        case 'downloadItems': {
          return await downloadItems(msg.items || [], msg.folder, sender);
        }
        case 'pushToGithub': {
          return await pushToGithub(msg.items || [], sender);
        }
        case 'probeSizes': {
          return await probeSizes(msg.items || []);
        }
        case 'genericScan': {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          const tab = tabs && tabs[0];
          if (!tab || tab.id == null) return { ok: false, error: '没有可用的标签页' };
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['content/normalize.js', 'content/collector-ui.js', 'content/generic-scan.js']
            });
            try {
              await chrome.tabs.sendMessage(tab.id, { type: 'imgcollector-open' });
            } catch (e) { /* 面板可能已打开 */ }
            return { ok: true };
          } catch (e) {
            return { ok: false, error: '无法在该页面注入采集器：' + e.message };
          }
        }
        case 'openCollector': {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          const tab = tabs && tabs[0];
          if (!tab || tab.id == null) return { ok: false, error: '没有可用的标签页' };
          try {
            await chrome.tabs.sendMessage(tab.id, { type: 'imgcollector-open' });
            return { ok: true };
          } catch (e) {
            return { ok: false, error: '当前页面没有加载采集面板，请改用「扫描当前页图片」' };
          }
        }
        default:
          return { ok: false, error: '未知消息类型' };
      }
    } catch (e) {
      return { ok: false, error: e.message };
    }
  })().then(sendResponse);
  return true; // 异步响应
});
