/**
 * test-normalize.js — 对 normalize.js 的 URL 规范化函数做单元测试
 * 运行：node tools/test-normalize.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 在沙箱中加载 normalize.js（纯函数，无浏览器依赖）
const code = fs.readFileSync(path.join(__dirname, '..', 'extension', 'content', 'normalize.js'), 'utf8');
const sandbox = {
  globalThis: {},
  URL: URL,
  URLSearchParams: URLSearchParams
};
sandbox.globalThis.URL = URL;
sandbox.globalThis.URLSearchParams = URLSearchParams;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const N = sandbox.globalThis.ImgNormalize;

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const ok = actual === expected;
  if (ok) pass++; else fail++;
  console.log((ok ? '✓' : '✗ FAIL') + ' ' + label + (ok ? '' : '\n    期望: ' + expected + '\n    实际: ' + actual));
}

/* ---- Pinterest ---- */
eq(
  N.pinterestOriginal('https://i.pinimg.com/474x/9c/1a/2b/9c1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c.jpg'),
  'https://i.pinimg.com/originals/9c/1a/2b/9c1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c.jpg',
  'Pinterest 474x -> originals'
);
eq(
  N.pinterestOriginal('https://i.pinimg.com/736x/ab/cd/ef/abcdef0123456789abcdef0123456789.png'),
  'https://i.pinimg.com/originals/ab/cd/ef/abcdef0123456789abcdef0123456789.png',
  'Pinterest 736x png -> originals'
);
eq(
  N.pinterestOriginal('https://i.pinimg.com/1200x/11/22/33/11223344556677889900aabbccddeeff.webp'),
  'https://i.pinimg.com/originals/11/22/33/11223344556677889900aabbccddeeff.webp',
  'Pinterest 1200x webp -> originals'
);
eq(
  N.pinterestOriginal('https://i.pinimg.com/originals/xx/yy/zz/xxyyzz00112233445566778899aabbccdd.gif'),
  'https://i.pinimg.com/originals/xx/yy/zz/xxyyzz00112233445566778899aabbccdd.gif',
  'Pinterest originals 原样保留'
);
eq(N.pinterestOriginal('https://example.com/foo.jpg'), null, '非 pinimg 返回 null');
eq(N.pinterestOriginal('https://s.pinimg.com/webapp/logo.png'), null, '非 i.pinimg.com 返回 null');

/* ---- 花瓣 ---- */
eq(
  N.huabanOriginal('https://hbimg.huaban.com/76c8e4f83de3e37db9b70e58c4d5a41b0b6b6a3c_fw658'),
  'https://hbimg.huaban.com/76c8e4f83de3e37db9b70e58c4d5a41b0b6b6a3c',
  '花瓣 hex_fw658 -> hex 原图'
);
eq(
  N.huabanOriginal('https://hbimg.huaban.com/76c8e4f83de3e37db9b70e58c4d5a41b0b6b6a3c'),
  'https://hbimg.huaban.com/76c8e4f83de3e37db9b70e58c4d5a41b0b6b6a3c',
  '花瓣 hex 原图保持不变'
);
eq(
  N.huabanOriginal('https://hbimg.huaban.com/abc123def456_fw236.jpg'),
  'https://hbimg.huaban.com/abc123def456.jpg',
  '花瓣 abc_fw236.jpg -> abc.jpg'
);
eq(
  N.huabanOriginal('https://hbimg.huaban.com/abc123def456.jpg!fw'),
  'https://hbimg.huaban.com/abc123def456.jpg',
  '花瓣 去掉 !fw 后缀'
);
eq(
  N.huabanOriginal('https://hbimg.huaban.com/xxx_fw658/4343434343434343434343434343434343434343_fw658.jpg?x=1'),
  'https://hbimg.huaban.com/xxx/4343434343434343434343434343434343434343.jpg',
  '花瓣 多段路径 + 查询参数'
);
eq(N.huabanOriginal('https://img.huaban.com/ab/cd/ef/abcdef0123456789abcdef0123456789'), 'https://img.huaban.com/ab/cd/ef/abcdef0123456789abcdef0123456789', '旧版 img.huaban.com 原图保持不变');
eq(N.huabanOriginal('https://example.com/x.jpg'), null, '非 huaban 返回 null');

/* ---- 扩展名 / 哈希 ---- */
eq(N.extFromUrl('https://i.pinimg.com/originals/a/b/c/hash.JPEG'), 'jpg', 'JPEG -> jpg');
eq(N.extFromUrl('https://x.com/a.png?w=100'), 'png', '带查询参数的 png');
eq(N.extFromUrl('https://x.com/noext'), 'jpg', '无扩展名默认 jpg');
eq(N.shortHash('https://i.pinimg.com/originals/a/b/c/h.jpg').length, 8, 'shortHash 长度 8');
eq(
  N.shortHash('https://i.pinimg.com/originals/a/b/c/h.jpg'),
  N.shortHash('https://i.pinimg.com/originals/a/b/c/h.jpg'),
  'shortHash 确定性'
);
eq(N.defaultFilename('pinterest', 'https://i.pinimg.com/originals/a/b/c/h.png'), 'pinterest_' + N.shortHash('https://i.pinimg.com/originals/a/b/c/h.png') + '.png', 'defaultFilename');

/* ---- 视频 / 筛选 ---- */
eq(N.extFromUrl('https://v.pinimg.com/videos/mc/720p/abc.mp4?x=1'), 'mp4', 'mp4 视频扩展名');
eq(N.extFromUrl('https://x.com/movie.webm'), 'webm', 'webm 视频扩展名');
eq(N.extFromUrl('https://x.com/clip.MOV'), 'mov', 'MOV 视频扩展名');
eq(N.mediaTypeFromExt('mp4'), 'video', 'mp4 -> video');
eq(N.mediaTypeFromExt('webm'), 'video', 'webm -> video');
eq(N.mediaTypeFromExt('jpg'), 'image', 'jpg -> image');
eq(N.mediaTypeFromExt('png'), 'image', 'png -> image');
eq(N.mediaTypeFromExt(''), 'image', '未知 -> image');

const pool = [
  { id: 'a', type: 'image', ext: 'jpg', height: 400, sizeBytes: 100 * 1024 },
  { id: 'b', type: 'image', ext: 'png', height: 1080, sizeBytes: 2 * 1048576 },
  { id: 'c', type: 'image', ext: 'webp', height: 720, sizeBytes: 500 * 1024 },
  { id: 'd', type: 'video', ext: 'mp4', height: 720, sizeBytes: 8 * 1048576 },
  { id: 'e', type: 'video', ext: 'mp4', height: 1080, sizeBytes: 60 * 1048576 },
  { id: 'f', type: 'image', ext: 'gif', height: 300, sizeBytes: null },
  { id: 'g', type: 'image', ext: 'avif', height: 900, sizeBytes: 300 * 1024 }
];
eq(N.applyFilters(pool, {}).length, 7, '无筛选 -> 全部');
eq(N.applyFilters(pool, { type: 'video' }).map(i => i.id).join(','), 'd,e', '类型=视频');
eq(N.applyFilters(pool, { type: 'image', format: 'png' }).map(i => i.id).join(','), 'b', '图片格式=PNG');
eq(N.applyFilters(pool, { type: 'image', format: 'other' }).map(i => i.id).join(','), 'g', '图片格式=其他(avif)');
eq(N.applyFilters(pool, { type: 'image', format: 'other', minHeight: 480 }).map(i => i.id).join(','), 'g', '其他+清晰度组合');
eq(N.applyFilters(pool, { minHeight: 1080 }).map(i => i.id).join(','), 'b,e', '清晰度≥1080');
eq(N.applyFilters(pool, { minHeight: 720 }).map(i => i.id).join(','), 'b,c,d,e,g', '清晰度≥720（未知高度排除）');
eq(N.applyFilters(pool, { minSizeMB: 5 }).map(i => i.id).join(','), 'd,e,f', '大小≥5MB（未知大小放行，300KB 的 g 排除）');
eq(N.applyFilters(pool, { minSizeMB: 50 }).map(i => i.id).join(','), 'e,f', '大小≥50MB');
eq(N.formatBytes(1048576), '1.0 MB', 'formatBytes MB');
eq(N.formatBytes(2048), '2.0 KB', 'formatBytes KB');
eq(N.formatBytes(null), '', 'formatBytes 未知为空');

/* ---- 媒体身份 / 清晰度 ---- */
eq(
  N.mediaIdentity('https://v.pinimg.com/videos/mc/480p/abc123.mp4?x=1'),
  'https://v.pinimg.com/videos/mc/{q}p/abc123.mp4',
  'Pinterest 视频身份归一化质量段'
);
eq(
  N.mediaIdentity('https://v.pinimg.com/videos/mc/720p/abc123.mp4'),
  'https://v.pinimg.com/videos/mc/{q}p/abc123.mp4',
  '720p 与 480p 身份一致'
);
eq(
  N.mediaIdentity('https://p3-sign.douyinpic.com/tos-cn-i-0813c001/abc~tplv-0813c001-1:1-1:1.image?x=1'),
  'https://p3-sign.douyinpic.com/tos-cn-i-0813c001/abc',
  '即梦模板剥离'
);
eq(
  N.mediaIdentity('https://p3-sign.douyinpic.com/tos-cn-i-0813c001/abc~tplv-0813c001-2400:2400-1:1.image'),
  'https://p3-sign.douyinpic.com/tos-cn-i-0813c001/abc',
  '即梦 2400:2400 与 1:1 身份一致'
);
eq(
  N.mediaIdentity('https://i.pinimg.com/originals/a/b/c/hash.jpg'),
  'https://i.pinimg.com/originals/a/b/c/hash.jpg',
  'Pinterest 原图身份即 URL'
);
eq(N.urlQuality('https://v.pinimg.com/videos/mc/720p/x.mp4'), 720, 'urlQuality 720');
eq(N.urlQuality('https://x.com/abc.jpg'), 0, 'urlQuality 无标记为 0');

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
