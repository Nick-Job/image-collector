/**
 * generic-scan.js — 任意网站通用图片采集（由 popup「扫描当前页」注入）
 * 依赖：content/normalize.js（ImgNormalize）、content/collector-ui.js（__IMGCOLLECTOR__）
 */
(function () {
  'use strict';

  const C = window.__IMGCOLLECTOR__;
  const N = window.ImgNormalize;
  if (!C || !N) return;

  const MAX_ITEMS = 800;

  function scanImages() {
    const seen = new Set();
    const items = [];
    const imgs = document.querySelectorAll('img');
    for (const img of imgs) {
      if (items.length >= MAX_ITEMS) break;
      let src = N.bestSrcOf(img);
      if (!src || !/^https?:\/\//i.test(src)) continue;
      // 跳过小图标 / 装饰图
      const nw = img.naturalWidth || 0;
      const nh = img.naturalHeight || 0;
      if (nw && nh && nw < 200 && nh < 200) continue;
      if (seen.has(src)) continue;
      seen.add(src);
      const ext = N.extFromUrl(src);
      items.push(makeItem(src, nw, nh, ext, 'image'));
    }
    return items;
  }

  function scanVideos() {
    const seen = new Set();
    const items = [];
    const videos = document.querySelectorAll('video');
    for (const v of videos) {
      if (items.length >= 300) break;
      let src = v.currentSrc || v.src || '';
      if (!src) {
        const s = v.querySelector('source');
        if (s) src = s.currentSrc || s.src || '';
      }
      if (!src || !/^https?:\/\//i.test(src)) continue;
      if (seen.has(src)) continue;
      seen.add(src);
      const ext = N.extFromUrl(src);
      if (N.mediaTypeFromExt(ext) !== 'video') continue;
      items.push(makeItem(src, v.videoWidth || 0, v.videoHeight || 0, ext, 'video'));
    }
    return items;
  }

  function makeItem(src, nw, nh, ext, type) {
    const hostname = (function () {
      try { return new URL(location.href).hostname.replace(/^www\./, ''); } catch (e) { return 'web'; }
    })();
    return {
      id: (type === 'video' ? 'genv_' : 'gen_') + N.shortHash(src),
      url: src,
      thumb: src,
      type: type,
      width: nw,
      height: nh,
      ext: ext,
      source: location.href,
      platform: hostname,
      collection: hostname,
      filename: N.defaultFilename(type === 'video' ? 'video' : 'img', src)
    };
  }

  function scan() {
    return scanImages().concat(scanVideos());
  }

  C.init({ platform: '通用采集 · ' + location.hostname, scanFn: scan });
  C.requestScan();
  // 注入后直接打开面板，确保用户点击「扫描当前页」后立刻能看到结果
  C.open();
})();
