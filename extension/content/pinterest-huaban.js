/**
 * pinterest-huaban.js — Pinterest / 花瓣 页面扫描器（隔离世界）
 * 依赖：content/normalize.js（ImgNormalize）、content/collector-ui.js（__IMGCOLLECTOR__）
 */
(function () {
  'use strict';

  const host = location.hostname;
  const isPinterest = /(^|\.)pinterest\./.test(host);
  const isHuaban = /(^|\.)huaban\.com$/.test(host);
  if (!isPinterest && !isHuaban) return;

  const C = window.__IMGCOLLECTOR__;
  const N = window.ImgNormalize;
  if (!C || !N) return;

  const MAX_ITEMS = 1200;

  /* ---------- 通用扫描 ---------- */

  function collectImgs(filter, makeItem) {
    const seen = new Set();
    const items = [];
    const imgs = document.querySelectorAll('img');
    for (const img of imgs) {
      if (items.length >= MAX_ITEMS) break;
      const src = N.bestSrcOf(img);
      if (!src || !filter(src)) continue;
      const it = makeItem(img, src);
      if (!it || !it.url || seen.has(it.url)) continue;
      seen.add(it.url);
      items.push(it);
    }
    return items;
  }

  function collectVideos(makeItem) {
    const seen = new Set();
    const items = [];
    const videos = document.querySelectorAll('video');
    for (const v of videos) {
      if (items.length >= 300) break;
      const sources = [];
      if (v.currentSrc || v.src) sources.push(v.currentSrc || v.src);
      for (const s of v.querySelectorAll('source')) {
        if (s.currentSrc || s.src) sources.push(s.currentSrc || s.src);
      }
      for (const src of sources) {
        if (!src || !/^https?:/i.test(src)) continue;
        const it = makeItem(v, src);
        if (!it || !it.url || seen.has(it.url)) continue;
        seen.add(it.url);
        items.push(it);
      }
    }
    return items;
  }

  /* ---------- Pinterest ---------- */

  function pinterestCollection() {
    const p = location.pathname;
    let m = p.match(/^\/([^/]+)\/([^/]+)\/?$/);
    if (m && m[1] !== 'pin' && m[1] !== 'ideas' && m[1] !== 'search' && m[1] !== 'followers' && m[1] !== 'following') {
      return 'board-' + m[2];
    }
    if (p.indexOf('/pin/') === 0) return 'pins';
    return 'pinterest';
  }

  function scanPinterest() {
    const imgs = collectImgs(
      function (src) { return /i\.pinimg\.com/.test(src); },
      function (img, src) {
        const original = N.pinterestOriginal(src);
        if (!original) return null;
        const pinLink = img.closest('a[href*="/pin/"]');
        const source = pinLink ? pinLink.href : location.href;
        const ext = N.extFromUrl(original);
        return {
          id: 'pin_' + N.shortHash(original),
          url: original,
          thumb: src,
          width: img.naturalWidth || 0,
          height: img.naturalHeight || 0,
          ext: ext,
          source: source,
          platform: 'Pinterest',
          collection: pinterestCollection(),
          filename: N.defaultFilename('pinterest', original)
        };
      }
    );
    const vids = collectVideos(function (v, src) {
      const ext = N.extFromUrl(src);
      if (N.mediaTypeFromExt(ext) !== 'video') return null;
      const identity = N.mediaIdentity(src);
      return {
        id: 'pinv_' + N.shortHash(identity),
        identity: identity,
        url: src,
        thumb: v.poster || '',
        type: 'video',
        ext: ext,
        width: v.videoWidth || 0,
        height: v.videoHeight || 0,
        source: location.href,
        platform: 'Pinterest',
        collection: pinterestCollection(),
        filename: 'pinterest_v_' + N.shortHash(identity) + '.' + ext
      };
    });
    return imgs.concat(vids);
  }

  /* ---------- 花瓣 ---------- */

  function huabanCollection() {
    const p = location.pathname;
    const m = p.match(/^\/boards\/([^/]+)\/([^/]+)\/?/);
    if (m) return 'board-' + m[2];
    if (p.indexOf('/pins/') === 0) return 'pins';
    return 'huaban';
  }

  function scanHuaban() {
    const imgs = collectImgs(
      function (src) { return /(hbimg|img)\.huaban\.com/.test(src); },
      function (img, src) {
        const original = N.huabanOriginal(src) || src;
        const pinLink = img.closest('a[href*="/pins/"]') || img.closest('a[href*="/a/"]');
        const source = pinLink ? pinLink.href : location.href;
        const ext = N.extFromUrl(original);
        return {
          id: 'hb_' + N.shortHash(original),
          url: original,
          thumb: src,
          width: img.naturalWidth || 0,
          height: img.naturalHeight || 0,
          ext: ext,
          source: source,
          platform: '花瓣',
          collection: huabanCollection(),
          filename: N.defaultFilename('huaban', original)
        };
      }
    );
    const vids = collectVideos(function (v, src) {
      const ext = N.extFromUrl(src);
      if (N.mediaTypeFromExt(ext) !== 'video') return null;
      const identity = N.mediaIdentity(src);
      return {
        id: 'hbv_' + N.shortHash(identity),
        identity: identity,
        url: src,
        thumb: v.poster || '',
        type: 'video',
        ext: ext,
        width: v.videoWidth || 0,
        height: v.videoHeight || 0,
        source: location.href,
        platform: '花瓣',
        collection: huabanCollection(),
        filename: 'huaban_v_' + N.shortHash(identity) + '.' + ext
      };
    });
    return imgs.concat(vids);
  }

  /* ---------- 初始化 ---------- */

  C.init({
    platform: isPinterest ? 'Pinterest' : '花瓣',
    scanFn: isPinterest ? scanPinterest : scanHuaban
  });
  C.requestScan();

  // 页面滚动 / 懒加载后自动刷新
  let timer = null;
  const observer = new MutationObserver(function () {
    clearTimeout(timer);
    timer = setTimeout(function () { C.requestScan(); }, 900);
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
