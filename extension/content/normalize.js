/**
 * normalize.js — 图片 URL 规范化工具（纯函数，无浏览器 API 依赖，可在 Node 中测试）
 * 挂在隔离世界全局 ImgNormalize 上；Pinterest / 花瓣 / 通用扫描器共用。
 */
(function () {
  'use strict';

  // 从 URL 推断扩展名（图片 + 视频）
  function extFromUrl(url, fallback) {
    try {
      const p = new URL(url).pathname;
      let m = p.match(/\.(png|jpe?g|webp|gif|avif|bmp)(?:$|[?#])/i);
      if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
      m = p.match(/\.(mp4|webm|mov|m4v|mkv)(?:$|[?#])/i);
      if (m) return m[1].toLowerCase();
    } catch (e) { /* ignore */ }
    return fallback || 'jpg';
  }

  // 由扩展名判断媒体类型
  function mediaTypeFromExt(ext) {
    return ['mp4', 'webm', 'mov', 'm4v', 'mkv'].indexOf(String(ext || '').toLowerCase()) >= 0 ? 'video' : 'image';
  }

  // 纯函数筛选器：filters = { type, format, minHeight, minSizeMB }
  function applyFilters(items, filters) {
    const f = filters || {};
    const type = f.type || 'all';
    const format = f.format || 'all';
    const minHeight = parseInt(f.minHeight, 10) || 0;
    const minSizeMB = parseFloat(f.minSizeMB) || 0;
    return (items || []).filter(function (it) {
      const t = it.type === 'video' ? 'video' : 'image';
      if (type !== 'all' && t !== type) return false;
      const ext = String(it.ext || '').toLowerCase();
      if (t !== 'video' && format !== 'all') {
        if (format === 'other') {
          // 「其他」= 排除常见格式（jpg/png/webp/gif）
          if (['jpg', 'png', 'webp', 'gif'].indexOf(ext) >= 0) return false;
        } else if (ext !== format) {
          return false;
        }
      }
      if (minHeight > 0 && (!it.height || it.height < minHeight)) return false;
      if (minSizeMB > 0) {
        const bytes = it.sizeBytes;
        // 未知大小放行（面板会异步探测后再次筛选），已知则严格判断
        if (bytes != null && bytes < minSizeMB * 1048576) return false;
      }
      return true;
    });
  }

  // 字节数格式化
  function formatBytes(bytes) {
    if (bytes == null || isNaN(bytes) || bytes < 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
  }

  // 媒体身份：归一化掉尺寸/质量标记，用于把「同一素材的不同清晰度版本」识别为同一条
  function mediaIdentity(url) {
    try {
      const u = new URL(url);
      let path = u.pathname;
      // 即梦/抖音 CDN：去掉 ~tplv-... 模板（含 1:1、q75 等渲染参数）
      path = path.replace(/~tplv-[^/]+/g, '');
      // 归一化清晰度标记：720p / mc/1080p/ 等 -> {q}p
      path = path.replace(/\d{3,4}p/g, '{q}p');
      return u.origin + path;
    } catch (e) {
      return url;
    }
  }

  // 从 URL 中解析清晰度标记（480p -> 480），没有返回 0
  function urlQuality(url) {
    const m = String(url || '').match(/(\d{3,4})p/);
    return m ? parseInt(m[1], 10) : 0;
  }

  // 简易字符串哈希（用于生成稳定的文件名）
  function shortHash(str) {
    let h = 5381;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(16).padStart(8, '0');
  }

  /**
   * Pinterest 原图：
   *   https://i.pinimg.com/{尺寸}x/{a}/{b}/{c}/{hash}.{ext}
   *   -> https://i.pinimg.com/originals/{a}/{b}/{c}/{hash}.{ext}
   * 已是 originals 的保持不变。
   */
  function pinterestOriginal(url) {
    try {
      const u = new URL(url);
      if (u.hostname !== 'i.pinimg.com') return null;
      const m = u.pathname.match(/^\/(\d+x)\/(.+)$/);
      if (m) return u.origin + '/originals/' + m[2];
      if (u.pathname.indexOf('/originals/') === 0) return u.href.split('#')[0];
    } catch (e) { /* ignore */ }
    return null;
  }

  /**
   * 花瓣原图：
   *   1) https://hbimg.huaban.com/{40位hex}[_fw658]      -> 去掉 _fw 后缀
   *   2) https://hbimg.huaban.com/xxx_fw658/xxx_fw658.jpg -> 去掉各段的 _fw 尺寸标记
   *   3) 去掉 !fw、!webp 等后缀与查询参数
   */
  function huabanOriginal(url) {
    try {
      const u = new URL(url);
      if (!/^(hbimg|img)\.huaban\.com$/.test(u.hostname)) return null;
      let path = u.pathname;
      path = path.replace(/![^/]*$/, ''); // 去掉 !xxx 后缀
      const segs = path.split('/').filter(Boolean);
      const cleaned = segs.map(function (seg) {
        // hex 形式：76c8e4f8..._fw658(.jpg) -> 76c8e4f8...(保留扩展名)
        seg = seg.replace(/^([0-9a-f]{32,64})(_.+?)?(\.[a-z0-9]+)?$/, '$1$3');
        // 通用形式：xxx_fw658.jpg -> xxx.jpg
        seg = seg.replace(/(_fw\d+|_fw|_w\d+|_webp|_small|_l|_c)(\.[a-z0-9]+)?$/i, '$2');
        return seg;
      });
      return u.origin + '/' + cleaned.join('/');
    } catch (e) {
      return null;
    }
  }

  // 从 img 的 srcset 中取最大尺寸的 URL
  function largestFromSrcset(img) {
    const srcset = img && img.srcset;
    if (!srcset) return null;
    let best = null;
    let bestW = -1;
    for (const part of srcset.split(',')) {
      const m = part.trim().match(/^(\S+)(?:\s+(\d+)w)?/);
      if (!m || !m[1]) continue;
      const w = m[2] ? parseInt(m[2], 10) : 0;
      if (w > bestW) {
        bestW = w;
        best = m[1];
      }
    }
    return best;
  }

  // 取一个 img 元素当前最合适的 src（优先 srcset 最大、其次 data-src 懒加载、最后 src）
  function bestSrcOf(img) {
    const fromSet = largestFromSrcset(img);
    if (fromSet) return fromSet;
    const d = img.dataset || {};
    return img.currentSrc || img.src || d.src || d.original || d.lazySrc || d['original-src'] || '';
  }

  // 生成默认文件名
  function defaultFilename(platform, url) {
    const ext = extFromUrl(url);
    return platform + '_' + shortHash(url) + '.' + ext;
  }

  const ImgNormalize = {
    extFromUrl: extFromUrl,
    mediaTypeFromExt: mediaTypeFromExt,
    applyFilters: applyFilters,
    formatBytes: formatBytes,
    mediaIdentity: mediaIdentity,
    urlQuality: urlQuality,
    shortHash: shortHash,
    pinterestOriginal: pinterestOriginal,
    huabanOriginal: huabanOriginal,
    largestFromSrcset: largestFromSrcset,
    bestSrcOf: bestSrcOf,
    defaultFilename: defaultFilename
  };

  globalThis.ImgNormalize = ImgNormalize;
})();
