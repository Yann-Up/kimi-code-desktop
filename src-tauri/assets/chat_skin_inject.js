// 对话页内皮肤立绘注入脚本(实验性)。
// 由主窗口 initialization_script_for_all_frames 注入(lib.rs 建窗处 include_str! 内嵌),
// 在 document-start 于每个框架执行;仅在官方 web UI iframe(回环源子框架)内工作。
// 通信协议(与 src/components/chatSkinBridge.ts 对应,消息均带 __kimiChatSkin 标识):
//   iframe → 壳:{__kimiChatSkin:'ready'}        初始化完成后主动向壳要配置
//   壳 → iframe:{__kimiChatSkin:'cfg', enabled, dataUrl}  配置下发(dataUrl 为皮肤图 data: URL)
// 安全约束:只接受父窗口(壳)的消息且校验壳 origin;任何异常静默吞掉,绝不影响官方页面。
(function () {
  'use strict';
  // 只进子框架;只认回环源(本机/WSL/SSH 通道的 web UI 均经 127.0.0.1 回环访问)
  if (window === window.parent) return;
  if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(location.origin)) return;

  var TAG = '__kimiChatSkin';
  var CONTAINER_ID = 'kimi-chat-skin';
  // 壳侧 origin 白名单:prod 为 tauri 自定义协议域,dev 为 vite dev server
  var PARENT_ORIGINS = ['https://tauri.localhost', 'http://tauri.localhost', 'http://localhost:5188'];

  function removeSkin() {
    var el = document.getElementById(CONTAINER_ID);
    if (el) el.remove();
  }

  function renderSkin(dataUrl) {
    if (!document.body) return; // body 未出:等下一次 cfg 或 ready 重握手
    var el = document.getElementById(CONTAINER_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = CONTAINER_ID;
      el.style.cssText =
        'position:fixed;right:12px;bottom:0;height:60%;pointer-events:none;' +
        'z-index:2147483647;user-select:none;';
      var img = document.createElement('img');
      img.style.cssText = 'height:100%;width:auto;display:block;';
      img.draggable = false;
      el.appendChild(img);
      document.body.appendChild(el);
    }
    var imgEl = el.firstChild;
    if (imgEl && imgEl.src !== dataUrl) imgEl.src = dataUrl;
  }

  window.addEventListener('message', function (e) {
    try {
      var d = e.data;
      if (!d || d[TAG] !== 'cfg') return;
      if (e.source !== window.parent) return;
      if (PARENT_ORIGINS.indexOf(e.origin) < 0) return;
      if (d.enabled && typeof d.dataUrl === 'string') {
        renderSkin(d.dataUrl);
      } else {
        removeSkin();
      }
    } catch (err) { /* 静默:绝不影响官方页面 */ }
  });

  // 初始化完成向壳要配置(iframe 每次导航/重载都会重发,壳按最新配置回复)
  function notifyReady() {
    try {
      window.parent.postMessage({ __kimiChatSkin: 'ready' }, '*');
    } catch (err) { /* 静默 */ }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', notifyReady);
  } else {
    notifyReady();
  }
})();
