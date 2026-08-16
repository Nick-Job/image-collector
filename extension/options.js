/* options.js — 设置页逻辑 */
'use strict';

const $ = function (id) { return document.getElementById(id); };
const statusEl = $('status');

function setStatus(text, ok) {
  statusEl.textContent = text || '';
  statusEl.className = 'status' + (ok ? ' ok' : ok === false ? ' err' : '');
}

function readForm() {
  return {
    token: $('token').value.trim(),
    repo: $('repo').value.trim(),
    branch: $('branch').value.trim() || 'main',
    rootPath: $('rootPath').value.trim() || 'images',
    collection: $('collection').value,
    cdn: $('cdn').value,
    writeManifest: $('writeManifest').checked,
    downloadFolder: $('downloadFolder').value.trim() || '图片收集',
    showFabEverywhere: $('showFabEverywhere').checked
  };
}

function fillForm(s) {
  $('token').value = s.token || '';
  $('repo').value = s.repo || '';
  $('branch').value = s.branch || 'main';
  $('rootPath').value = s.rootPath || 'images';
  $('collection').value = s.collection || 'auto';
  $('cdn').value = s.cdn || 'jsdelivr';
  $('writeManifest').checked = !!s.writeManifest;
  $('downloadFolder').value = s.downloadFolder || '图片收集';
  $('showFabEverywhere').checked = !!s.showFabEverywhere;
}

(async function init() {
  try {
    const r = await chrome.runtime.sendMessage({ type: 'getSettings' });
    if (r && r.settings) fillForm(r.settings);
  } catch (e) {
    setStatus('读取设置失败：' + e.message, false);
  }

  $('save').addEventListener('click', async function () {
    const settings = readForm();
    if (settings.repo && !/^[^/]+\/[^/]+$/.test(settings.repo)) {
      setStatus('仓库格式应为 owner/repo', false);
      return;
    }
    const r = await chrome.runtime.sendMessage({ type: 'saveSettings', settings: settings });
    setStatus(r && r.ok ? '✓ 设置已保存' : '保存失败：' + ((r && r.error) || '未知错误'), r && r.ok);
  });

  $('test').addEventListener('click', async function () {
    const settings = readForm();
    if (!settings.token) { setStatus('请先填写 Token', false); return; }
    if (!settings.repo) { setStatus('请先填写仓库', false); return; }
    await chrome.runtime.sendMessage({ type: 'saveSettings', settings: settings });
    setStatus('正在连接 GitHub…');
    const r = await chrome.runtime.sendMessage({ type: 'testGithub' });
    if (r && r.ok) setStatus('✓ 连接成功：' + r.login, true);
    else setStatus('连接失败：' + ((r && r.error) || '未知错误'), false);
  });
})();
