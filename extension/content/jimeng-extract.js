/**
 * jimeng-extract.js — 即梦无水印图片提取（MAIN world，document_start）
 * 原理：拦截 jimeng.jianying.com 的 fetch / XHR 响应，从创建列表/详情数据中
 * 提取 origin / upscaled / raw 等字段的原图 URL；同时扫描页面 <img>，
 * 对展示图 URL 应用 2400:2400 高清转换作为候选。
 * 结果通过 postMessage 桥接给隔离世界的采集面板。
 */
(function () {
  'use strict';

  if (window.__IMGCOLLECTOR_MAIN_JIMENG__) return;
  window.__IMGCOLLECTOR_MAIN_JIMENG__ = true;

  const CDN_RE = /(douyinpic\.com|byteimg\.com|volccdn\.com|bytecdn\.cn)/i;
  const KEY_RE = /(origin|upscaled|raw|no_watermark|noWatermark|full_image|hd_image)/i;
  const VIDEO_KEY_RE = /(video_origin|video_upscaled|video_raw|video_url|video_play_url|play_url|play_addr|video_display)/i;

  const seen = new Set();
  let items = [];
  let postTimer = null;

  function normalizeUrl(u) {
    return String(u).replace(/&amp;/g, '&').trim();
  }

  function push(url, w, h, priority, type) {
    url = normalizeUrl(url);
    if (!/^https?:/i.test(url)) return;
    if (!CDN_RE.test(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    items.push({
      url: url,
      width: w || 0,
      height: h || 0,
      type: type || 'image',
      source: location.href,
      platform: '即梦',
      collection: 'jimeng',
      priority: priority || 0
    });
    schedulePost();
  }

  function isVideoKey(k) {
    return VIDEO_KEY_RE.test(k) || /video/i.test(k || '');
  }

  function collectList(val, type) {
    const lists = [val.url_list, val.image_url, val.urls, val.video_url, val.play_url, val.play_addr];
    for (const list of lists) {
      if (Array.isArray(list)) {
        for (const u of list) {
          if (typeof u === 'string') push(u, 0, 0, 0, type);
          else if (u && typeof u.url === 'string') push(u.url, u.width, u.height, 0, type);
        }
      }
    }
  }

  // 递归遍历：命中关键字段时收集；普通字符串若是 CDN 媒体 URL 也收集（低优先级，类型由扩展名推断）
  function walk(v, key) {
    if (!v) return;
    if (typeof v === 'string') {
      if (KEY_RE.test(key || '') || VIDEO_KEY_RE.test(key || '')) push(v, 0, 0, 0, isVideoKey(key) ? 'video' : 'image');
      else push(v, 0, 0, 2, 'image'); // push() 内按 CDN 过滤
      return;
    }
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) walk(v[i], key);
      return;
    }
    if (typeof v === 'object') {
      for (const k of Object.keys(v)) {
        const val = v[k];
        if (KEY_RE.test(k) || VIDEO_KEY_RE.test(k)) {
          const t = isVideoKey(k) ? 'video' : 'image';
          if (typeof val === 'string') {
            push(val, 0, 0, 0, t);
          } else if (val && typeof val === 'object') {
            if (typeof val.url === 'string') push(val.url, val.width, val.height, 0, t);
            else if (typeof val.main_url === 'string') push(val.main_url, val.width, val.height, 0, t);
            collectList(val, t);
          }
        }
        walk(val, k);
      }
    }
  }

  function tryParseJsonText(text) {
    try {
      walk(JSON.parse(text));
    } catch (e) { /* ignore */ }
  }

  async function hookResponse(response) {
    if (!response || !response.clone) return response;
    const ct = (response.headers.get('content-type') || '').toLowerCase();
    if (!/(json|text|event-stream|ndjson)/.test(ct)) return response;
    const cloned = response.clone();
    cloned.text().then(function (t) {
      if (!t || t.length > 64 * 1024 * 1024) return;
      if (ct.indexOf('event-stream') >= 0 || ct.indexOf('ndjson') >= 0) {
        for (const line of t.split('\n')) {
          const s = line.trim();
          if (s.indexOf('data:') === 0) tryParseJsonText(s.slice(5).trim());
          else if (s.charAt(0) === '{') tryParseJsonText(s);
        }
      } else {
        tryParseJsonText(t);
      }
    }).catch(function () { /* ignore */ });
    return response;
  }

  // 拦截 fetch
  const origFetch = window.fetch;
  window.fetch = function () {
    const args = arguments;
    const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
    const p = origFetch.apply(this, args);
    if (/douyinpic|byteimg|volccdn|bytecdn|jianying/i.test(url)) {
      p.then(hookResponse).catch(function () { /* ignore */ });
    }
    return p;
  };

  // 拦截 XHR
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__icUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (this.__icUrl && /douyinpic|byteimg|volccdn|bytecdn|jianying/i.test(this.__icUrl)) {
      this.addEventListener('load', function () {
        try {
          const t = this.responseText;
          if (t && t.length < 64 * 1024 * 1024) tryParseJsonText(t);
        } catch (e) { /* ignore */ }
      });
    }
    return origSend.apply(this, arguments);
  };

  // 页面 <img> 扫描 + 高清转换候选
  function scanDom() {
    const imgs = document.querySelectorAll('img');
    for (const img of imgs) {
      let src = img.currentSrc || img.src || '';
      if (img.srcset) {
        let bestW = -1;
        for (const part of img.srcset.split(',')) {
          const m = part.trim().match(/^(\S+)(?:\s+(\d+)w)?/);
          if (!m || !m[1]) continue;
          const w = m[2] ? parseInt(m[2], 10) : 0;
          if (w > bestW) { bestW = w; src = m[1]; }
        }
      }
      if (src && CDN_RE.test(src)) {
        // 展示图 URL 里通常带 1:1 等比例模板，替换为 2400:2400 请求高清渲染
        const big = src.replace(/\d+:\d+/, '2400:2400');
        push(big, 0, 0, 1, 'image');
        if (big !== src) push(src, 0, 0, 3, 'image');
      }
    }
    // 页面 <video> 扫描
    const videos = document.querySelectorAll('video');
    for (const v of videos) {
      let src = v.currentSrc || v.src || '';
      if (!src) {
        const s = v.querySelector('source');
        if (s) src = s.currentSrc || s.src || '';
      }
      if (src && /^https?:/i.test(src) && CDN_RE.test(src)) {
        push(src, v.videoWidth || 0, v.videoHeight || 0, 1, 'video');
      }
    }
  }

  function schedulePost() {
    if (postTimer) return;
    postTimer = setTimeout(function () {
      postTimer = null;
      postItems();
    }, 400);
  }

  function postItems() {
    const sorted = items.slice().sort(function (a, b) { return (a.priority || 0) - (b.priority || 0); });
    window.postMessage({ __imgcollector: 1, type: 'items', platform: '即梦', items: sorted }, '*');
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window || !e.data || e.data.__imgcollector !== 1) return;
    if (e.data.type === 'request') postItems();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanDom);
  } else {
    scanDom();
  }
})();
