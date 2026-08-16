/**
 * doubao-extract.js — 豆包无水印图片提取（MAIN world，document_start）
 * 原理：在页面主世界拦截 fetch / XHR，从聊天数据流（SSE）与历史消息中
 * 提取 image_ori_raw / image_origin 等原图字段；同时支持 /thread/ 分享页内嵌数据解析。
 * 结果通过 postMessage 桥接给隔离世界的采集面板。
 */
(function () {
  'use strict';

  if (window.__IMGCOLLECTOR_MAIN_DOBAO__) return;
  window.__IMGCOLLECTOR_MAIN_DOBAO__ = true;

  const CDN_RE = /(doubao\.com|byteimg\.com|volccdn\.com|bytecdn\.cn)/i;
  const KEY_RE = /(image_ori_raw|image_origin|image_upscaled|no_watermark|noWatermark|original_image|full_image|image_raw)/i;
  const VIDEO_KEY_RE = /(video_origin|video_upscaled|video_raw|video_url|video_play_url|play_url|play_addr|main_url|original_media_info|video_info)/i;

  const seen = new Set();
  let items = [];
  let postTimer = null;

  function normalizeUrl(u) {
    return String(u).replace(/&amp;/g, '&').trim();
  }

  function addUrl(url, w, h, type) {
    url = normalizeUrl(url);
    if (!/^https?:\/\//i.test(url)) return;
    if (!CDN_RE.test(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    items.push({
      url: url,
      width: w || 0,
      height: h || 0,
      type: type || 'image',
      source: location.href,
      platform: '豆包',
      collection: 'doubao'
    });
    schedulePost();
  }

  function collectFromValue(val) {
    // 从对象中提取媒体 URL 列表
    const lists = [
      val.url_list, val.image_url, val.urls, val.video_url, val.play_url, val.play_addr
    ];
    for (const list of lists) {
      if (Array.isArray(list)) {
        for (const u of list) {
          if (typeof u === 'string') addUrl(u, 0, 0);
          else if (u && typeof u.url === 'string') addUrl(u.url, u.width, u.height);
        }
      }
    }
  }

  // 递归遍历 JSON，命中关键字段时收集图片/视频 URL
  function walk(v, key) {
    if (!v) return;
    if (typeof v === 'string') {
      if (KEY_RE.test(key || '') && /^https?:/i.test(v)) addUrl(v, 0, 0, 'image');
      else if (VIDEO_KEY_RE.test(key || '') && /^https?:/i.test(v)) addUrl(v, 0, 0, 'video');
      return;
    }
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) walk(v[i], key);
      return;
    }
    if (typeof v === 'object') {
      for (const k of Object.keys(v)) {
        const val = v[k];
        if (KEY_RE.test(k)) {
          if (typeof val === 'string') {
            addUrl(val, 0, 0, 'image');
          } else if (val && typeof val === 'object') {
            if (typeof val.url === 'string') addUrl(val.url, val.width, val.height, 'image');
            collectFromValue(val);
          }
        } else if (VIDEO_KEY_RE.test(k)) {
          if (typeof val === 'string') {
            addUrl(val, 0, 0, 'video');
          } else if (val && typeof val === 'object') {
            if (typeof val.url === 'string') addUrl(val.url, val.width, val.height, 'video');
            else if (typeof val.main_url === 'string') addUrl(val.main_url, val.width, val.height, 'video');
            collectFromValue(val);
          }
        }
        walk(val, k);
      }
    }
  }

  function tryParseJsonText(text) {
    try {
      walk(JSON.parse(text));
    } catch (e) { /* 非 JSON 或解析失败，忽略 */ }
  }

  async function hookResponse(response) {
    if (!response || !response.clone) return response;
    const ct = (response.headers.get('content-type') || '').toLowerCase();
    if (!/(json|text|event-stream|ndjson)/.test(ct)) return response;
    const cloned = response.clone();
    cloned.text().then(function (t) {
      if (!t || t.length > 64 * 1024 * 1024) return;
      if (ct.indexOf('event-stream') >= 0 || ct.indexOf('ndjson') >= 0) {
        // SSE：逐行解析 data: 前缀的 JSON
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
    if (/doubao\.com|byteimg|volccdn|bytecdn/i.test(url)) {
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
    if (this.__icUrl && /doubao\.com|byteimg|volccdn|bytecdn/i.test(this.__icUrl)) {
      this.addEventListener('load', function () {
        try {
          const t = this.responseText;
          if (t && t.length < 64 * 1024 * 1024) tryParseJsonText(t);
        } catch (e) { /* ignore */ }
      });
    }
    return origSend.apply(this, arguments);
  };

  // 分享页（/thread/）内嵌数据解析
  function extractSharePage() {
    if (!/\/thread\//.test(location.pathname) && !/\/share\//.test(location.pathname)) return;

    function tryParse() {
      const el = document.querySelector('script[data-script-src="modern-run-router-data-fn"]');
      if (!el) return false;
      const args = el.getAttribute('data-fn-args');
      if (!args) return false;
      try {
        const data = JSON.parse(args.replace(/&quot;/g, '"'));
        for (const d of data) {
          const snap = d && d.data && d.data.message_snapshot && d.data.message_snapshot.message_list;
          if (!Array.isArray(snap)) continue;
          for (const msg of snap) {
            for (const block of (msg.content_block || [])) {
              try {
                const raw = block.content_v2 || (typeof block.content === 'string' ? block.content : null);
                if (!raw) continue;
                const cd = JSON.parse(raw);
                const creations = cd && cd.creation_block && cd.creation_block.creations;
                if (!Array.isArray(creations)) continue;
                for (const c of creations) {
                  const img = c && c.image && (c.image.image_ori_raw || c.image.image_origin);
                  if (!img) continue;
                  if (typeof img === 'string') addUrl(img);
                  else if (img && typeof img.url === 'string') addUrl(img.url, img.width, img.height);
                }
              } catch (e) { /* ignore */ }
            }
          }
        }
        return true;
      } catch (e) {
        return false;
      }
    }

    let tries = 0;
    const iv = setInterval(function () {
      tries++;
      if (tryParse() || tries > 24) clearInterval(iv);
    }, 500);
  }

  function schedulePost() {
    if (postTimer) return;
    postTimer = setTimeout(function () {
      postTimer = null;
      window.postMessage({ __imgcollector: 1, type: 'items', platform: '豆包', items: items.slice() }, '*');
    }, 400);
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window || !e.data || e.data.__imgcollector !== 1) return;
    if (e.data.type === 'request') {
      window.postMessage({ __imgcollector: 1, type: 'items', platform: '豆包', items: items.slice() }, '*');
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', extractSharePage);
  } else {
    extractSharePage();
  }
})();
