// 对话页内注入脚本(实验性):皮肤立绘 + 主题/语言上报两个模块。
// 由主窗口 initialization_script_for_all_frames 注入(lib.rs 建窗处 include_str! 内嵌),
// 在 document-start 于每个框架执行;仅在官方 web UI iframe(回环源子框架)内工作。
// 通信协议(与 src/components/chatSkinBridge.ts 对应,消息均带 __kimiChatSkin 标识):
//   iframe → 壳:{__kimiChatSkin:'ready', nonce}   初始化完成后主动向壳要配置
//   壳 → iframe:{__kimiChatSkin:'cfg', enabled, dataUrl}  配置下发(dataUrl 为皮肤图 data: URL)
// 主题/语言协议见文件尾部 prefs 模块注释(与 src/components/chatPrefsBridge.ts 对应)。
// 安全约束:只接受父窗口(壳)的消息且校验壳 origin;任何异常静默吞掉,绝不影响官方页面;
// 上行消息携带 nonce(window.name,壳建 iframe 时下发,壳侧校验来源框架与 nonce 匹配)。
(function () {
  'use strict';
  // 只进子框架;只认回环源(本机/WSL/SSH 通道的 web UI 均经 127.0.0.1 回环访问)
  if (window === window.parent) return;
  if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(location.origin)) return;

  var TAG = '__kimiChatSkin';
  var NONCE = window.name || '';
  var CONTAINER_ID = 'kimi-chat-skin';
  var STYLE_ID = 'kimi-chat-skin-style';
  // 壳侧 origin 白名单:prod 为 tauri 自定义协议域,dev 为 vite dev server
  var PARENT_ORIGINS = ['https://tauri.localhost', 'http://tauri.localhost', 'http://localhost:5188'];

  function removeSkin() {
    var el = document.getElementById(CONTAINER_ID);
    if (el) el.remove();
  }

  // 呼吸微动效 keyframes(与壳侧 theme.css 的 skin-breathe 同款,命名加前缀防撞);
  // 注入 <style> 一次即可;官方页面 loopback 下无 CSP,内联样式不受限
  function ensureStyle() {
    if (document.getElementById(STYLE_ID) || !document.head) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent =
      '@keyframes kimi-chat-skin-breathe{' +
      '0%,100%{transform:translateY(0) scale(1)}' +
      '50%{transform:translateY(-6px) scale(1.015)}}' +
      '@media (prefers-reduced-motion: reduce){' +
      '#' + CONTAINER_ID + ' img{animation:none}}';
    document.head.appendChild(st);
  }

  function renderSkin(dataUrl) {
    if (!document.body) return; // body 未出:等下一次 cfg 或 ready 重握手
    ensureStyle();
    var el = document.getElementById(CONTAINER_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = CONTAINER_ID;
      el.style.cssText =
        // z-index 0:借 DOM 顺序(div 在 #app 之后)浮于聊天内容之上,
        // 但官方弹层/下拉/toast(z≥1~9999)可正常盖住立绘,避免遮挡交互
        'position:fixed;right:12px;bottom:0;height:60%;pointer-events:none;' +
        'z-index:0;user-select:none;';
      var img = document.createElement('img');
      img.style.cssText =
        'height:100%;width:auto;display:block;transform-origin:50% 100%;' +
        'animation:kimi-chat-skin-breathe 3.6s ease-in-out infinite;';
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
      window.parent.postMessage({ __kimiChatSkin: 'ready', nonce: NONCE }, '*');
    } catch (err) { /* 静默 */ }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', notifyReady);
  } else {
    notifyReady();
  }
})();

// 主题/语言上报(与 src/components/chatPrefsBridge.ts 对应,消息带 __kimiChatPrefs 标识):
//   iframe → 壳:{__kimiChatPrefs:'state', theme:'light'|'dark'(解析后), themePref:'light'|'dark'|'system'(原始偏好), locale:'zh'|'en', nonce}
//   iframe → 壳:{__kimiChatPrefs:'health', ok, reason?, detail?, nonce}  每次页面加载自检一次
//   壳 → iframe:{__kimiChatPrefs:'set', theme?:'light'|'dark'|'system', locale?:'zh'|'en'}  壳侧主题/语言切换反推(见文件尾部)
// 读取官方 web UI 内部存储:localStorage kimi-web.color-scheme(light|dark|system,
// system 经 matchMedia 解析成实际明暗再上报)与 kimi-locale(en|zh,缺省按
// navigator.language 是否 zh 开头回退,与官方逻辑对齐)。变更感知:hook localStorage
// setItem/removeItem(官方切主题/语言第一步即写存储,同步拦截同一帧上报,壳与 iframe
// 基本同时变色)+ data-color-scheme 属性 MutationObserver + matchMedia change
// (system 态随系统)+ 1s 轮询(多重兜底,官方内部实现变更时降级不失效)。
// 健康自检(fail-open 的可观测面):加载 3s 后检查官方主题机制是否还在(data-color-scheme
// 属性 / .dark class / style.colorScheme 任一存在即视为存活;localStorage 键缺省合法,
// 不作判据),不在则上报降级,壳设置页可见——键名是官方内部实现,升级改名只会降级不会崩。
(function () {
  'use strict';
  // 与皮肤模块同一守卫:只进回环源子框架
  if (window === window.parent) return;
  if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(location.origin)) return;

  var TAG = '__kimiChatPrefs';
  var NONCE = window.name || '';
  // 壳侧 origin 白名单:与皮肤模块一致(prod tauri 自定义协议域,dev vite 5188)
  var PARENT_ORIGINS = ['https://tauri.localhost', 'http://tauri.localhost', 'http://localhost:5188'];
  var lastTheme = null;
  var lastThemePref = null;
  var lastLocale = null;

  // 原始偏好(三态):读 kimi-web.color-scheme,缺失/非法按官方默认 'system'(_Ae 同款逻辑)
  function themePref() {
    var raw = null;
    try { raw = localStorage.getItem('kimi-web.color-scheme'); } catch (err) { /* 静默 */ }
    return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
  }

  function resolveTheme() {
    var raw = null;
    try { raw = localStorage.getItem('kimi-web.color-scheme'); } catch (err) { /* 静默 */ }
    if (raw !== 'light' && raw !== 'dark' && raw !== 'system') {
      // 键缺失/改名:从 DOM 属性兜底(官方把当前主题写到 data-color-scheme)
      try { raw = document.documentElement.getAttribute('data-color-scheme'); } catch (err) { /* 静默 */ }
    }
    if (raw === 'dark') return 'dark';
    if (raw === 'light') return 'light';
    // system 或未知:按系统偏好解析,壳只认明暗两态
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (err) { return 'light'; }
  }

  function resolveLocale() {
    var raw = null;
    try { raw = localStorage.getItem('kimi-locale'); } catch (err) { /* 静默 */ }
    if (raw === 'en' || raw === 'zh') return raw;
    try { return /^zh/i.test(navigator.language || '') ? 'zh' : 'en'; } catch (err) { return 'zh'; }
  }

  function report() {
    try {
      var theme = resolveTheme();
      var pref = themePref();
      var locale = resolveLocale();
      if (theme === lastTheme && pref === lastThemePref && locale === lastLocale) return; // 无变化不发
      lastTheme = theme;
      lastThemePref = pref;
      lastLocale = locale;
      window.parent.postMessage({ __kimiChatPrefs: 'state', theme: theme, themePref: pref, locale: locale, nonce: NONCE }, '*');
    } catch (err) { /* 静默:绝不影响官方页面 */ }
  }

  // 健康自检:官方主题机制存活判定以 DOM 信号为准(localStorage 键缺省合法,不作判据);
  // 每帧只报一次,结果上壳(设置页"页面桥接"状态)可见
  var healthSent = false;
  function healthCheck() {
    if (healthSent) return;
    healthSent = true;
    try {
      var root = document.documentElement;
      var domAlive =
        root.hasAttribute('data-color-scheme') ||
        root.classList.contains('dark') ||
        !!root.style.colorScheme;
      var themeKey = null;
      var localeKey = null;
      try {
        themeKey = localStorage.getItem('kimi-web.color-scheme');
        localeKey = localStorage.getItem('kimi-locale');
      } catch (err) { /* 静默 */ }
      window.parent.postMessage({
        __kimiChatPrefs: 'health',
        ok: domAlive,
        reason: domAlive ? undefined : 'theme-dom-contract-missing',
        detail:
          'color-scheme-key=' + (themeKey === null ? 'absent' : themeKey) +
          ';locale-key=' + (localeKey === null ? 'absent' : localeKey),
        nonce: NONCE
      }, '*');
    } catch (err) { /* 静默 */ }
  }

  // 低延迟同步的关键:hook localStorage 写入。官方切主题/语言第一步就是写
  // kimi-web.color-scheme / kimi-locale(参考 kickside 的桥接做法),同步拦截同一帧上报,
  // 壳与 iframe 基本同时变色;MutationObserver/轮询只作兜底
  try {
    var WATCH_KEYS = { 'kimi-web.color-scheme': 1, 'kimi-locale': 1 };
    var origSet = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (key, value) {
      var r = origSet(key, value);
      if (WATCH_KEYS[key]) report();
      return r;
    };
    var origRemove = localStorage.removeItem.bind(localStorage);
    localStorage.removeItem = function (key) {
      var r = origRemove(key);
      if (WATCH_KEYS[key]) report();
      return r;
    };
  } catch (err) { /* 静默 */ }

  // 初始上报(iframe 每次导航/重载重发,壳按最新值落地)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', report);
  } else {
    report();
  }
  // 官方切主题写 documentElement 的 data-color-scheme 属性
  try {
    new MutationObserver(report).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-color-scheme']
    });
  } catch (err) { /* 静默 */ }
  // system 态下系统明暗切换
  try {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', report);
  } catch (err) { /* 静默 */ }
  // 语言切换无 DOM 信号,轮询兜底(也兜住主题的其他写入路径)
  setInterval(report, 1000);
  // 加载 3s 后自检一次(等官方 React 完成首轮主题应用再判定)
  setTimeout(healthCheck, 3000);

  // 壳 → iframe:{__kimiChatPrefs:'set', theme?, locale?}(标题栏主题切换/设置页语言切换反推)
  // theme:写 localStorage + data-color-scheme + style.colorScheme,官方 bundle 自带
  // MutationObserver 监听 data-color-scheme,CSS 又完全属性驱动,无刷新即可跟随;
  // 已知行为:会把官方的 system 态写成显式 light/dark。
  // locale:只写 kimi-locale 存储(官方语言切换无 DOM 信号,是否无刷新跟随取决于官方实现,
  // 不保证即时生效,下次加载必然生效;壳自定义页面由壳侧 store 即时切换)。
  // 只收父窗口(壳)且校验 origin。
  window.addEventListener('message', function (e) {
    try {
      var d = e.data;
      if (!d || d[TAG] !== 'set') return;
      if (e.source !== window.parent) return;
      if (PARENT_ORIGINS.indexOf(e.origin) < 0) return;
      if (d.theme === 'light' || d.theme === 'dark' || d.theme === 'system') {
        lastThemePref = d.theme; // 防回声:hook setItem 触发的 report 值相同,不会回发
        try { localStorage.setItem('kimi-web.color-scheme', d.theme); } catch (err) { /* 静默 */ }
        var applied = d.theme === 'system' ? resolveTheme() : d.theme;
        lastTheme = applied;
        document.documentElement.dataset.colorScheme = applied;
        document.documentElement.style.colorScheme = applied;
      }
      if (d.locale === 'zh' || d.locale === 'en') {
        lastLocale = d.locale; // 同上防回声
        try { localStorage.setItem('kimi-locale', d.locale); } catch (err) { /* 静默 */ }
      }
    } catch (err) { /* 静默:绝不影响官方页面 */ }
  });
})();
