/**
 * make-icons.js — 生成扩展图标（纯 Node，无依赖）
 * 运行：node tools/make-icons.js
 * 输出：extension/icons/icon16.png icon48.png icon128.png
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------- 最小 PNG 编码器 ---------- */
const CRC_TABLE = (function () {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- 绘制（纯白极简：白色圆角底 + 黑色图形） ---------- */
const INK = [0x1a, 0x1a, 0x1a];        // 近黑（太阳 + 山）
const BORDER_RGBA = [0, 0, 0, 0.06];   // 发丝边框

function drawIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const s = size;
  const r = s * 0.2237; // Apple 图标圆角比例
  const borderW = Math.max(1, s * 0.008); // 发丝边框宽度

  function inRoundedRect(x, y) {
    const m = r;
    if (x < m && y < m) return (x - m) * (x - m) + (y - m) * (y - m) <= m * m;
    if (x > s - m && y < m) return (x - (s - m)) * (x - (s - m)) + (y - m) * (y - m) <= m * m;
    if (x < m && y > s - m) return (x - m) * (x - m) + (y - (s - m)) * (y - (s - m)) <= m * m;
    if (x > s - m && y > s - m) return (x - (s - m)) * (x - (s - m)) + (y - (s - m)) * (y - (s - m)) <= m * m;
    return x >= 0 && x <= s && y >= 0 && y <= s;
  }

  // 是否接近圆角矩形边缘（用于发丝边框）
  function nearEdge(x, y) {
    const cx = s / 2, cy = s / 2;
    // 用矩形外扩 borderW 与外缩 borderW 的面积差近似描边
    const outer = inRoundedRectExpanded(x, y, borderW);
    const inner = inRoundedRectExpanded(x, y, -borderW);
    return outer && !inner;
  }
  function inRoundedRectExpanded(x, y, d) {
    const m = r + d;
    const x0 = -d, y0 = -d, x1 = s + d, y1 = s + d;
    if (x < x0 + m && y < y0 + m) return (x - (x0 + m)) ** 2 + (y - (y0 + m)) ** 2 <= m * m;
    if (x > x1 - m && y < y0 + m) return (x - (x1 - m)) ** 2 + (y - (y0 + m)) ** 2 <= m * m;
    if (x < x0 + m && y > y1 - m) return (x - (x0 + m)) ** 2 + (y - (y1 - m)) ** 2 <= m * m;
    if (x > x1 - m && y > y1 - m) return (x - (x1 - m)) ** 2 + (y - (y1 - m)) ** 2 <= m * m;
    return x >= x0 && x <= x1 && y >= y0 && y <= y1;
  }

  // 图形：太阳（圆）+ 山（两个三角形），居中偏下
  function inSun(x, y) {
    const cx = s * 0.63, cy = s * 0.40, rad = s * 0.085;
    return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
  }
  function inTriangle(px, py, a, b, c) {
    function sign(p1, p2, p3) {
      return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
    }
    const d1 = sign({ x: px, y: py }, a, b);
    const d2 = sign({ x: px, y: py }, b, c);
    const d3 = sign({ x: px, y: py }, c, a);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
  }
  function inMountains(x, y) {
    const a = { x: s * 0.31, y: s * 0.72 }, b = { x: s * 0.51, y: s * 0.46 }, c = { x: s * 0.71, y: s * 0.72 };
    if (inTriangle(x, y, a, b, c)) return true;
    const d = { x: s * 0.52, y: s * 0.72 }, e = { x: s * 0.65, y: s * 0.55 }, f = { x: s * 0.72, y: s * 0.72 };
    return inTriangle(x, y, d, e, f);
  }

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const idx = (y * s + x) * 4;
      let col, alpha = 0;
      if (inRoundedRect(x, y)) {
        alpha = 255;
        if (nearEdge(x, y)) {
          col = [Math.round(255 * (1 - BORDER_RGBA[3])), Math.round(255 * (1 - BORDER_RGBA[3])), Math.round(255 * (1 - BORDER_RGBA[3]))];
        } else if (inSun(x, y) || inMountains(x, y)) {
          col = INK;
        } else {
          col = [255, 255, 255];
        }
      } else {
        col = [0, 0, 0];
        alpha = 0;
      }
      buf[idx] = col[0];
      buf[idx + 1] = col[1];
      buf[idx + 2] = col[2];
      buf[idx + 3] = alpha;
    }
  }
  return encodePNG(s, buf);
}

/* ---------- 输出 ---------- */
const outDir = path.join(__dirname, '..', 'extension', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 48, 128]) {
  const file = path.join(outDir, 'icon' + size + '.png');
  fs.writeFileSync(file, drawIcon(size));
  console.log('✓ ' + path.relative(process.cwd(), file) + ' (' + size + 'x' + size + ')');
}
console.log('完成');
