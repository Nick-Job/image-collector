/**
 * test-integration.js — 集成测试：用 jsdom 模拟页面，注入扩展内容脚本，
 * 验证 Pinterest / 花瓣扫描、豆包 / 即梦网络拦截提取的端到端行为。
 * 运行：node tools/test-integration.js（需要 npm i jsdom，缓存目录 /tmp/ic-test）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('/tmp/ic-test/node_modules/jsdom');

const EXT = path.join(__dirname, '..', 'extension');
const read = (p) => fs.readFileSync(path.join(EXT, p), 'utf8');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('✓ ' + label); }
  else { fail++; console.log('✗ FAIL ' + label); }
}

function makeWindow(url, html, storageDefaults) {
  const dom = new JSDOM(html || '<!doctype html><html><body></body></html>', {
    url: url,
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const w = dom.window;
  w.chrome = {
    runtime: {
      sendMessage: async () => ({ ok: true }),
      onMessage: { addListener: function () {} },
      openOptionsPage: function () {}
    },
    storage: {
      local: {
        get: function (defaults, cb) {
          const result = Object.assign({}, defaults, storageDefaults || {});
          if (typeof cb === 'function') cb(result);
          return Promise.resolve(result);
        }
      }
    }
  };
  return w;
}

function load(w, ...files) {
  for (const f of files) w.eval(read(f));
}

function fakeResponse(contentType, text) {
  const headers = { get: (k) => (String(k).toLowerCase() === 'content-type' ? contentType : '') };
  const body = Promise.resolve(text);
  return {
    headers: headers,
    clone: function () {
      return { headers: headers, text: () => body };
    }
  };
}

async function tick(n) {
  for (let i = 0; i < (n || 5); i++) await new Promise((r) => setTimeout(r, 60));
}

/* ============ 1. Pinterest 扫描 ============ */
async function testPinterest() {
  const w = makeWindow('https://www.pinterest.com/pin/1234567890/', `
    <html><body>
      <a href="https://www.pinterest.com/pin/1234567890/">
        <img src="https://i.pinimg.com/474x/9c/1a/2b/9c1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c.jpg"
             srcset="https://i.pinimg.com/474x/9c/1a/2b/9c1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c.jpg 474w,
                     https://i.pinimg.com/736x/9c/1a/2b/9c1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c.jpg 736w">
      </a>
      <a href="https://www.pinterest.com/pin/999/">
        <img src="https://i.pinimg.com/originals/aa/bb/cc/aabbccddeeff0011223344556677889900112233.png">
      </a>
    </body></html>
  `);
  load(w, 'content/normalize.js', 'content/collector-ui.js', 'content/pinterest-huaban.js');
  await tick();
  const items = w.__IMGCOLLECTOR__.getItems();
  ok(items.length === 2, 'Pinterest 识别到 2 张图（实际 ' + items.length + '）');
  const urls = items.map((i) => i.url).sort();
  ok(urls.includes('https://i.pinimg.com/originals/9c/1a/2b/9c1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c.jpg'), 'Pinterest 474x/736x 升级为 originals');
  ok(urls.includes('https://i.pinimg.com/originals/aa/bb/cc/aabbccddeeff0011223344556677889900112233.png'), 'Pinterest 已是 originals 保留');
  ok(items.every((i) => i.platform === 'Pinterest'), 'Pinterest 平台标记正确');
  ok(items.every((i) => i.filename.indexOf('pinterest_') === 0), 'Pinterest 文件名前缀正确');
  ok(items[0].source.indexOf('/pin/') >= 0, 'Pinterest 来源链接已记录');
  console.log('');
}

/* ============ 2. 花瓣扫描 ============ */
async function testHuaban() {
  const w = makeWindow('https://huaban.com/boards/12345/landscape/', `
    <html><body>
      <a href="https://huaban.com/pins/111/"><img src="https://hbimg.huaban.com/76c8e4f83de3e37db9b70e58c4d5a41b0b6b6a3c_fw658"></a>
      <a href="https://huaban.com/pins/222/"><img src="https://hbimg.huaban.com/abc123def456_fw236.jpg!fw236"></a>
    </body></html>
  `);
  load(w, 'content/normalize.js', 'content/collector-ui.js', 'content/pinterest-huaban.js');
  await tick();
  const items = w.__IMGCOLLECTOR__.getItems();
  ok(items.length === 2, '花瓣识别到 2 张图（实际 ' + items.length + '）');
  const urls = items.map((i) => i.url).sort();
  ok(urls.includes('https://hbimg.huaban.com/76c8e4f83de3e37db9b70e58c4d5a41b0b6b6a3c'), '花瓣 hex_fw658 -> 原图');
  ok(urls.includes('https://hbimg.huaban.com/abc123def456.jpg'), '花瓣 abc_fw236.jpg -> abc.jpg');
  ok(items.every((i) => i.platform === '花瓣'), '花瓣平台标记正确');
  ok(items.every((i) => i.collection === 'board-landscape'), '花瓣画板名归档正确');
  console.log('');
}

/* ============ 3. 豆包网络拦截 ============ */
async function testDoubao() {
  const w = makeWindow('https://www.doubao.com/chat/abc', '');
  const payload = JSON.stringify({
    data: { messages: [{ content: { creation_block: { creations: [
      { image: { image_ori_raw: { url: 'https://p3.doubao.com/ori/xxx~tplv.webp?x-expires=1&x-signature=abc', width: 1024, height: 1024 } } }
    ] } } }] }
  });
  w.fetch = async function (url) {
    if (String(url).indexOf('doubao.com') >= 0) {
      return fakeResponse('application/json', payload);
    }
    return fakeResponse('text/plain', '{}');
  };
  load(w, 'content/doubao-extract.js');
  await tick();
  const got = [];
  w.addEventListener('message', (e) => {
    if (e.data && e.data.__imgcollector === 1 && e.data.type === 'items') got.push(...e.data.items);
  });
  await w.fetch('https://www.doubao.com/api/chat/stream?x=1');
  await tick(10);
  ok(got.length >= 1, '豆包拦截到图片（实际 ' + got.length + '）');
  ok(got.some((i) => i.url === 'https://p3.doubao.com/ori/xxx~tplv.webp?x-expires=1&x-signature=abc'), '豆包提取 image_ori_raw 原图 URL');
  ok(got.some((i) => i.width === 1024 && i.height === 1024), '豆包图片尺寸正确');
  ok(got.every((i) => i.platform === '豆包'), '豆包平台标记正确');
  console.log('');
}

/* ============ 4. 即梦网络拦截 + DOM 扫描 ============ */
async function testJimeng() {
  const w = makeWindow('https://jimeng.jianying.com/ai-tool/generate', `
    <html><body><img src="https://p3-sign.douyinpic.com/tos-cn-i-0813c001/abc~tplv-0813c001-1:1-1:1.image?x-expires=9&x-signature=s1"></body></html>
  `);
  const payload = JSON.stringify({
    data: { creation_list: [{ creation: { image_origin: { image_url: ['https://p3-sign.douyinpic.com/tos-cn-i-0813c001/ori~tplv-0813c001-image.image?x-expires=9&x-signature=s0'] } } }] }
  });
  w.fetch = async function (url) {
    if (String(url).indexOf('jimeng') >= 0 || String(url).indexOf('jianying') >= 0) {
      return fakeResponse('application/json', payload);
    }
    return fakeResponse('text/plain', '{}');
  };
  load(w, 'content/jimeng-extract.js');
  await tick();
  const got = [];
  w.addEventListener('message', (e) => {
    if (e.data && e.data.__imgcollector === 1 && e.data.type === 'items') got.push(...e.data.items);
  });
  await w.fetch('https://jimeng.jianying.com/mweb/v1/creation/detail?creation_id=1');
  await tick(10);
  ok(got.some((i) => i.url.indexOf('ori~tplv') >= 0), '即梦 API 提取 image_origin 原图');
  const dom2400 = got.find((i) => i.url.indexOf('2400:2400') >= 0);
  ok(!!dom2400, '即梦 DOM 图应用 2400:2400 高清转换');
  ok(got.every((i) => i.platform === '即梦'), '即梦平台标记正确');
  const idxOri = got.findIndex((i) => i.url.indexOf('ori~tplv') >= 0);
  const idx2400 = got.findIndex((i) => i.url.indexOf('2400:2400') >= 0);
  ok(idxOri >= 0 && idx2400 >= 0 && idxOri < idx2400, '即梦 API 原图优先于 DOM 候选排序');
  console.log('');
}

/* ============ 5. 所有网页悬浮按钮（fab-everywhere） ============ */
async function testFabEverywhere() {
  // 开启设置：按钮显示 + 点开自动扫描
  const w = makeWindow('https://example.com/gallery', `
    <html><body>
      <img src="https://cdn.example.com/photo1.jpg" width="800" height="600">
      <img src="https://cdn.example.com/icon.png" width="32" height="32">
    </body></html>
  `, { showFabEverywhere: true });
  // jsdom 不会真正加载图片，手动模拟 naturalWidth/Height
  const imgs = w.document.querySelectorAll('img');
  Object.defineProperty(imgs[0], 'naturalWidth', { value: 800, configurable: true });
  Object.defineProperty(imgs[0], 'naturalHeight', { value: 600, configurable: true });
  Object.defineProperty(imgs[1], 'naturalWidth', { value: 32, configurable: true });
  Object.defineProperty(imgs[1], 'naturalHeight', { value: 32, configurable: true });
  load(w, 'content/normalize.js', 'content/collector-ui.js', 'content/fab-everywhere.js');
  await tick(6);
  const root = w.document.getElementById('imgcollector-root');
  ok(!!root, '通用页面已注入采集器');
  const fab = root && root.shadowRoot && root.shadowRoot.getElementById('fab');
  ok(fab && fab.style.display !== 'none', '开启设置后悬浮按钮显示');
  C_OPEN(w); // 模拟点击按钮打开面板
  await tick(6);
  const items = w.__IMGCOLLECTOR__.getItems();
  ok(items.length === 1, '通用页面扫描收集大图（跳过 32px 小图标，实际 ' + items.length + '）');
  ok(items[0].url === 'https://cdn.example.com/photo1.jpg', '通用页面图片 URL 正确');
  console.log('');

  // 关闭设置：按钮隐藏
  const w2 = makeWindow('https://example.org/page', '', { showFabEverywhere: false });
  load(w2, 'content/normalize.js', 'content/collector-ui.js', 'content/fab-everywhere.js');
  await tick(6);
  const fab2 = w2.document.getElementById('imgcollector-root').shadowRoot.getElementById('fab');
  ok(fab2.style.display === 'none', '关闭设置后悬浮按钮隐藏');

  // 受支持平台页面不被覆盖
  const w3 = makeWindow('https://www.pinterest.com/pin/1/', `
    <html><body><img src="https://i.pinimg.com/474x/9c/1a/2b/9c1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c.jpg"></body></html>
  `, { showFabEverywhere: true });
  load(w3, 'content/normalize.js', 'content/collector-ui.js', 'content/fab-everywhere.js', 'content/pinterest-huaban.js');
  await tick(6);
  const items3 = w3.__IMGCOLLECTOR__.getItems();
  ok(items3.length === 1 && items3[0].platform === 'Pinterest' && items3[0].url.indexOf('/originals/') >= 0,
    '平台页面仍使用专属扫描器（Pinterest originals）');
  console.log('');
}

function C_OPEN(w) { try { w.__IMGCOLLECTOR__.open(); } catch (e) { /* ignore */ } }

/* ============ 6. 视频采集 + 筛选交互 ============ */
async function testVideos() {
  // Pinterest 页面视频
  const w = makeWindow('https://www.pinterest.com/pin/vid1/', `
    <html><body>
      <img src="https://i.pinimg.com/474x/9c/1a/2b/9c1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c.jpg">
      <video src="https://v.pinimg.com/videos/mc/720p/abc123.mp4" poster="https://i.pinimg.com/474x/9c/1a/2b/poster.jpg"></video>
    </body></html>
  `);
  load(w, 'content/normalize.js', 'content/collector-ui.js', 'content/pinterest-huaban.js');
  await tick();
  const pitems = w.__IMGCOLLECTOR__.getItems();
  const pvid = pitems.find((i) => i.type === 'video');
  ok(!!pvid && pvid.url === 'https://v.pinimg.com/videos/mc/720p/abc123.mp4', 'Pinterest 视频采集');
  ok(pvid && pvid.ext === 'mp4' && pvid.filename.indexOf('pinterest_v_') === 0, 'Pinterest 视频文件名/扩展名');
  ok(pitems.length === 2, 'Pinterest 图片+视频共 2 项（实际 ' + pitems.length + '）');
  console.log('');

  // 豆包响应含视频字段
  const w2 = makeWindow('https://www.doubao.com/chat/v', '');
  const payload2 = JSON.stringify({
    data: { creation: { video: { video_origin: { main_url: 'https://p3.doubao.com/video/ori.mp4' } } } }
  });
  w2.fetch = async function (url) {
    return fakeResponse('application/json', payload2);
  };
  load(w2, 'content/doubao-extract.js');
  await tick();
  const got2 = [];
  w2.addEventListener('message', (e) => {
    if (e.data && e.data.__imgcollector === 1 && e.data.type === 'items') got2.push(...e.data.items);
  });
  await w2.fetch('https://www.doubao.com/api/play_info');
  await tick(10);
  const dvid = got2.find((i) => i.type === 'video');
  ok(!!dvid && dvid.url === 'https://p3.doubao.com/video/ori.mp4', '豆包 video_origin 视频提取');
  console.log('');

  // 即梦响应含 video_origin
  const w3 = makeWindow('https://jimeng.jianying.com/ai-tool/generate', '');
  const payload3 = JSON.stringify({
    data: { creation_list: [{ creation: { video_origin: { video_url: ['https://p3-sign.douyinpic.com/tos-cn-i-0813c001/v.mp4'] } } }] }
  });
  w3.fetch = async function (url) {
    return fakeResponse('application/json', payload3);
  };
  load(w3, 'content/jimeng-extract.js');
  await tick();
  const got3 = [];
  w3.addEventListener('message', (e) => {
    if (e.data && e.data.__imgcollector === 1 && e.data.type === 'items') got3.push(...e.data.items);
  });
  await w3.fetch('https://jimeng.jianying.com/mweb/v1/creation/detail?creation_id=2');
  await tick(10);
  const jvid = got3.find((i) => i.type === 'video');
  ok(!!jvid && jvid.url.indexOf('v.mp4') >= 0, '即梦 video_origin 视频提取');
  console.log('');

  // 通用页面视频 + 筛选交互
  const w4 = makeWindow('https://example.com/media', `
    <html><body>
      <img src="https://cdn.example.com/photo.jpg" width="800" height="600">
      <video src="https://cdn.example.com/clip.mp4"></video>
    </body></html>
  `, { showFabEverywhere: true });
  const imgs4 = w4.document.querySelectorAll('img');
  Object.defineProperty(imgs4[0], 'naturalWidth', { value: 800, configurable: true });
  Object.defineProperty(imgs4[0], 'naturalHeight', { value: 600, configurable: true });
  load(w4, 'content/normalize.js', 'content/collector-ui.js', 'content/fab-everywhere.js');
  await tick(6);
  w4.__IMGCOLLECTOR__.open();
  await tick(6);
  const gitems = w4.__IMGCOLLECTOR__.getItems();
  ok(gitems.length === 2 && gitems.some((i) => i.type === 'video'), '通用采集同时收集图片与视频');
  const shadow = w4.document.getElementById('imgcollector-root').shadowRoot;
  const fType = shadow.getElementById('fType');
  ok(!!fType, '筛选条已渲染');
  // 切到「仅视频」
  fType.value = 'video';
  fType.dispatchEvent(new w4.Event('change'));
  await tick(3);
  const gridVid = shadow.getElementById('grid');
  ok(gridVid.children.length === 1, '类型=视频 筛选后只显示视频（实际 ' + gridVid.children.length + '）');
  const firstCard = gridVid.querySelector('.card');
  ok(firstCard && firstCard.querySelector('.type-badge').textContent.indexOf('视频') >= 0, '视频卡片带 🎬 角标');
  // 切回全部
  fType.value = 'all';
  fType.dispatchEvent(new w4.Event('change'));
  await tick(3);
  ok(shadow.getElementById('grid').children.length === 2, '切回全部后显示 2 项');
  console.log('');
}

/* ============ 7. 自动选最大清晰度（同素材多版本合并） ============ */
async function testAutoBestQuality() {
  const w = makeWindow('https://www.pinterest.com/pin/vq/', `
    <html><body>
      <video src="https://v.pinimg.com/videos/mc/480p/xyz.mp4"></video>
      <video src="https://v.pinimg.com/videos/mc/720p/xyz.mp4"></video>
    </body></html>
  `);
  load(w, 'content/normalize.js', 'content/collector-ui.js', 'content/pinterest-huaban.js');
  await tick();
  const items = w.__IMGCOLLECTOR__.getItems();
  const vids = items.filter(function (i) { return i.type === 'video'; });
  ok(vids.length === 1, '同一视频 480p/720p 自动合并为 1 条（实际 ' + vids.length + '）');
  ok(vids[0] && vids[0].url.indexOf('720p') >= 0, '保留最高清晰度 720p');
  console.log('');
}

/* ============ 汇总 ============ */
(async function main() {
  await testPinterest();
  await testHuaban();
  await testDoubao();
  await testJimeng();
  await testFabEverywhere();
  await testVideos();
  await testAutoBestQuality();
  console.log('集成测试结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
