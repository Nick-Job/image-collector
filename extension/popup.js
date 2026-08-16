/* popup.js — 扩展弹窗逻辑 */
'use strict';

const $ = function (id) { return document.getElementById(id); };

function detectPlatform(url) {
  if (!url) return '';
  try {
    const host = new URL(url).hostname;
    if (/(^|\.)pinterest\./.test(host)) return 'Pinterest';
    if (/(^|\.)huaban\.com$/.test(host)) return '花瓣';
    if (/(^|\.)doubao\.com$/.test(host)) return '豆包';
    if (/jimeng\.jianying\.com$/.test(host)) return '即梦';
    return '';
  } catch (e) {
    return '';
  }
}

function showMsg(text, ok) {
  const el = $('msg');
  el.textContent = text || '';
  el.className = 'msg' + (ok ? ' ok' : '');
}

(async function init() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  const url = (tab && tab.url) || '';
  const name = detectPlatform(url);
  $('site').textContent = name
    ? name + '（已内置扫描器，页面上有 📷 按钮）'
    : '其他网站（可用下方「扫描当前页」通用采集）';

  try {
    const r = await chrome.runtime.sendMessage({ type: 'getSettings' });
    const s = r && r.settings;
    if (s && s.repo) {
      $('gh').textContent = s.repo + (r.hasToken ? '' : '（⚠ 未填 Token）');
    } else {
      $('gh').textContent = '未配置 → 请点下方「设置」';
    }
  } catch (e) {
    $('gh').textContent = '获取设置失败';
  }

  $('btnScan').addEventListener('click', async function () {
    showMsg('');
    const res = await chrome.runtime.sendMessage({ type: 'genericScan' });
    if (res && res.ok) {
      showMsg('已在本页打开采集面板', true);
    } else {
      showMsg('扫描失败：' + ((res && res.error) || '未知错误'));
    }
    setTimeout(function () { window.close(); }, 900);
  });

  $('btnPanel').addEventListener('click', async function () {
    showMsg('');
    const res = await chrome.runtime.sendMessage({ type: 'openCollector' });
    if (res && res.ok) {
      showMsg('已打开采集面板', true);
    } else {
      showMsg('打开失败：' + ((res && res.error) || '未知错误'));
    }
    setTimeout(function () { window.close(); }, 900);
  });

  $('btnOptions').addEventListener('click', function () {
    chrome.runtime.openOptionsPage();
  });
})();
