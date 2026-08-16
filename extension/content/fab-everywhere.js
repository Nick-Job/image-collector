/**
 * fab-everywhere.js — 可选：在所有网页显示采集悬浮按钮（像无印豆包在豆包页那样）
 * 由设置项 showFabEverywhere 控制（默认关闭）；在受支持平台页面上自动跳过，
 * 避免覆盖 Pinterest/花瓣/豆包/即梦的专属扫描器。
 * 依赖：content/normalize.js、content/collector-ui.js（__IMGCOLLECTOR__）
 */
(function () {
  'use strict';

  const C = window.__IMGCOLLECTOR__;
  if (!C) return;

  // 已有专属扫描器的平台页面，直接跳过
  const host = location.hostname;
  if (/(^|\.)pinterest\./.test(host) ||
      /(^|\.)huaban\.com$/.test(host) ||
      /(^|\.)doubao\.com$/.test(host) ||
      /jimeng\.jianying\.com$/.test(host)) {
    return;
  }

  chrome.storage.local.get({ showFabEverywhere: false }, function (s) {
    if (!s.showFabEverywhere) {
      C.hideFab();
      return;
    }

    const N = window.ImgNormalize;
    const MAX_ITEMS = 800;

    function makeItem(src, nw, nh, ext, type) {
      const hostname = (function () {
        try { return new URL(location.href).hostname.replace(/^www\./, ''); } catch (e) { return 'web'; }
      })();
      return {
        id: (type === 'video' ? 'fabv_' : 'fab_') + N.shortHash(src),
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
      const seen = new Set();
      const items = [];
      const imgs = document.querySelectorAll('img');
      for (const img of imgs) {
        if (items.length >= MAX_ITEMS) break;
        let src = N.bestSrcOf(img);
        if (!src || !/^https?:\/\//i.test(src)) continue;
        const nw = img.naturalWidth || 0;
        const nh = img.naturalHeight || 0;
        if (nw && nh && nw < 200 && nh < 200) continue;
        if (seen.has(src)) continue;
        seen.add(src);
        items.push(makeItem(src, nw, nh, N.extFromUrl(src), 'image'));
      }
      const videos = document.querySelectorAll('video');
      for (const v of videos) {
        if (items.length >= MAX_ITEMS) break;
        let src = v.currentSrc || v.src || '';
        if (!src) {
          const s = v.querySelector('source');
          if (s) src = s.currentSrc || s.src || '';
        }
        if (!src || !/^https?:\/\//i.test(src) || seen.has(src)) continue;
        const ext = N.extFromUrl(src);
        if (N.mediaTypeFromExt(ext) !== 'video') continue;
        seen.add(src);
        items.push(makeItem(src, v.videoWidth || 0, v.videoHeight || 0, ext, 'video'));
      }
      return items;
    }

    C.showFab();
    C.init({ platform: '通用采集 · ' + location.hostname, scanFn: scan });
  });
})();
