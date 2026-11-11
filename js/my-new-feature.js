/* ============================================================================
 * my-new-feature.js
 * 纯前端单页应用外挂脚本 —— 审核 · 字卡库 · 梦角引擎
 * 所有数据统一保存在 localStorage['my-audit-cards']
 * 聊天记录只读自 localStorage['xy-home-v2:default:chat-msgs']
 * 全脚本 try...catch 容错，绝不导致原网页白屏
 * ========================================================================== */
(function () {
  'use strict';

  /* --------------------------- 防重复加载 --------------------------- */
  try {
    if (window.__MY_AUDIT_LOADED__) return;
    window.__MY_AUDIT_LOADED__ = true;
  } catch (e) { /* ignore */ }

  /* --------------------------- 常量区 --------------------------- */
  var LS_KEY_CHAT = 'xy-home-v2:default:chat-msgs';
  var LS_KEY_DATA = 'my-audit-cards';
  var DATA_VERSION = 1;

  var ENGINE_INTERVAL = 30 * 60 * 1000;   // 引擎定时器：30 分钟
  var RECENT_MS       = 15 * 60 * 1000;   // 只抓最近 15 分钟
  var MIN_LEN         = 5;                // 字数下限
  var MAX_LEN         = 35;               // 字数上限
  var MAX_AUTO_PENDING = 5;               // 自动抓取待审核积压上限
  var MAX_GRAB_PER_TICK = 2;              // 单轮最多抓 2 条
  var MISCHIEF_RATE   = 0.02;             // 捣乱申请概率 2%
  var HISTORY_LIMIT   = 100;              // 历史档案最多 100 条

  var EMO_WORDS = ['喜欢', '爱', '想你', '开心'];

  var SENDER_MJ = '梦角';
  var SENDER_ME = '我';

  var Z_BASE = 2147483000;

  /* --------------------------- 全局状态 --------------------------- */
  var DB = null;             // 数据对象
  var ROOT = null;           // #ma-root
  var FAB = null;            // 悬浮球 DOM
  var MASK = null;           // 面板遮罩
  var PANEL = null;          // 面板 DOM
  var CURRENT_TAB = 'pending';
  var PANEL_OPEN = false;
  var URL_FORCE_SHOW = false;
  var APP_ICON_EL = null;
  var appIconInjectTimer = null;

  /* ==========================================================================
   * 工具函数
   * ========================================================================== */
  function safe(fn, name, def) {
    try {
      return fn();
    } catch (err) {
      try { console.warn('[审计] ' + (name || 'task') + ' 出错：', err); } catch (e2) {}
      return def;
    }
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' +
      Date.now().toString(36) + '_' +
      Math.random().toString(36).slice(2, 8);
  }

  function esc(str) {
    try {
      return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    } catch (e) { return ''; }
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function fmtTime(ts) {
    try {
      var d = new Date(Number(ts) || Date.now());
      if (isNaN(d.getTime())) return '';
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
        ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    } catch (e) { return ''; }
  }

  function fmtRelative(ts) {
    try {
      var diff = Date.now() - Number(ts || 0);
      if (diff < 60 * 1000) return '刚刚';
      if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前';
      if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + ' 小时前';
      return fmtTime(ts);
    } catch (e) { return ''; }
  }

  function clamp(n, a, b) {
    n = Number(n);
    if (isNaN(n)) n = a;
    return Math.min(b, Math.max(a, n));
  }

  function charLen(str) {
    try { return String(str || '').trim().length; } catch (e) { return 0; }
  }

  function isEmotional(text) {
    try {
      for (var i = 0; i < EMO_WORDS.length; i++) {
        if (String(text).indexOf(EMO_WORDS[i]) >= 0) return true;
      }
    } catch (e) {}
    return false;
  }

  /* ==========================================================================
   * 数据层：localStorage['my-audit-cards']
   * ========================================================================== */
  function defaultSettings() {
    return {
      ballColor: '#ff6b81',
      ballSize: 52,
      ballImage: '',       // base64 裁剪后的悬浮球图片
      appImage: '',        // base64 裁剪后的原生图标图片
      hideAll: false,      // 隐藏所有入口
      ballPos: null        // { x, y } 用户拖拽后的位置
    };
  }

  function defaultData() {
    return {
      version: DATA_VERSION,
      groups: [],       // [{ id, name, disabledBy: [], cards: [{ id, text, disabledBy: [], createdAt }] }]
      pending: [],      // 待审核队列
      history: [],      // 历史档案
      settings: defaultSettings(),
      meta: {
        lastGrabAt: 0,
        grabbedKeys: [],
        lastMischiefAt: 0
      }
    };
  }

  function normalizeData(d) {
    var def = defaultData();
    if (!d || typeof d !== 'object' || Array.isArray(d)) d = def;

    if (!Array.isArray(d.groups)) d.groups = [];
    for (var gi = 0; gi < d.groups.length; gi++) {
      var g = d.groups[gi];
      if (!g || typeof g !== 'object') { d.groups.splice(gi, 1); gi--; continue; }
      if (!g.id) g.id = uid('g');
      if (typeof g.name !== 'string') g.name = '未命名分类';
      if (!Array.isArray(g.disabledBy)) g.disabledBy = [];
      if (!Array.isArray(g.cards)) g.cards = [];
      for (var ci = 0; ci < g.cards.length; ci++) {
        var c = g.cards[ci];
        if (!c || typeof c !== 'object') { g.cards.splice(ci, 1); ci--; continue; }
        if (!c.id) c.id = uid('c');
        if (typeof c.text !== 'string') c.text = '';
        if (!Array.isArray(c.disabledBy)) c.disabledBy = [];
        if (typeof c.createdAt !== 'number') c.createdAt = Date.now();
      }
    }

    if (!Array.isArray(d.pending)) d.pending = [];
    for (var pi = 0; pi < d.pending.length; pi++) {
      var p = d.pending[pi];
      if (!p || typeof p !== 'object') { d.pending.splice(pi, 1); pi--; continue; }
      if (!p.id) p.id = uid('p');
      if (!p.status) p.status = 'pending';
      if (typeof p.time !== 'number') p.time = Date.now();
      if (!p.sender) p.sender = SENDER_MJ;
    }

    if (!Array.isArray(d.history)) d.history = [];
    if (d.history.length > HISTORY_LIMIT) d.history = d.history.slice(-HISTORY_LIMIT);

    if (!d.settings || typeof d.settings !== 'object') d.settings = defaultSettings();
    var s = d.settings, ds = defaultSettings();
    if (typeof s.ballColor !== 'string' || !s.ballColor) s.ballColor = ds.ballColor;
    if (typeof s.ballSize !== 'number' || !isFinite(s.ballSize)) s.ballSize = ds.ballSize;
    s.ballSize = clamp(s.ballSize, 36, 88);
    if (typeof s.ballImage !== 'string') s.ballImage = '';
    if (typeof s.appImage !== 'string') s.appImage = '';
    if (typeof s.hideAll !== 'boolean') s.hideAll = false;
    if (!s.ballPos || typeof s.ballPos !== 'object' ||
        typeof s.ballPos.x !== 'number' || typeof s.ballPos.y !== 'number') {
      s.ballPos = null;
    }

    if (!d.meta || typeof d.meta !== 'object') d.meta = def.meta;
    if (typeof d.meta.lastGrabAt !== 'number') d.meta.lastGrabAt = 0;
    if (typeof d.meta.lastMischiefAt !== 'number') d.meta.lastMischiefAt = 0;
    if (!Array.isArray(d.meta.grabbedKeys)) d.meta.grabbedKeys = [];
    if (d.meta.grabbedKeys.length > 400) {
      d.meta.grabbedKeys = d.meta.grabbedKeys.slice(-400);
    }

    d.version = DATA_VERSION;
    return d;
  }

  function loadData() {
    return safe(function () {
      var raw = localStorage.getItem(LS_KEY_DATA);
      if (!raw) return defaultData();
      var obj = JSON.parse(raw);
      return normalizeData(obj);
    }, 'loadData', defaultData());
  }

  function saveData() {
    return safe(function () {
      localStorage.setItem(LS_KEY_DATA, JSON.stringify(DB));
      return true;
    }, 'saveData', false);
  }

  /* --------------------------- 聊天记录读写 --------------------------- */
  function readChatMsgs() {
    return safe(function () {
      var raw = localStorage.getItem(LS_KEY_CHAT);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    }, 'readChatMsgs', []);
  }

  function writeChatMsgs(arr) {
    return safe(function () {
      localStorage.setItem(LS_KEY_CHAT, JSON.stringify(arr));
      return true;
    }, 'writeChatMsgs', false);
  }

  /* --------------------------- 字卡查找辅助 --------------------------- */
  function groupNameById(gid) {
    try {
      for (var i = 0; i < DB.groups.length; i++) {
        if (DB.groups[i].id === gid) return DB.groups[i].name;
      }
    } catch (e) {}
    return '';
  }

  function findGroup(gid) {
    try {
      for (var i = 0; i < DB.groups.length; i++) {
        if (DB.groups[i].id === gid) return DB.groups[i];
      }
    } catch (e) {}
    return null;
  }

  function findCard(cid) {
    try {
      for (var i = 0; i < DB.groups.length; i++) {
        var g = DB.groups[i];
        for (var j = 0; j < g.cards.length; j++) {
          if (g.cards[j].id === cid) return { group: g, card: g.cards[j] };
        }
      }
    } catch (e) {}
    return null;
  }

  function allCardsCount() {
    var n = 0;
    try {
      for (var i = 0; i < DB.groups.length; i++) n += DB.groups[i].cards.length;
    } catch (e) {}
    return n;
  }

  /* --------------------------- 历史档案 --------------------------- */
  function pushHistory(rec) {
    safe(function () {
      var item = {
        id: uid('h'),
        sender: rec.sender || SENDER_MJ,
        action: rec.action || 'add',
        text: rec.text || '',
        result: rec.result || 'agree',   // agree / reject
        time: Date.now(),
        extra: rec.extra || ''
      };
      DB.history.push(item);
      if (DB.history.length > HISTORY_LIMIT) {
        DB.history = DB.history.slice(DB.history.length - HISTORY_LIMIT);
      }
      saveData();
    }, 'pushHistory');
  }

  /* ==========================================================================
   * 模块一：拟人化梦角引擎
   * ========================================================================== */

  /* 待审核里"自动抓取新增"的积压数量 */
  function autoPendingCount() {
    var n = 0;
    try {
      for (var i = 0; i < DB.pending.length; i++) {
        var p = DB.pending[i];
        if (p.status === 'pending' && p.sender === SENDER_MJ && p.action === 'add') n++;
      }
    } catch (e) {}
    return n;
  }

  /* 总待审核数量（用于红点） */
  function pendingCount() {
    var n = 0;
    try {
      for (var i = 0; i < DB.pending.length; i++) {
        if (DB.pending[i].status === 'pending') n++;
      }
    } catch (e) {}
    return n;
  }

  /* ---------- 抓取逻辑 ---------- */
  function grabFromChat() {
    safe(function () {
      if (!DB) return;

      // 上限控制：积压满 5 条暂停抓取
      var autoN = autoPendingCount();
      if (autoN >= MAX_AUTO_PENDING) return;

      var msgs = readChatMsgs();
      if (!msgs || !msgs.length) return;

      var now = Date.now();
      var cands = [];

      for (var i = 0; i < msgs.length; i++) {
        var m = msgs[i];
        if (!m || typeof m !== 'object') continue;
        if (m.side !== 'out') continue;                       // 只抓用户发言
        if (typeof m.text !== 'string') continue;

        var t = m.text.trim();
        var len = t.length;
        if (len < MIN_LEN || len > MAX_LEN) continue;          // 字数 5~35

        var tm = Number(m.time) || 0;
        if (!tm) continue;
        if (now - tm > RECENT_MS) continue;                    // 只抓最近 15 分钟
        if (now - tm < -60 * 1000) continue;                   // 未来时间容错

        var key = t + '@@' + tm;
        if (DB.meta.grabbedKeys.indexOf(key) >= 0) continue;   // 已判定过，不重复

        cands.push({ text: t, time: tm, key: key });
      }

      if (!cands.length) return;

      // 随机打散
      cands.sort(function () { return Math.random() - 0.5; });

      var added = 0;
      for (var j = 0; j < cands.length; j++) {
        if (added >= MAX_GRAB_PER_TICK) break;
        if (autoPendingCount() + added >= MAX_AUTO_PENDING) break;

        var c = cands[j];
        var emo = isEmotional(c.text);

        // 概率控制：情感词 30%，普通 5%
        var pass = emo ? (Math.random() > 0.7) : (Math.random() > 0.95);

        // 无论是否通过，都记录 key，避免同一条反复摇骰子
        DB.meta.grabbedKeys.push(c.key);

        if (!pass) continue;

        DB.pending.push({
          id: uid('p'),
          action: 'add',
          text: c.text,
          cardId: '',
          fromGroupId: '',
          fromGroupName: '',
          toGroupId: '',
          toGroupName: '',
          sender: SENDER_MJ,          // 自动触发 → 梦角
          auto: true,
          emo: emo,
          time: Date.now(),
          status: 'pending',
          note: emo ? '含情感词，触发概率提升至 30%' : '常规抓取，触发概率 5%'
        });
        added++;
      }

      if (DB.meta.grabbedKeys.length > 400) {
        DB.meta.grabbedKeys = DB.meta.grabbedKeys.slice(-400);
      }
      DB.meta.lastGrabAt = Date.now();
    }, 'grabFromChat');
  }

  /* ---------- 捣乱 / 整理申请 ---------- */
  function maybeMischief() {
    safe(function () {
      if (!DB) return;
      if (Math.random() > MISCHIEF_RATE) return;   // 低概率

      var pool = [];
      for (var i = 0; i < DB.groups.length; i++) {
        var g = DB.groups[i];
        for (var j = 0; j < g.cards.length; j++) {
          pool.push({ group: g, card: g.cards[j] });
        }
      }
      if (!pool.length) return;

      var pick = pool[Math.floor(Math.random() * pool.length)];
      var group = pick.group;
      var card = pick.card;

      var groupDisabled = (group.disabledBy || []).length > 0;
      var cardDisabled = (card.disabledBy || []).length > 0;
      var isDisabled = groupDisabled || cardDisabled;

      // 禁用状态下偏向"恢复启用"，启用状态下偏向"禁用/删除/迁移"
      var actions = isDisabled
        ? ['enable', 'delete', 'move']
        : ['disable', 'delete', 'move'];

      var action = actions[Math.floor(Math.random() * actions.length)];
      var toGroupId = '';
      var toGroupName = '';

      if (action === 'move') {
        var others = [];
        for (var k = 0; k < DB.groups.length; k++) {
          if (DB.groups[k].id !== group.id) others.push(DB.groups[k]);
        }
        if (!others.length) {
          // 没有可迁移目标，退化为 禁用/恢复
          action = isDisabled ? 'enable' : 'disable';
        } else {
          var tgt = others[Math.floor(Math.random() * others.length)];
          toGroupId = tgt.id;
          toGroupName = tgt.name;
        }
      }

      DB.pending.push({
        id: uid('p'),
        action: action,
        text: card.text,
        cardId: card.id,
        fromGroupId: group.id,
        fromGroupName: group.name,
        toGroupId: toGroupId,
        toGroupName: toGroupName,
        sender: SENDER_MJ,
        auto: true,
        time: Date.now(),
        status: 'pending',
        note: '梦角的随机整理申请'
      });

      DB.meta.lastMischiefAt = Date.now();
    }, 'maybeMischief');
  }

  /* ---------- 引擎主循环 ---------- */
  function tickEngine() {
    safe(function () {
      grabFromChat();
      maybeMischief();
      saveData();
      updateBadge();
      if (PANEL_OPEN && CURRENT_TAB === 'pending') renderPanelBody();
    }, 'tickEngine');
  }

  function startEngine() {
    safe(function () {
      // 启动时先跑一次（若距上次超过 30 分钟才抓，避免刷新狂抓）
      var now = Date.now();
      if (!DB.meta.lastGrabAt || (now - DB.meta.lastGrabAt) > ENGINE_INTERVAL) {
        tickEngine();
      } else {
        // 只尝试捣乱，不重复抓取
        maybeMischief();
        saveData();
        updateBadge();
      }
      setInterval(function () {
        safe(tickEngine, 'tickEngine:interval');
      }, ENGINE_INTERVAL);
    }, 'startEngine');
  }

  /* ==========================================================================
   * CSS 注入
   * ========================================================================== */
  function injectCSS() {
    safe(function () {
      if (document.getElementById('ma-style')) return;
      var css = [
        '#ma-root{position:static;margin:0;padding:0;}',
        '#ma-root,#ma-root *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}',

        /* ---------- 悬浮球 ---------- */
        '#ma-fab{',
        '  position:fixed;z-index:' + (Z_BASE + 10) + ';',
        '  display:flex;align-items:center;justify-content:center;',
        '  border-radius:50%;',
        '  color:#fff;font-size:13px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;',
        '  cursor:pointer;user-select:none;',
        '  background-color:#ff6b81;background-size:cover;background-position:center;background-repeat:no-repeat;',
        '  box-shadow:none;border:none;outline:none;',
        '  transition:transform .15s ease,opacity .2s ease;',
        '  touch-action:none;overflow:visible;',
        '}',
        '#ma-fab:active{transform:scale(.94);}',
        '#ma-fab.ma-hidden{display:none!important;}',
        '#ma-fab .ma-fab-dot{',
        '  position:absolute;top:-1px;right:-1px;width:11px;height:11px;border-radius:50%;',
        '  background:#ff2d55;display:none;pointer-events:none;',
        '}',
        '#ma-fab .ma-fab-dot.on{display:block;}',
        '#ma-fab.ma-has-img .ma-fab-txt{display:none;}',

        /* ---------- 克隆 App 图标 ---------- */
        '#ma-app-icon{position:relative;cursor:pointer;}',
        '#ma-app-icon.ma-hidden{display:none!important;}',
        '#ma-app-icon .ma-app-dot{',
        '  position:absolute;top:2px;right:2px;width:10px;height:10px;border-radius:50%;',
        '  background:#ff2d55;display:none;pointer-events:none;',
        '}',
        '#ma-app-icon .ma-app-dot.on{display:block;}',

        /* ---------- 遮罩 & 面板 ---------- */
        '#ma-mask{',
        '  position:fixed;left:0;top:0;right:0;bottom:0;z-index:' + (Z_BASE + 100) + ';',
        '  background:rgba(0,0,0,.42);display:none;',
        '  align-items:center;justify-content:center;',
        '}',
        '#ma-mask.on{display:flex;}',

        '#ma-panel{',
        '  width:min(560px,94vw);max-height:86vh;display:flex;flex-direction:column;',
        '  background:#fff;border-radius:16px;overflow:hidden;',
        '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;',
        '  font-size:14px;color:#222;line-height:1.5;',
        '  box-shadow:0 12px 40px rgba(0,0,0,.22);',
        '}',

        '.ma-header{',
        '  display:flex;align-items:center;justify-content:space-between;',
        '  padding:14px 16px;border-bottom:1px solid #f0f0f0;background:#fafafa;',
        '}',
        '.ma-title{font-size:16px;font-weight:700;letter-spacing:.5px;}',
        '.ma-close{',
        '  width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;',
        '  font-size:20px;color:#999;cursor:pointer;line-height:1;',
        '}',
        '.ma-close:hover{background:#eee;color:#333;}',

        '.ma-tabs{display:flex;border-bottom:1px solid #eee;background:#fff;overflow-x:auto;}',
        '.ma-tab{',
        '  flex:1 0 auto;padding:10px 12px;text-align:center;cursor:pointer;',
        '  font-size:13px;color:#666;white-space:nowrap;position:relative;',
        '  border-bottom:2px solid transparent;transition:.15s;',
        '}',
        '.ma-tab:hover{color:#333;}',
        '.ma-tab.on{color:#ff4d6d;border-bottom-color:#ff4d6d;font-weight:600;}',
        '.ma-tab-badge{',
        '  display:inline-block;min-width:16px;height:16px;line-height:16px;padding:0 4px;',
        '  border-radius:8px;background:#ff2d55;color:#fff;font-size:10px;margin-left:4px;',
        '  font-weight:600;vertical-align:middle;',
        '}',

        '.ma-body{flex:1;overflow-y:auto;padding:12px 14px 20px;-webkit-overflow-scrolling:touch;}',

        /* ---------- 通用控件 ---------- */
        '.ma-btn{',
        '  display:inline-flex;align-items:center;justify-content:center;',
        '  padding:6px 14px;border-radius:8px;border:1px solid #ddd;background:#fff;',
        '  color:#333;font-size:13px;cursor:pointer;user-select:none;',
        '  transition:.15s;line-height:1.4;white-space:nowrap;',
        '}',
        '.ma-btn:hover{background:#f6f6f6;}',
        '.ma-btn.primary{background:#ff4d6d;border-color:#ff4d6d;color:#fff;}',
        '.ma-btn.primary:hover{background:#ff3355;}',
        '.ma-btn.danger{background:#fff;border-color:#ffb3c0;color:#e0355a;}',
        '.ma-btn.danger:hover{background:#fff2f5;}',
        '.ma-btn.sm{padding:3px 9px;font-size:12px;border-radius:6px;}',
        '.ma-btn:disabled{opacity:.45;cursor:not-allowed;}',
        '.ma-btn + .ma-btn{margin-left:6px;}',

        '.ma-input,.ma-select,.ma-textarea{',
        '  width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:8px;',
        '  font-size:13px;color:#222;background:#fff;outline:none;font-family:inherit;',
        '}',
        '.ma-input:focus,.ma-select:focus,.ma-textarea:focus{border-color:#ff8fa3;}',
        '.ma-textarea{resize:vertical;min-height:60px;}',

        '.ma-row{display:flex;align-items:center;gap:8px;margin-bottom:10px;}',
        '.ma-row.wrap{flex-wrap:wrap;}',
        '.ma-label{font-size:13px;color:#555;white-space:nowrap;}',
        '.ma-empty{text-align:center;color:#bbb;padding:40px 10px;font-size:13px;}',
        '.ma-divider{height:1px;background:#f0f0f0;margin:12px 0;}',

        /* ---------- 待审核 ---------- */
        '.ma-pending-item{',
        '  border:1px solid #f0f0f0;border-radius:12px;padding:10px 12px;margin-bottom:10px;background:#fff;',
        '}',
        '.ma-pending-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;flex-wrap:wrap;}',
        '.ma-act-tag{',
        '  display:inline-block;padding:1px 8px;border-radius:6px;font-size:11px;font-weight:600;',
        '  background:#eef4ff;color:#2b6cff;',
        '}',
        '.ma-act-tag.add{background:#e9f9ef;color:#12a150;}',
        '.ma-act-tag.del{background:#ffeef1;color:#e0355a;}',
        '.ma-act-tag.dis{background:#fff5e6;color:#c47d00;}',
        '.ma-act-tag.en{background:#e9f9ef;color:#12a150;}',
        '.ma-act-tag.mv{background:#f0edff;color:#6c4cf0;}',
        '.ma-sender{font-size:12px;color:#888;}',
        '.ma-sender b{color:#ff4d6d;}',
        '.ma-pending-text{font-size:14px;color:#222;word-break:break-all;margin:4px 0 6px;}',
        '.ma-pending-note{font-size:11px;color:#aaa;margin-bottom:8px;}',
        '.ma-pending-actions{display:flex;gap:8px;justify-content:flex-end;}',

        /* ---------- 字卡库 ---------- */
        '.ma-group{border:1px solid #eee;border-radius:12px;margin-bottom:10px;overflow:hidden;background:#fff;}',
        '.ma-group-head{',
        '  display:flex;align-items:center;justify-content:space-between;gap:8px;',
        '  padding:9px 12px;background:#fafafa;cursor:pointer;user-select:none;',
        '}',
        '.ma-group-head:hover{background:#f4f4f4;}',
        '.ma-group-title{display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px;min-width:0;}',
        '.ma-group-title span.name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
        '.ma-group-cnt{font-size:11px;color:#999;font-weight:400;}',
        '.ma-group-tools{display:flex;align-items:center;gap:4px;flex-shrink:0;}',
        '.ma-arrow{display:inline-block;transition:transform .18s;color:#aaa;font-size:11px;}',
        '.ma-group.open .ma-arrow{transform:rotate(90deg);}',
        '.ma-group-body{display:none;padding:8px 10px 10px;border-top:1px solid #f0f0f0;}',
        '.ma-group.open .ma-group-body{display:block;}',

        '.ma-card{',
        '  display:flex;align-items:flex-start;gap:8px;padding:7px 8px;border-radius:8px;',
        '  border:1px solid transparent;transition:.15s;',
        '}',
        '.ma-card:hover{background:#fafafa;border-color:#f0f0f0;}',
        '.ma-card-check{margin-top:3px;flex-shrink:0;}',
        '.ma-card-main{flex:1;min-width:0;}',
        '.ma-card-text{font-size:13px;color:#222;word-break:break-all;}',
        '.ma-card.disabled .ma-card-text{color:#b5b5b5;text-decoration:line-through;}',
        '.ma-card-ops{display:flex;gap:4px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;}',
        '.ma-card-meta{display:flex;gap:6px;align-items:center;margin-top:3px;flex-wrap:wrap;}',

        '.ma-badge-dis{',
        '  display:inline-block;padding:0 6px;border-radius:5px;font-size:10px;line-height:16px;',
        '  font-weight:600;',
        '}',
        '.ma-badge-dis.user{background:#ffeef1;color:#e0355a;}',
        '.ma-badge-dis.mj{background:#f0edff;color:#6c4cf0;}',
        '.ma-badge-dis.both{background:#3a3a3a;color:#fff;}',

        '.ma-bulkbar{',
        '  display:flex;align-items:center;gap:8px;flex-wrap:wrap;',
        '  padding:8px 10px;background:#fafafa;border-radius:10px;margin-bottom:10px;',
        '  font-size:12px;color:#666;',
        '}',

        /* ---------- 历史 ---------- */
        '.ma-history-item{',
        '  display:flex;justify-content:space-between;gap:10px;align-items:flex-start;',
        '  padding:8px 4px;border-bottom:1px dashed #f0f0f0;font-size:12.5px;',
        '}',
        '.ma-history-item:last-child{border-bottom:none;}',
        '.ma-history-main{min-width:0;flex:1;}',
        '.ma-history-text{color:#333;word-break:break-all;}',
        '.ma-history-meta{color:#aaa;font-size:11px;margin-top:2px;}',
        '.ma-res{font-size:11px;font-weight:700;padding:1px 7px;border-radius:6px;flex-shrink:0;}',
        '.ma-res.agree{background:#e9f9ef;color:#12a150;}',
        '.ma-res.reject{background:#ffeef1;color:#e0355a;}',

        /* ---------- 设置 ---------- */
        '.ma-set-block{border:1px solid #eee;border-radius:12px;padding:12px;margin-bottom:12px;}',
        '.ma-set-title{font-size:13px;font-weight:700;margin-bottom:10px;color:#333;}',
        '.ma-range{width:100%;accent-color:#ff4d6d;}',
        '.ma-thumb{',
        '  width:52px;height:52px;border-radius:50%;background:#f0f0f0 center/cover no-repeat;',
        '  border:1px solid #e5e5e5;flex-shrink:0;',
        '}',
        '.ma-thumb.square{border-radius:14px;}',
        '.ma-switch{',
        '  position:relative;width:44px;height:24px;border-radius:12px;background:#ddd;',
        '  cursor:pointer;transition:.2s;flex-shrink:0;',
        '}',
        '.ma-switch.on{background:#ff4d6d;}',
        '.ma-switch::after{',
        '  content:"";position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;',
        '  background:#fff;transition:.2s;',
        '}',
        '.ma-switch.on::after{left:22px;}',

        /* ---------- 裁剪器 ---------- */
        '#ma-crop-mask{',
        '  position:fixed;left:0;top:0;right:0;bottom:0;z-index:' + (Z_BASE + 200) + ';',
        '  background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;',
        '}',
        '#ma-crop-mask.on{display:flex;}',
        '.ma-crop-box{',
        '  width:min(340px,92vw);background:#fff;border-radius:16px;overflow:hidden;',
        '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;',
        '  box-shadow:0 16px 48px rgba(0,0,0,.3);',
        '}',
        '.ma-crop-title{padding:13px 16px;font-size:14px;font-weight:700;border-bottom:1px solid #f0f0f0;text-align:center;}',
        '.ma-crop-stage{',
        '  position:relative;width:100%;padding:18px 0;display:flex;align-items:center;justify-content:center;',
        '  background:#f7f7f8;',
        '}',
        '.ma-crop-canvas-wrap{position:relative;touch-action:none;cursor:grab;}',
        '.ma-crop-canvas-wrap:active{cursor:grabbing;}',
        '.ma-crop-canvas{display:block;background:#fff;}',
        '.ma-crop-hint{font-size:11px;color:#aaa;text-align:center;padding:0 10px 6px;}',
        '.ma-crop-zoom{padding:6px 16px 4px;display:flex;align-items:center;gap:10px;}',
        '.ma-crop-zoom input{flex:1;accent-color:#ff4d6d;}',
        '.ma-crop-actions{display:flex;gap:10px;padding:12px 16px 16px;}',
        '.ma-crop-actions .ma-btn{flex:1;padding:9px 0;font-size:14px;}',

        /* ---------- 自定义模态 ---------- */
        '#ma-modal-mask{',
        '  position:fixed;left:0;top:0;right:0;bottom:0;z-index:' + (Z_BASE + 300) + ';',
        '  background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;',
        '}',
        '#ma-modal-mask.on{display:flex;}',
        '.ma-modal{',
        '  width:min(360px,90vw);background:#fff;border-radius:14px;overflow:hidden;',
        '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;',
        '  box-shadow:0 16px 44px rgba(0,0,0,.28);',
        '}',
        '.ma-modal-title{padding:14px 16px 6px;font-size:15px;font-weight:700;}',
        '.ma-modal-body{padding:6px 16px 14px;font-size:13px;color:#555;}',
        '.ma-modal-actions{display:flex;gap:10px;padding:0 16px 16px;}',
        '.ma-modal-actions .ma-btn{flex:1;padding:8px 0;}',

        /* ---------- Toast ---------- */
        '#ma-toast{',
        '  position:fixed;left:50%;bottom:80px;transform:translateX(-50%) translateY(10px);',
        '  z-index:' + (Z_BASE + 400) + ';background:rgba(0,0,0,.8);color:#fff;',
        '  padding:8px 18px;border-radius:20px;font-size:13px;opacity:0;pointer-events:none;',
        '  transition:opacity .25s,transform .25s;white-space:nowrap;max-width:80vw;',
        '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;',
        '}',
        '#ma-toast.on{opacity:1;transform:translateX(-50%) translateY(0);}',

        /* ---------- 滚动条 ---------- */
        '.ma-body::-webkit-scrollbar{width:6px;}',
        '.ma-body::-webkit-scrollbar-thumb{background:#ddd;border-radius:3px;}',
        '.ma-body::-webkit-scrollbar-track{background:transparent;}'
      ].join('\n');

      var style = document.createElement('style');
      style.id = 'ma-style';
      style.type = 'text/css';
      style.appendChild(document.createTextNode(css));
      (document.head || document.documentElement).appendChild(style);
    }, 'injectCSS');
  }

  /* ==========================================================================
   * 占位：后续部分将在此处继续追加
   * （模块二 UI / 模块三 裁剪 / 模块四 字卡库 / 模块五 审批 / 模块六 发送）
   * ========================================================================== */

  /* 临时声明，避免后续部分引用时未定义 */
  function updateBadge() { /* 将在第 2 部分实现 */ }
  function renderPanelBody() { /* 将在第 2 部分实现 */ }

  /* ---------------------------------------------------------------- */
  /* 暴露调试接口（可选）                                              */
  /* ---------------------------------------------------------------- */
  try {
    window.__MY_AUDIT__ = {
      version: DATA_VERSION,
      reload: function () { DB = loadData(); updateBadge(); if (PANEL_OPEN) renderPanelBody(); },
      tick: function () { safe(tickEngine, 'manual:tick'); },
      dump: function () { return safe(function () { return JSON.parse(JSON.stringify(DB)); }, 'dump', null); }
    };
  } catch (e) {}

})();
  /* ==========================================================================
   * 第 2 部分：双入口 UI（悬浮球 + 克隆图标）、隐藏机制、裁剪预览器
   * ========================================================================== */

  /* --------------------------- 基础：root / toast --------------------------- */
  function ensureRoot() {
    if (ROOT && document.body && document.body.contains(ROOT)) return ROOT;
    ROOT = document.createElement('div');
    ROOT.id = 'ma-root';
    (document.body || document.documentElement).appendChild(ROOT);
    return ROOT;
  }

  function toast(msg, ms) {
    safe(function () {
      ensureRoot();
      var el = document.getElementById('ma-toast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'ma-toast';
        ROOT.appendChild(el);
      }
      el.textContent = String(msg == null ? '' : msg);
      el.classList.add('on');
      clearTimeout(el.__maTimer);
      el.__maTimer = setTimeout(function () {
        try { el.classList.remove('on'); } catch (e) {}
      }, ms || 1800);
    }, 'toast');
  }

  /* ==========================================================================
   * 悬浮球
   * ========================================================================== */
  function buildFab() {
    safe(function () {
      ensureRoot();
      var old = document.getElementById('ma-fab');
      if (old && old.parentNode) old.parentNode.removeChild(old);

      FAB = document.createElement('div');
      FAB.id = 'ma-fab';
      FAB.innerHTML = '<span class="ma-fab-txt">审</span><i class="ma-fab-dot"></i>';
      ROOT.appendChild(FAB);

      applyFabPosition();
      bindFabDrag();

      FAB.addEventListener('click', function (e) {
        // 拖拽后不触发点击（由 bindFabDrag 内部标记）
        if (FAB.__maMoved) { FAB.__maMoved = false; return; }
        try { e.stopPropagation(); } catch (err) {}
        openPanel();
      });
    }, 'buildFab');
  }

  function applyFabPosition() {
    safe(function () {
      if (!FAB) return;
      var s = DB.settings;
      var size = s.ballSize || 52;
      var w = window.innerWidth || 375;
      var h = window.innerHeight || 667;
      var x, y;

      if (s.ballPos && typeof s.ballPos.x === 'number' && typeof s.ballPos.y === 'number') {
        x = clamp(s.ballPos.x, 4, Math.max(4, w - size - 4));
        y = clamp(s.ballPos.y, 4, Math.max(4, h - size - 4));
      } else {
        x = w - size - 18;
        y = h - size - 96;
      }
      FAB.style.left = x + 'px';
      FAB.style.top = y + 'px';
      FAB.style.right = 'auto';
      FAB.style.bottom = 'auto';
      FAB.style.width = size + 'px';
      FAB.style.height = size + 'px';
    }, 'applyFabPosition');
  }

  function bindFabDrag() {
    safe(function () {
      if (!FAB || FAB.__maDragBound) return;
      FAB.__maDragBound = true;

      var dragging = false;
      var startX = 0, startY = 0, originX = 0, originY = 0;

      function onDown(e) {
        try {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          dragging = true;
          FAB.__maMoved = false;
          var r = FAB.getBoundingClientRect();
          startX = e.clientX;
          startY = e.clientY;
          originX = r.left;
          originY = r.top;
          FAB.style.transition = 'none';
          if (FAB.setPointerCapture && e.pointerId != null) {
            try { FAB.setPointerCapture(e.pointerId); } catch (err) {}
          }
          e.preventDefault();
        } catch (err) {}
      }

      function onMove(e) {
        try {
          if (!dragging) return;
          var dx = e.clientX - startX;
          var dy = e.clientY - startY;
          if (!FAB.__maMoved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
            FAB.__maMoved = true;
          }
          if (!FAB.__maMoved) return;

          var size = FAB.offsetWidth || DB.settings.ballSize || 52;
          var w = window.innerWidth;
          var h = window.innerHeight;
          var x = clamp(originX + dx, 4, Math.max(4, w - size - 4));
          var y = clamp(originY + dy, 4, Math.max(4, h - size - 4));
          FAB.style.left = x + 'px';
          FAB.style.top = y + 'px';
          e.preventDefault();
        } catch (err) {}
      }

      function onUp(e) {
        try {
          if (!dragging) return;
          dragging = false;
          FAB.style.transition = '';
          if (FAB.__maMoved) {
            var size = FAB.offsetWidth || 52;
            var x = parseFloat(FAB.style.left) || 0;
            var y = parseFloat(FAB.style.top) || 0;
            DB.settings.ballPos = {
              x: clamp(x, 4, Math.max(4, window.innerWidth - size - 4)),
              y: clamp(y, 4, Math.max(4, window.innerHeight - size - 4))
            };
            saveData();
          }
          if (FAB.releasePointerCapture && e.pointerId != null) {
            try { FAB.releasePointerCapture(e.pointerId); } catch (err) {}
          }
        } catch (err) {}
      }

      if (window.PointerEvent) {
        FAB.addEventListener('pointerdown', onDown);
        FAB.addEventListener('pointermove', onMove);
        FAB.addEventListener('pointerup', onUp);
        FAB.addEventListener('pointercancel', onUp);
      } else {
        // 兼容老浏览器
        FAB.addEventListener('mousedown', function (e) {
          onDown({ clientX: e.clientX, clientY: e.clientY, button: e.button, preventDefault: function () { e.preventDefault(); } });
          function mm(ev) { onMove({ clientX: ev.clientX, clientY: ev.clientY, preventDefault: function () { ev.preventDefault(); } }); }
          function mu(ev) { onUp({}); document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); }
          document.addEventListener('mousemove', mm);
          document.addEventListener('mouseup', mu);
        });
        FAB.addEventListener('touchstart', function (e) {
          var t = e.touches[0];
          onDown({ clientX: t.clientX, clientY: t.clientY, preventDefault: function () { e.preventDefault(); } });
        }, { passive: false });
        FAB.addEventListener('touchmove', function (e) {
          var t = e.touches[0];
          onMove({ clientX: t.clientX, clientY: t.clientY, preventDefault: function () { e.preventDefault(); } });
        }, { passive: false });
        FAB.addEventListener('touchend', function () { onUp({}); });
      }
    }, 'bindFabDrag');
  }

  /* ==========================================================================
   * 原生 App 图标（克隆法）
   * ========================================================================== */
  var APP_ICON_IMG_EL = null;

  function injectAppIcon() {
    return safe(function () {
      if (APP_ICON_EL && document.body.contains(APP_ICON_EL)) return true;

      var natives = document.querySelectorAll('.app:not([data-ma-clone])');
      if (!natives.length) return false;

      // 优先挑可见节点作为样板
      var src = null;
      for (var i = 0; i < natives.length; i++) {
        var el = natives[i];
        if (el.offsetParent !== null && el.getBoundingClientRect().width > 0) { src = el; break; }
      }
      if (!src) src = natives[0];

      var clone = null;
      try {
        clone = src.cloneNode(true);
      } catch (e) {
        return false;
      }
      if (!clone) return false;

      // 1. 清除所有 id，避免冲突
      if (clone.id) clone.removeAttribute('id');
      var ids = clone.querySelectorAll ? clone.querySelectorAll('[id]') : [];
      for (var k = 0; k < ids.length; k++) {
        try { ids[k].removeAttribute('id'); } catch (e2) {}
      }

      // 2. 清除内联样式（保留结构，样式由原生 CSS 继承）
      clone.removeAttribute('style');
      var styled = clone.querySelectorAll ? clone.querySelectorAll('[style]') : [];
      for (var si = 0; si < styled.length; si++) {
        try { styled[si].removeAttribute('style'); } catch (e3) {}
      }

      // 3. 移除原生交互态
      try {
        clone.classList.remove('active', 'dragging', 'selected', 'on');
      } catch (e4) {}

      // 4. 记录是否存在图形元素（img/svg/canvas）
      var hasGraphic = false;
      try {
        hasGraphic = !!(clone.querySelector('img,svg,canvas,picture') ||
          /^(IMG|SVG|CANVAS|PICTURE)$/i.test(clone.tagName || ''));
      } catch (e5) {}

      // 5. 清空所有文本节点
      try {
        var walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT, null, false);
        var textNodes = [];
        var tn;
        while ((tn = walker.nextNode())) textNodes.push(tn);
        for (var ti = 0; ti < textNodes.length; ti++) {
          textNodes[ti].nodeValue = '';
        }
      } catch (e6) {
        try { if (!hasGraphic) clone.textContent = ''; } catch (e7) {}
      }

      // 6. 写入「审核」文字
      var nameEl = null;
      try {
        nameEl = clone.querySelector(
          '.app-name,.app-title,.app-label,.name,.title,.label,[class*="name"],[class*="label"],[class*="title"]'
        );
      } catch (e8) {}

      if (nameEl && !/^(IMG|SVG|CANVAS)$/i.test(nameEl.tagName || '')) {
        nameEl.textContent = '审核';
      } else {
        var span = document.createElement('div');
        span.className = 'ma-clone-name';
        span.textContent = '审核';
        span.style.cssText =
          'font-size:12px;line-height:1.4;text-align:center;width:100%;' +
          'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        // 若 clone 本身是纯文本节点容器，直接塞文字
        try { clone.appendChild(span); } catch (e9) {}
      }

      // 7. 红点
      var dot = document.createElement('i');
      dot.className = 'ma-app-dot';
      try { clone.appendChild(dot); } catch (e10) {}

      // 8. 绑定标识
      clone.id = 'ma-app-icon';
      clone.setAttribute('data-ma-clone', '1');

      // 9. 记录图标图形容器（用于后续换图）
      try {
        APP_ICON_IMG_EL = clone.querySelector('.app-icon,.icon,img,svg,[class*="icon"]');
      } catch (e11) {
        APP_ICON_IMG_EL = null;
      }

      // 10. 注入
      var grid = document.querySelector('.app-grid');
      if (grid) {
        grid.appendChild(clone);
      } else if (src.parentNode) {
        src.parentNode.insertBefore(clone, src.nextSibling);
      } else {
        return false;
      }

      APP_ICON_EL = clone;

      // 11. 点击 → 打开面板（带拖拽位移判定，避免误触）
      var pdX = 0, pdY = 0, pdMoved = false;
      clone.addEventListener('pointerdown', function (e) {
        pdX = e.clientX; pdY = e.clientY; pdMoved = false;
      }, true);
      clone.addEventListener('pointermove', function (e) {
        if (Math.abs(e.clientX - pdX) > 6 || Math.abs(e.clientY - pdY) > 6) pdMoved = true;
      }, true);
      clone.addEventListener('click', function (e) {
        if (pdMoved) { pdMoved = false; return; }
        try { e.preventDefault(); e.stopPropagation(); } catch (err) {}
        openPanel();
      }, true);

      applyVisibility();
      applyAppearance();
      updateBadge();
      return true;
    }, 'injectAppIcon', false);
  }

  /* 轮询注入（原页面可能异步渲染 .app-grid） */
  function startAppIconWatcher() {
    safe(function () {
      var tries = 0;
      if (appIconInjectTimer) clearInterval(appIconInjectTimer);
      if (injectAppIcon()) return;

      appIconInjectTimer = setInterval(function () {
        safe(function () {
          tries++;
          if (injectAppIcon() || tries >= 40) {
            clearInterval(appIconInjectTimer);
            appIconInjectTimer = null;
          }
        }, 'appIconWatcher:tick');
      }, 800);
    }, 'startAppIconWatcher');
  }

  /* 重建克隆图标（用于"移除自定义图片"时还原外观） */
  function refreshAppIcon() {
    safe(function () {
      if (APP_ICON_EL && APP_ICON_EL.parentNode) {
        try { APP_ICON_EL.parentNode.removeChild(APP_ICON_EL); } catch (e) {}
      }
      APP_ICON_EL = null;
      APP_ICON_IMG_EL = null;
      injectAppIcon();
    }, 'refreshAppIcon');
  }

  /* ==========================================================================
   * 隐藏机制
   * ========================================================================== */
  function applyVisibility() {
    safe(function () {
      var hide = !!(DB.settings.hideAll && !URL_FORCE_SHOW);
      if (FAB) {
        if (hide) FAB.classList.add('ma-hidden');
        else FAB.classList.remove('ma-hidden');
      }
      if (APP_ICON_EL) {
        if (hide) APP_ICON_EL.classList.add('ma-hidden');
        else APP_ICON_EL.classList.remove('ma-hidden');
      }
      // 隐藏时劫持原生 App 点击作为"唯一恢复入口"
      bindNativeHijack(hide);
    }, 'applyVisibility');
  }

  /**
   * hideAll 开启时：点击原网站自己的 .app 图标 → 打开我们的面板
   * （不生成任何透明条，只在开关生效期间临时挂监听，关闭后立即解绑）
   */
  function bindNativeHijack(on) {
    safe(function () {
      var natives = document.querySelectorAll('.app:not([data-ma-clone])');
      for (var i = 0; i < natives.length; i++) {
        var el = natives[i];
        if (on) {
          if (!el.__maHijack) {
            el.__maHijack = function (e) {
              try {
                if (!DB.settings.hideAll) return;
                e.preventDefault();
                e.stopPropagation();
                openPanel();
              } catch (err) {}
            };
            el.addEventListener('click', el.__maHijack, true);
          }
        } else if (el.__maHijack) {
          try { el.removeEventListener('click', el.__maHijack, true); } catch (e2) {}
          el.__maHijack = null;
        }
      }
    }, 'bindNativeHijack');
  }

  /* ==========================================================================
   * 外观应用
   * ========================================================================== */
  function applyAppearance() {
    safe(function () {
      var s = DB.settings;

      /* 悬浮球 */
      if (FAB) {
        var size = clamp(s.ballSize || 52, 36, 88);
        FAB.style.width = size + 'px';
        FAB.style.height = size + 'px';
        FAB.style.fontSize = Math.max(11, Math.round(size * 0.30)) + 'px';

        if (s.ballImage) {
          FAB.style.backgroundImage = 'url("' + s.ballImage + '")';
          FAB.style.backgroundColor = 'transparent';
          FAB.classList.add('ma-has-img');
        } else {
          FAB.style.backgroundImage = '';
          FAB.style.backgroundColor = s.ballColor || '#ff6b81';
          FAB.classList.remove('ma-has-img');
        }
      }

      /* 原生图标 */
      if (APP_ICON_EL) {
        if (s.appImage) {
          var holder = APP_ICON_IMG_EL || APP_ICON_EL;
          try {
            if (holder.tagName === 'IMG') {
              holder.src = s.appImage;
            } else if (holder.tagName === 'SVG') {
              // 无法内联换图，退回到外层背景
              APP_ICON_EL.style.backgroundImage = 'url("' + s.appImage + '")';
              APP_ICON_EL.style.backgroundSize = 'cover';
              APP_ICON_EL.style.backgroundPosition = 'center';
            } else {
              holder.style.backgroundImage = 'url("' + s.appImage + '")';
              holder.style.backgroundSize = 'cover';
              holder.style.backgroundPosition = 'center';
              holder.style.backgroundRepeat = 'no-repeat';
            }
          } catch (e) {}
        } else {
          // 无自定义图片：保持克隆时的原生外观
          try {
            if (APP_ICON_IMG_EL) {
              if (APP_ICON_IMG_EL.tagName !== 'IMG' && APP_ICON_IMG_EL.tagName !== 'SVG') {
                APP_ICON_IMG_EL.style.backgroundImage = '';
              }
            }
          } catch (e2) {}
        }
      }
    }, 'applyAppearance');
  }

  /* ==========================================================================
   * 红点（静默，绝不 alert）
   * ========================================================================== */
  function updateBadge() {
    safe(function () {
      var n = pendingCount();

      var fabDot = FAB ? FAB.querySelector('.ma-fab-dot') : null;
      if (fabDot) {
        if (n > 0) fabDot.classList.add('on');
        else fabDot.classList.remove('on');
      }

      var appDot = APP_ICON_EL ? APP_ICON_EL.querySelector('.ma-app-dot') : null;
      if (appDot) {
        if (n > 0) appDot.classList.add('on');
        else appDot.classList.remove('on');
      }

      var tb = PANEL ? PANEL.querySelector('.ma-tab[data-tab="pending"] .ma-tab-badge') : null;
      if (tb) {
        tb.textContent = n > 99 ? '99+' : String(n);
        tb.style.display = n > 0 ? 'inline-block' : 'none';
      }
    }, 'updateBadge');
  }

  /* ==========================================================================
   * 面板骨架
   * ========================================================================== */
  var TAB_DEF = [
    { key: 'pending', label: '待审核' },
    { key: 'cards',   label: '字卡库' },
    { key: 'history', label: '历史档案' },
    { key: 'settings', label: '设置' }
  ];

  function buildUI() {
    safe(function () {
      ensureRoot();

      /* ---------- 面板遮罩 ---------- */
      var oldMask = document.getElementById('ma-mask');
      if (oldMask && oldMask.parentNode) oldMask.parentNode.removeChild(oldMask);

      MASK = document.createElement('div');
      MASK.id = 'ma-mask';

      PANEL = document.createElement('div');
      PANEL.id = 'ma-panel';

      var tabHtml = '';
      for (var i = 0; i < TAB_DEF.length; i++) {
        var t = TAB_DEF[i];
        tabHtml += '<div class="ma-tab' + (t.key === CURRENT_TAB ? ' on' : '') +
          '" data-tab="' + t.key + '">' + t.label +
          (t.key === 'pending' ? '<span class="ma-tab-badge" style="display:none;">0</span>' : '') +
          '</div>';
      }

      PANEL.innerHTML =
        '<div class="ma-header">' +
          '<div class="ma-title">审核中心</div>' +
          '<div class="ma-close" id="ma-close">×</div>' +
        '</div>' +
        '<div class="ma-tabs" id="ma-tabs">' + tabHtml + '</div>' +
        '<div class="ma-body" id="ma-body"></div>';

      MASK.appendChild(PANEL);
      ROOT.appendChild(MASK);

      // 关闭
      var closeBtn = PANEL.querySelector('#ma-close');
      if (closeBtn) closeBtn.addEventListener('click', closePanel);

      MASK.addEventListener('click', function (e) {
        if (e.target === MASK) closePanel();
      });

      // Tab 切换
      var tabsBox = PANEL.querySelector('#ma-tabs');
      if (tabsBox) {
        tabsBox.addEventListener('click', function (e) {
          var el = e.target;
          while (el && el !== tabsBox && !el.getAttribute('data-tab')) el = el.parentNode;
          if (!el || el === tabsBox) return;
          var key = el.getAttribute('data-tab');
          if (!key) return;
          CURRENT_TAB = key;
          renderTabs();
          renderPanelBody();
        });
      }

      // 裁剪遮罩 / 通用模态 / Toast 容器
      if (!document.getElementById('ma-crop-mask')) {
        var cm = document.createElement('div');
        cm.id = 'ma-crop-mask';
        ROOT.appendChild(cm);
      }
      if (!document.getElementById('ma-modal-mask')) {
        var mm = document.createElement('div');
        mm.id = 'ma-modal-mask';
        ROOT.appendChild(mm);
      }
      if (!document.getElementById('ma-toast')) {
        var tt = document.createElement('div');
        tt.id = 'ma-toast';
        ROOT.appendChild(tt);
      }

      // ESC 关闭
      if (!window.__maEscBound) {
        window.__maEscBound = true;
        document.addEventListener('keydown', function (e) {
          try {
            if (e.key === 'Escape') {
              var cm2 = document.getElementById('ma-crop-mask');
              var mm2 = document.getElementById('ma-modal-mask');
              if (cm2 && cm2.classList.contains('on')) { cm2.classList.remove('on'); return; }
              if (mm2 && mm2.classList.contains('on')) { mm2.classList.remove('on'); return; }
              if (PANEL_OPEN) closePanel();
            }
          } catch (err) {}
        });
      }
    }, 'buildUI');
  }

  function renderTabs() {
    safe(function () {
      if (!PANEL) return;
      var tabs = PANEL.querySelectorAll('.ma-tab');
      for (var i = 0; i < tabs.length; i++) {
        var t = tabs[i];
        if (t.getAttribute('data-tab') === CURRENT_TAB) t.classList.add('on');
        else t.classList.remove('on');
      }
      updateBadge();
    }, 'renderTabs');
  }

  function openPanel() {
    safe(function () {
      ensureRoot();
      if (!MASK) buildUI();
      if (!MASK) return;
      MASK.classList.add('on');
      PANEL_OPEN = true;
      renderTabs();
      renderPanelBody();
      updateBadge();
    }, 'openPanel');
  }

  function closePanel() {
    safe(function () {
      if (MASK) MASK.classList.remove('on');
      PANEL_OPEN = false;
    }, 'closePanel');
  }

  /* 面板 body 调度（第 3 部分会覆盖各 Tab 渲染与事件绑定） */
  function renderPanelBody() {
    safe(function () {
      if (!PANEL) return;
      var body = PANEL.querySelector('#ma-body');
      if (!body) return;

      var html = '';
      if (CURRENT_TAB === 'pending') html = renderPendingTab();
      else if (CURRENT_TAB === 'cards') html = renderCardsTab();
      else if (CURRENT_TAB === 'history') html = renderHistoryTab();
      else html = renderSettingsTab();

      body.innerHTML = html || '';
      bindPanelBodyEvents(body);
    }, 'renderPanelBody');
  }

  function bindPanelBodyEvents(body) {
    safe(function () {
      if (CURRENT_TAB === 'pending') bindPendingEvents(body);
      else if (CURRENT_TAB === 'cards') bindCardsEvents(body);
      else if (CURRENT_TAB === 'history') bindHistoryEvents(body);
      else bindSettingsEvents(body);
    }, 'bindPanelBodyEvents');
  }

  /* ---- 第 3 部分将覆盖以下占位（先定义，保证本部分独立运行不报错） ---- */
  function renderPendingTab() { return '<div class="ma-empty">待审核（加载中…）</div>'; }
  function renderCardsTab()   { return '<div class="ma-empty">字卡库（加载中…）</div>'; }
  function renderHistoryTab() { return '<div class="ma-empty">历史档案（加载中…）</div>'; }
  function bindPendingEvents() {}
  function bindCardsEvents() {}
  function bindHistoryEvents() {}

  /* ==========================================================================
   * 设置页（模块三 + 隐藏开关 + 导入导出）
   * ========================================================================== */
  function renderSettingsTab() {
    var s = DB.settings;
    var h = '';

    /* ---- 悬浮球外观 ---- */
    h += '<div class="ma-set-block">';
    h += '<div class="ma-set-title">悬浮球外观</div>';

    h += '<div class="ma-row">';
    h += '<span class="ma-label" style="width:52px;">颜色</span>';
    h += '<input type="color" id="ma-set-color" value="' + esc(s.ballColor) + '" ' +
         'style="width:46px;height:28px;border:1px solid #eee;border-radius:6px;background:none;padding:0;cursor:pointer;">';
    h += '<span style="font-size:11px;color:#bbb;">' + esc(s.ballColor) + '</span>';
    h += '</div>';

    h += '<div class="ma-row">';
    h += '<span class="ma-label" style="width:52px;">大小</span>';
    h += '<input type="range" class="ma-range" id="ma-set-size" min="36" max="88" step="1" value="' + s.ballSize + '">';
    h += '<span class="ma-label" id="ma-set-size-val" style="width:44px;text-align:right;">' + s.ballSize + 'px</span>';
    h += '</div>';

    h += '<div class="ma-row">';
    h += '<div class="ma-thumb" id="ma-set-ball-thumb" style="' +
         (s.ballImage
           ? 'background-image:url(&quot;' + s.ballImage + '&quot;);'
           : 'background:' + esc(s.ballColor) + ';') + '"></div>';
    h += '<button class="ma-btn sm" id="ma-set-ball-upload">上传图片</button>';
    if (s.ballImage) h += '<button class="ma-btn sm danger" id="ma-set-ball-clear">移除图片</button>';
    h += '</div>';
    h += '<div style="font-size:11px;color:#aaa;">上传后为正圆形裁剪预览，可拖动调整位置</div>';
    h += '</div>';

    /* ---- 图标外观 ---- */
    h += '<div class="ma-set-block">';
    h += '<div class="ma-set-title">审核图标外观</div>';
    h += '<div class="ma-row">';
    h += '<div class="ma-thumb square" id="ma-set-app-thumb" style="' +
         (s.appImage
           ? 'background-image:url(&quot;' + s.appImage + '&quot;);'
           : 'background:#f5f5f5;') + '"></div>';
    h += '<button class="ma-btn sm" id="ma-set-app-upload">上传图片</button>';
    if (s.appImage) h += '<button class="ma-btn sm danger" id="ma-set-app-clear">移除图片</button>';
    h += '</div>';
    h += '<div style="font-size:11px;color:#aaa;">尺寸继承原生图标样式，不可改大小；上传为圆角方形裁剪预览</div>';
    h += '</div>';

    /* ---- 隐藏机制 ---- */
    h += '<div class="ma-set-block">';
    h += '<div class="ma-set-title">入口显示</div>';
    h += '<div class="ma-row" style="justify-content:space-between;">';
    h += '<div>';
    h += '<div style="font-size:13px;color:#333;">隐藏所有入口</div>';
    h += '<div style="font-size:11px;color:#aaa;margin-top:2px;">开启后悬浮球与图标隐藏；点击原生 App 图标可进入面板恢复；' +
         '或在网址后加 <b>?show_audit=true</b> 强制唤醒</div>';
    h += '</div>';
    h += '<div class="ma-switch' + (s.hideAll ? ' on' : '') + '" id="ma-set-hide"></div>';
    h += '</div>';
    h += '</div>';

    /* ---- 导入导出 ---- */
    h += '<div class="ma-set-block">';
    h += '<div class="ma-set-title">数据备份</div>';
    h += '<div class="ma-row wrap">';
    h += '<button class="ma-btn" id="ma-export">导出备份</button>';
    h += '<button class="ma-btn danger" id="ma-import">导入备份</button>';
    h += '<input type="file" id="ma-import-file" accept=".json,application/json" style="display:none;">';
    h += '</div>';
    h += '<div style="font-size:11px;color:#aaa;">备份包含：字卡库、待审核、历史档案、外观设置</div>';
    h += '</div>';

    return h;
  }

  function bindSettingsEvents(body) {
    safe(function () {
      if (!body) return;

      /* 颜色 */
      var colorEl = body.querySelector('#ma-set-color');
      if (colorEl) {
        colorEl.addEventListener('input', function () {
          safe(function () {
            DB.settings.ballColor = colorEl.value;
            var thumb = body.querySelector('#ma-set-ball-thumb');
            if (thumb && !DB.settings.ballImage) thumb.style.background = colorEl.value;
            applyAppearance();
          }, 'setColor:input');
        });
        colorEl.addEventListener('change', function () {
          safe(function () {
            DB.settings.ballColor = colorEl.value;
            saveData();
            applyAppearance();
            renderPanelBody();
          }, 'setColor:change');
        });
      }

      /* 大小 */
      var sizeEl = body.querySelector('#ma-set-size');
      var sizeVal = body.querySelector('#ma-set-size-val');
      if (sizeEl) {
        sizeEl.addEventListener('input', function () {
          safe(function () {
            var v = clamp(parseInt(sizeEl.value, 10) || 52, 36, 88);
            DB.settings.ballSize = v;
            if (sizeVal) sizeVal.textContent = v + 'px';
            applyAppearance();
            applyFabPosition();
          }, 'setSize:input');
        });
        sizeEl.addEventListener('change', function () {
          safe(function () {
            DB.settings.ballSize = clamp(parseInt(sizeEl.value, 10) || 52, 36, 88);
            saveData();
            applyAppearance();
            applyFabPosition();
          }, 'setSize:change');
        });
      }

      /* 悬浮球图片 */
      var ballUp = body.querySelector('#ma-set-ball-upload');
      if (ballUp) {
        ballUp.addEventListener('click', function () {
          openCropper({
            title: '裁剪悬浮球图片',
            shape: 'circle',
            onConfirm: function (dataURL) {
              safe(function () {
                DB.settings.ballImage = dataURL;
                saveData();
                applyAppearance();
                renderPanelBody();
                toast('悬浮球图片已更新');
              }, 'ballImage:confirm');
            }
          });
        });
      }
      var ballClear = body.querySelector('#ma-set-ball-clear');
      if (ballClear) {
        ballClear.addEventListener('click', function () {
          safe(function () {
            DB.settings.ballImage = '';
            saveData();
            applyAppearance();
            renderPanelBody();
            toast('已移除悬浮球图片');
          }, 'ballImage:clear');
        });
      }

      /* 图标图片 */
      var appUp = body.querySelector('#ma-set-app-upload');
      if (appUp) {
        appUp.addEventListener('click', function () {
          openCropper({
            title: '裁剪审核图标',
            shape: 'square',
            onConfirm: function (dataURL) {
              safe(function () {
                DB.settings.appImage = dataURL;
                saveData();
                applyAppearance();
                renderPanelBody();
                toast('图标图片已更新');
              }, 'appImage:confirm');
            }
          });
        });
      }
      var appClear = body.querySelector('#ma-set-app-clear');
      if (appClear) {
        appClear.addEventListener('click', function () {
          safe(function () {
            DB.settings.appImage = '';
            saveData();
            refreshAppIcon();
            applyAppearance();
            renderPanelBody();
            toast('已移除图标图片');
          }, 'appImage:clear');
        });
      }

      /* 隐藏开关 */
      var hideEl = body.querySelector('#ma-set-hide');
      if (hideEl) {
        hideEl.addEventListener('click', function () {
          safe(function () {
            DB.settings.hideAll = !DB.settings.hideAll;
            saveData();
            hideEl.classList.toggle('on', DB.settings.hideAll);
            applyVisibility();
            toast(DB.settings.hideAll ? '入口已隐藏，可通过原生图标或 ?show_audit=true 恢复' : '入口已恢复');
          }, 'hideToggle');
        });
      }

      /* 导出 */
      var expEl = body.querySelector('#ma-export');
      if (expEl) {
        expEl.addEventListener('click', function () {
          safe(function () {
            var payload = {
              __ma_backup: true,
              exportedAt: Date.now(),
              data: DB
            };
            var str = JSON.stringify(payload, null, 2);
            var blob = new Blob([str], { type: 'application/json;charset=utf-8' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            var d = new Date();
            a.href = url;
            a.download = 'audit-backup-' +
              d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' +
              pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds()) + '.json';
            document.body.appendChild(a);
            a.click();
            setTimeout(function () {
              try {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              } catch (e) {}
            }, 200);
            toast('已导出备份');
          }, 'export');
        });
      }

      /* 导入 */
      var impEl = body.querySelector('#ma-import');
      var impFile = body.querySelector('#ma-import-file');
      if (impEl && impFile) {
        impEl.addEventListener('click', function () { impFile.click(); });
        impFile.addEventListener('change', function () {
          safe(function () {
            var f = impFile.files && impFile.files[0];
            if (!f) return;
            var fr = new FileReader();
            fr.onload = function () {
              safe(function () {
                var obj = JSON.parse(fr.result);
                var incoming = obj && obj.__ma_backup ? obj.data : obj;
                if (!incoming || typeof incoming !== 'object') {
                  toast('备份文件格式不正确');
                  return;
                }
                confirmModal({
                  title: '确认导入',
                  body: '导入将覆盖当前全部数据（字卡库 / 待审核 / 历史 / 外观），是否继续？',
                  okText: '覆盖导入',
                  danger: true,
                  onOk: function () {
                    safe(function () {
                      DB = normalizeData(incoming);
                      saveData();
                      applyAppearance();
                      applyFabPosition();
                      applyVisibility();
                      refreshAppIcon();
                      renderTabs();
                      renderPanelBody();
                      updateBadge();
                      toast('导入成功');
                    }, 'import:apply');
                  }
                });
              }, 'import:parse');
            };
            fr.onerror = function () { toast('读取文件失败'); };
            fr.readAsText(f, 'utf-8');
          }, 'import:change');
        });
      }
    }, 'bindSettingsEvents');
  }

  /* ==========================================================================
   * 通用模态框
   * ========================================================================== */
  function confirmModal(opts) {
    safe(function () {
      ensureRoot();
      var mask = document.getElementById('ma-modal-mask');
      if (!mask) {
        mask = document.createElement('div');
        mask.id = 'ma-modal-mask';
        ROOT.appendChild(mask);
      }
      var o = opts || {};
      mask.innerHTML =
        '<div class="ma-modal">' +
          '<div class="ma-modal-title">' + esc(o.title || '提示') + '</div>' +
          '<div class="ma-modal-body">' + (o.html || esc(o.body || '')) + '</div>' +
          '<div class="ma-modal-actions">' +
            '<button class="ma-btn" data-act="cancel">' + esc(o.cancelText || '取消') + '</button>' +
            '<button class="ma-btn ' + (o.danger ? 'danger' : 'primary') + '" data-act="ok">' +
              esc(o.okText || '确定') + '</button>' +
          '</div>' +
        '</div>';
      mask.classList.add('on');

      function done(isOk) {
        try { mask.classList.remove('on'); } catch (e) {}
        if (isOk && typeof o.onOk === 'function') {
          safe(o.onOk, 'confirmModal:onOk');
        } else if (!isOk && typeof o.onCancel === 'function') {
          safe(o.onCancel, 'confirmModal:onCancel');
        }
      }

      mask.onclick = function (e) {
        if (e.target === mask) { done(false); return; }
        var btn = e.target.closest ? e.target.closest('[data-act]') : null;
        if (!btn) return;
        done(btn.getAttribute('data-act') === 'ok');
      };
    }, 'confirmModal');
  }

  /* ==========================================================================
   * 模块三：图片裁剪预览器
   * ========================================================================== */
  var cropState = null;

  function openCropper(opts) {
    safe(function () {
      var fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.style.display = 'none';
      document.body.appendChild(fileInput);

      fileInput.addEventListener('change', function () {
        safe(function () {
          var f = fileInput.files && fileInput.files[0];
          if (!f) {
            try { document.body.removeChild(fileInput); } catch (e) {}
            return;
          }
          if (f.size > 12 * 1024 * 1024) {
            toast('图片过大（>12MB），请换一张');
            try { document.body.removeChild(fileInput); } catch (e) {}
            return;
          }
          var fr = new FileReader();
          fr.onload = function () {
            var img = new Image();
            img.onload = function () {
              showCropUI(img, opts);
              try { document.body.removeChild(fileInput); } catch (e) {}
            };
            img.onerror = function () {
              toast('图片解析失败');
              try { document.body.removeChild(fileInput); } catch (e) {}
            };
            img.src = fr.result;
          };
          fr.onerror = function () {
            toast('读取图片失败');
            try { document.body.removeChild(fileInput); } catch (e) {}
          };
          fr.readAsDataURL(f);
        }, 'cropper:change');
      });

      fileInput.click();
    }, 'openCropper');
  }

  function showCropUI(img, opts) {
    safe(function () {
      ensureRoot();
      var mask = document.getElementById('ma-crop-mask');
      if (!mask) {
        mask = document.createElement('div');
        mask.id = 'ma-crop-mask';
        ROOT.appendChild(mask);
      }

      var o = opts || {};
      var SIZE = Math.min(240, Math.max(180, (window.innerWidth || 375) - 100));
      var isCircle = o.shape !== 'square';
      var radius = isCircle ? '50%' : '18px';

      mask.innerHTML =
        '<div class="ma-crop-box">' +
          '<div class="ma-crop-title">' + esc(o.title || '裁剪图片') + '</div>' +
          '<div class="ma-crop-stage">' +
            '<div class="ma-crop-canvas-wrap" id="ma-crop-wrap" ' +
              'style="width:' + SIZE + 'px;height:' + SIZE + 'px;border-radius:' + radius + ';' +
              'overflow:hidden;box-shadow:0 0 0 9999px rgba(0,0,0,.32),0 0 0 1px rgba(255,255,255,.5);">' +
              '<canvas class="ma-crop-canvas" id="ma-crop-canvas"></canvas>' +
            '</div>' +
          '</div>' +
          '<div class="ma-crop-hint">拖动图片调整位置</div>' +
          '<div class="ma-crop-zoom">' +
            '<span style="font-size:12px;color:#999;white-space:nowrap;">缩放</span>' +
            '<input type="range" id="ma-crop-zoom" min="1" max="3" step="0.01" value="1">' +
          '</div>' +
          '<div class="ma-crop-actions">' +
            '<button class="ma-btn" id="ma-crop-cancel">取消</button>' +
            '<button class="ma-btn primary" id="ma-crop-ok">确认</button>' +
          '</div>' +
        '</div>';

      var canvas = mask.querySelector('#ma-crop-canvas');
      var wrap = mask.querySelector('#ma-crop-wrap');
      var zoomEl = mask.querySelector('#ma-crop-zoom');
      if (!canvas || !wrap || !zoomEl) return;

      var dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(SIZE * dpr);
      canvas.height = Math.round(SIZE * dpr);
      canvas.style.width = SIZE + 'px';
      canvas.style.height = SIZE + 'px';

      var ctx = canvas.getContext('2d');

      var st = {
        img: img,
        size: SIZE,
        dpr: dpr,
        ctx: ctx,
        baseScale: Math.max(SIZE / img.width, SIZE / img.height),
        zoom: 1,
        ox: 0,
        oy: 0
      };
      cropState = st;

      function clampOffset() {
        var s = st.baseScale * st.zoom;
        var w = st.img.width * s;
        var h = st.img.height * s;
        var mx = Math.max(0, (w - st.size) / 2);
        var my = Math.max(0, (h - st.size) / 2);
        st.ox = Math.max(-mx, Math.min(mx, st.ox));
        st.oy = Math.max(-my, Math.min(my, st.oy));
      }

      function draw() {
        safe(function () {
          clampOffset();
          var s = st.baseScale * st.zoom;
          var size = st.size;
          ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
          ctx.clearRect(0, 0, size, size);
          ctx.save();
          ctx.translate(size / 2 + st.ox, size / 2 + st.oy);
          ctx.scale(s, s);
          ctx.drawImage(st.img, -st.img.width / 2, -st.img.height / 2);
          ctx.restore();
        }, 'crop:draw');
      }

      draw();
      mask.classList.add('on');

      /* 拖拽 */
      var dragging = false, lastX = 0, lastY = 0;

      function onDown(e) {
        try {
          dragging = true;
          lastX = e.clientX;
          lastY = e.clientY;
          if (wrap.setPointerCapture && e.pointerId != null) {
            try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
          }
          e.preventDefault();
        } catch (err) {}
      }
      function onMove(e) {
        try {
          if (!dragging) return;
          st.ox += (e.clientX - lastX);
          st.oy += (e.clientY - lastY);
          lastX = e.clientX;
          lastY = e.clientY;
          draw();
          e.preventDefault();
        } catch (err) {}
      }
      function onUp() { dragging = false; }

      if (window.PointerEvent) {
        wrap.addEventListener('pointerdown', onDown);
        wrap.addEventListener('pointermove', onMove);
        wrap.addEventListener('pointerup', onUp);
        wrap.addEventListener('pointercancel', onUp);
      } else {
        wrap.addEventListener('mousedown', function (e) {
          onDown(e);
          function mm(ev) { onMove(ev); }
          function mu() {
            onUp();
            document.removeEventListener('mousemove', mm);
            document.removeEventListener('mouseup', mu);
          }
          document.addEventListener('mousemove', mm);
          document.addEventListener('mouseup', mu);
        });
        wrap.addEventListener('touchstart', function (e) {
          var t = e.touches[0];
          onDown({ clientX: t.clientX, clientY: t.clientY, preventDefault: function () { e.preventDefault(); } });
        }, { passive: false });
        wrap.addEventListener('touchmove', function (e) {
          var t = e.touches[0];
          onMove({ clientX: t.clientX, clientY: t.clientY, preventDefault: function () { e.preventDefault(); } });
        }, { passive: false });
        wrap.addEventListener('touchend', onUp);
      }

      /* 缩放 */
      zoomEl.addEventListener('input', function () {
        safe(function () {
          st.zoom = clamp(parseFloat(zoomEl.value) || 1, 1, 3);
          draw();
        }, 'crop:zoom');
      });

      /* 取消 */
      var cancelBtn = mask.querySelector('#ma-crop-cancel');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', function () {
          safe(function () {
            mask.classList.remove('on');
            cropState = null;
            if (typeof o.onCancel === 'function') o.onCancel();
          }, 'crop:cancel');
        });
      }

      /* 确认 */
      var okBtn = mask.querySelector('#ma-crop-ok');
      if (okBtn) {
        okBtn.addEventListener('click', function () {
          safe(function () {
            var OUT = 256;
            var k = OUT / st.size;
            var s = st.baseScale * st.zoom;

            var oc = document.createElement('canvas');
            oc.width = OUT;
            oc.height = OUT;
            var octx = oc.getContext('2d');
            octx.save();
            octx.translate(OUT / 2 + st.ox * k, OUT / 2 + st.oy * k);
            octx.scale(s * k, s * k);
            octx.drawImage(st.img, -st.img.width / 2, -st.img.height / 2);
            octx.restore();

            var dataURL = '';
            try {
              dataURL = oc.toDataURL('image/webp', 0.92);
              if (dataURL.indexOf('data:image/webp') !== 0) {
                dataURL = oc.toDataURL('image/png');
              }
            } catch (e) {
              try { dataURL = oc.toDataURL('image/png'); } catch (e2) { dataURL = ''; }
            }

            mask.classList.remove('on');
            cropState = null;

            if (!dataURL) {
              toast('生成图片失败，请重试');
              return;
            }
            if (typeof o.onConfirm === 'function') o.onConfirm(dataURL);
          }, 'crop:ok');
        });
      }

      /* 点击遮罩空白关闭 */
      mask.addEventListener('click', function (e) {
        if (e.target === mask) {
          safe(function () {
            mask.classList.remove('on');
            cropState = null;
          }, 'crop:maskClose');
        }
      });
    }, 'showCropUI');
  }

  /* ==========================================================================
   * 窗口尺寸变化：重算悬浮球边界
   * ========================================================================== */
  function bindResize() {
    safe(function () {
      if (window.__maResizeBound) return;
      window.__maResizeBound = true;
      window.addEventListener('resize', function () {
        safe(function () {
          if (!FAB) return;
          var size = FAB.offsetWidth || DB.settings.ballSize || 52;
          var x = parseFloat(FAB.style.left) || 0;
          var y = parseFloat(FAB.style.top) || 0;
          x = clamp(x, 4, Math.max(4, window.innerWidth - size - 4));
          y = clamp(y, 4, Math.max(4, window.innerHeight - size - 4));
          FAB.style.left = x + 'px';
          FAB.style.top = y + 'px';
        }, 'resize');
      });
    }, 'bindResize');
  }
  /* ==========================================================================
   * 第 3 部分：模块四（字卡库深度管理）+ 模块五（审批 + 历史）+ 发送按钮入口
   * ========================================================================== */

  /* --------------------------- 共用辅助 --------------------------- */
  function actionLabel(action) {
    var m = { add: '新增', delete: '删除', disable: '禁用', enable: '启用', move: '迁移' };
    return m[action] || action;
  }
  function actionClass(action) {
    var m = { add: 'add', delete: 'del', disable: 'dis', enable: 'en', move: 'mv' };
    return m[action] || '';
  }
  function arrFindIndex(arr, fn) {
    try {
      for (var i = 0; i < arr.length; i++) { if (fn(arr[i], i)) return i; }
    } catch (e) {}
    return -1;
  }
  function eachNode(container, sel, fn) {
    try {
      var nodes = container.querySelectorAll(sel);
      for (var i = 0; i < nodes.length; i++) fn(nodes[i], i);
    } catch (e) {}
  }

  /* ==========================================================================
   * 模块五：待审核面板
   * ========================================================================== */
  function renderPendingTab() {
    var pending = [];
    for (var pi = 0; pi < DB.pending.length; pi++) {
      var p0 = DB.pending[pi];
      if (p0 && p0.status === 'pending') pending.push(p0);
    }
    if (!pending.length) {
      return '<div class="ma-empty">暂无待审核记录<br><span style="font-size:11px;">梦角引擎每 30 分钟巡一次</span></div>';
    }
    pending.sort(function (a, b) { return (b.time || 0) - (a.time || 0); });

    var h = '';
    for (var i = 0; i < pending.length; i++) {
      var p = pending[i];
      h += '<div class="ma-pending-item" data-pid="' + esc(p.id) + '">';

      h += '<div class="ma-pending-top">';
      h += '<span class="ma-act-tag ' + actionClass(p.action) + '">' + esc(actionLabel(p.action)) + '</span>';
      h += '<span class="ma-sender">来自 <b>' + esc(p.sender) + '</b> · ' + esc(fmtRelative(p.time)) + '</span>';
      h += '</div>';

      h += '<div class="ma-pending-text">' + esc(p.text) + '</div>';

      if (p.note) h += '<div class="ma-pending-note">' + esc(p.note) + '</div>';

      /* -------- add：目标分类选择 -------- */
      if (p.action === 'add') {
        h += '<div class="ma-row" style="margin:4px 0 6px;">';
        h += '<span class="ma-label" style="white-space:nowrap;">存入分类：</span>';
        h += '<select class="ma-select" data-sel-group style="flex:1;min-width:100px;">';
        if (!DB.groups.length) {
          h += '<option value="">（将自动创建"默认"分类）</option>';
        } else {
          for (var gi = 0; gi < DB.groups.length; gi++) {
            var g = DB.groups[gi];
            var sel = (g.id === p.toGroupId) ? ' selected' : '';
            h += '<option value="' + esc(g.id) + '"' + sel + '>' + esc(g.name) + '</option>';
          }
        }
        h += '</select>';
        h += '</div>';
      }

      /* -------- move：显示迁移方向 -------- */
      if (p.action === 'move') {
        h += '<div style="font-size:12px;color:#888;margin:2px 0 6px;">';
        h += '迁移：<b>' + esc(p.fromGroupName || '?') + '</b> → <b>' + esc(p.toGroupName || '?') + '</b>';
        h += '</div>';
      }

      /* -------- 其余动作：显示原位置 -------- */
      if ((p.action === 'delete' || p.action === 'disable' || p.action === 'enable') && p.fromGroupName) {
        h += '<div style="font-size:12px;color:#888;margin:2px 0 6px;">';
        h += '原位置：' + esc(p.fromGroupName);
        h += '</div>';
      }

      h += '<div class="ma-pending-actions">';
      h += '<button class="ma-btn sm" data-pact="reject">拒绝</button>';
      h += '<button class="ma-btn sm primary" data-pact="approve">同意</button>';
      h += '</div>';

      h += '</div>';
    }
    return h;
  }

  function bindPendingEvents(body) {
    safe(function () {
      if (!body) return;
      eachNode(body, '.ma-pending-item', function (item) {
        var pid = item.getAttribute('data-pid');
        var p = null;
        for (var i = 0; i < DB.pending.length; i++) {
          if (DB.pending[i].id === pid) { p = DB.pending[i]; break; }
        }
        if (!p) return;

        var approveBtn = item.querySelector('[data-pact="approve"]');
        var rejectBtn = item.querySelector('[data-pact="reject"]');

        if (approveBtn) {
          approveBtn.addEventListener('click', function () {
            safe(function () {
              var sel = item.querySelector('[data-sel-group]');
              var targetGid = sel ? sel.value : '';
              var ok = approvePending(p, targetGid);
              if (ok) {
                DB.pending = DB.pending.filter(function (x) { return x.id !== p.id; });
                saveData();
                renderPanelBody();
                updateBadge();
                toast('已同意并入库');
              } else {
                toast('操作失败：目标不存在或数据异常');
              }
            }, 'pending:approve');
          });
        }

        if (rejectBtn) {
          rejectBtn.addEventListener('click', function () {
            safe(function () {
              rejectPending(p);
              DB.pending = DB.pending.filter(function (x) { return x.id !== p.id; });
              saveData();
              renderPanelBody();
              updateBadge();
              toast('已拒绝');
            }, 'pending:reject');
          });
        }
      });
    }, 'bindPendingEvents');
  }

  /* ---------- 审批执行 ---------- */
  function approvePending(p, targetGid) {
    if (!p) return false;
    var ok = false;

    if (p.action === 'add') {
      var g = targetGid ? findGroup(targetGid) : null;
      if (!g) {
        if (!DB.groups.length) {
          g = { id: uid('g'), name: '默认', disabledBy: [], cards: [] };
          DB.groups.push(g);
        } else {
          g = DB.groups[0];
        }
      }
      g.cards.push({
        id: uid('c'),
        text: p.text,
        disabledBy: [],
        createdAt: Date.now()
      });
      ok = true;

    } else if (p.action === 'delete') {
      var f1 = findCard(p.cardId);
      if (f1) {
        f1.group.cards = f1.group.cards.filter(function (x) { return x.id !== f1.card.id; });
        ok = true;
      }

    } else if (p.action === 'disable') {
      var f2 = findCard(p.cardId);
      if (f2) {
        if (f2.card.disabledBy.indexOf('mj') < 0) f2.card.disabledBy.push('mj');
        ok = true;
      }

    } else if (p.action === 'enable') {
      var f3 = findCard(p.cardId);
      if (f3) {
        f3.card.disabledBy = f3.card.disabledBy.filter(function (x) { return x !== 'mj'; });
        ok = true;
      }

    } else if (p.action === 'move') {
      var f4 = findCard(p.cardId);
      var target = findGroup(p.toGroupId);
      if (f4 && target) {
        f4.group.cards = f4.group.cards.filter(function (x) { return x.id !== f4.card.id; });
        target.cards.push(f4.card);
        ok = true;
      }
    }

    if (ok) {
      pushHistory({
        sender: p.sender,
        action: p.action,
        text: p.text,
        result: 'agree',
        extra: p.note || ''
      });
    }
    return ok;
  }

  function rejectPending(p) {
    if (!p) return false;
    pushHistory({
      sender: p.sender,
      action: p.action,
      text: p.text,
      result: 'reject',
      extra: p.note || ''
    });
    return true;
  }

  /* ==========================================================================
   * 模块五：历史档案
   * ========================================================================== */
  function renderHistoryTab() {
    if (!DB.history.length) {
      return '<div class="ma-empty">暂无历史记录</div>';
    }
    var arr = DB.history.slice().reverse();

    var h = '';
    h += '<div style="font-size:11px;color:#aaa;margin-bottom:10px;">';
    h += '最多保留 ' + HISTORY_LIMIT + ' 条，当前 ' + DB.history.length + ' 条';
    h += '</div>';

    for (var i = 0; i < arr.length; i++) {
      var it = arr[i];
      h += '<div class="ma-history-item">';
      h += '<div class="ma-history-main">';
      h += '<div class="ma-history-text">';
      h += '<span class="ma-act-tag ' + actionClass(it.action) + '" style="margin-right:6px;">' + esc(actionLabel(it.action)) + '</span>';
      h += esc(it.text);
      h += '</div>';
      h += '<div class="ma-history-meta">' + esc(it.sender) + ' · ' + esc(fmtTime(it.time)) + '</div>';
      h += '</div>';
      h += '<span class="ma-res ' + (it.result === 'agree' ? 'agree' : 'reject') + '">' +
           (it.result === 'agree' ? '已同意' : '已拒绝') + '</span>';
      h += '</div>';
    }
    return h;
  }

  function bindHistoryEvents(body) {
    /* 历史档案只读，无需绑定 */
  }

  /* ==========================================================================
   * 模块四：字卡库
   * ========================================================================== */
  var OPEN_GROUPS = null;   // null = 未初始化，初始化后默认全展开

  function ensureOpenGroupsState() {
    if (OPEN_GROUPS === null) {
      OPEN_GROUPS = {};
      for (var i = 0; i < DB.groups.length; i++) OPEN_GROUPS[DB.groups[i].id] = true;
    }
  }

  function renderCardsTab() {
    ensureOpenGroupsState();
    var h = '';

    /* ---------- 批量操作栏 ---------- */
    h += '<div class="ma-bulkbar">';
    h += '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;">';
    h += '<input type="checkbox" id="ma-sel-all"> 全选';
    h += '</label>';
    h += '<span id="ma-sel-count" style="color:#888;">已选 0 个</span>';
    h += '<button class="ma-btn sm danger" id="ma-bulk-del">批量删除</button>';
    h += '<select class="ma-select" id="ma-bulk-target" style="width:auto;flex:1;min-width:80px;">';
    h += '<option value="">转移目标…</option>';
    for (var gi = 0; gi < DB.groups.length; gi++) {
      h += '<option value="' + esc(DB.groups[gi].id) + '">' + esc(DB.groups[gi].name) + '</option>';
    }
    h += '</select>';
    h += '<button class="ma-btn sm" id="ma-bulk-move">转移</button>';
    h += '</div>';

    /* ---------- 新建分类 ---------- */
    h += '<div class="ma-row">';
    h += '<input type="text" class="ma-input" id="ma-new-group-name" placeholder="新分类名称…" maxlength="20" style="flex:1;">';
    h += '<button class="ma-btn primary" id="ma-new-group">+ 新建分类</button>';
    h += '</div>';

    /* ---------- 分类列表 ---------- */
    if (!DB.groups.length) {
      h += '<div class="ma-empty">暂无分类，先创建一个吧</div>';
      return h;
    }

    for (var i = 0; i < DB.groups.length; i++) {
      var g = DB.groups[i];
      var gDis = (g.disabledBy || []).length > 0;
      var isOpen = OPEN_GROUPS[g.id] !== false;

      h += '<div class="ma-group' + (isOpen ? ' open' : '') + '" data-gid="' + esc(g.id) + '">';

      /* 分组头 */
      h += '<div class="ma-group-head">';
      h += '<div class="ma-group-title">';
      h += '<span class="ma-arrow">▶</span>';
      h += '<span class="name">' + esc(g.name) + '</span>';
      h += '<span class="ma-group-cnt">(' + g.cards.length + ')</span>';
      if (gDis) {
        h += '<span class="ma-badge-dis user" style="font-size:10px;">分组已禁用</span>';
      }
      h += '</div>';
      h += '<div class="ma-group-tools" style="flex-wrap:wrap;justify-content:flex-end;">';
      h += '<button class="ma-btn sm" data-gact="rename" data-gid="' + esc(g.id) + '">重命名</button>';
      h += '<button class="ma-btn sm" data-gact="up" data-gid="' + esc(g.id) + '" title="上移">↑</button>';
      h += '<button class="ma-btn sm" data-gact="down" data-gid="' + esc(g.id) + '" title="下移">↓</button>';
      h += '<button class="ma-btn sm" data-gact="toggle" data-gid="' + esc(g.id) + '">' + (gDis ? '启用' : '禁用') + '</button>';
      h += '<button class="ma-btn sm danger" data-gact="delete" data-gid="' + esc(g.id) + '">删除</button>';
      h += '</div>';
      h += '</div>';

      /* 分组体 */
      h += '<div class="ma-group-body">';
      if (!g.cards.length) {
        h += '<div class="ma-empty" style="padding:18px 10px;">该分类暂无字卡</div>';
      } else {
        for (var j = 0; j < g.cards.length; j++) {
          var c = g.cards[j];
          var cDisArr = c.disabledBy || [];
          var effectiveDis = gDis || cDisArr.length > 0;

          h += '<div class="ma-card' + (effectiveDis ? ' disabled' : '') + '" data-cid="' + esc(c.id) + '">';
          h += '<input type="checkbox" class="ma-card-check" data-cid="' + esc(c.id) + '">';
          h += '<div class="ma-card-main">';
          h += '<div class="ma-card-text">' + esc(c.text) + '</div>';

          /* 状态徽标 */
          if (cDisArr.length) {
            var badgeCls, badgeTxt;
            if (cDisArr.length >= 2) { badgeCls = 'both'; badgeTxt = '双方禁用'; }
            else if (cDisArr.indexOf('user') >= 0) { badgeCls = 'user'; badgeTxt = '单方禁用·我'; }
            else { badgeCls = 'mj'; badgeTxt = '单方禁用·梦角'; }
            h += '<div class="ma-card-meta"><span class="ma-badge-dis ' + badgeCls + '">' + badgeTxt + '</span></div>';
          } else if (gDis) {
            h += '<div class="ma-card-meta"><span class="ma-badge-dis user" style="font-size:10px;">随分组禁用</span></div>';
          }
          h += '</div>';

          /* 卡片操作 */
          h += '<div class="ma-card-ops">';
          h += '<button class="ma-btn sm" data-cact="edit" data-cid="' + esc(c.id) + '">编辑</button>';
          h += '<button class="ma-btn sm" data-cact="send" data-cid="' + esc(c.id) + '">发送</button>';
          h += '<button class="ma-btn sm" data-cact="toggle" data-cid="' + esc(c.id) + '">' + (cDisArr.length ? '启用' : '禁用') + '</button>';
          h += '<button class="ma-btn sm danger" data-cact="delete" data-cid="' + esc(c.id) + '">删除</button>';
          h += '</div>';
          h += '</div>';
        }
      }
      h += '</div></div>';
    }

    return h;
  }

  function bindCardsEvents(body) {
    safe(function () {
      if (!body) return;

      /* ---------- 新建分类 ---------- */
      var newBtn = body.querySelector('#ma-new-group');
      var newInput = body.querySelector('#ma-new-group-name');
      if (newBtn && newInput) {
        newBtn.addEventListener('click', function () {
          safe(function () {
            var name = String(newInput.value || '').trim();
            if (!name) { toast('请输入分类名称'); return; }
            DB.groups.push({ id: uid('g'), name: name, disabledBy: [], cards: [] });
            if (OPEN_GROUPS) OPEN_GROUPS[DB.groups[DB.groups.length - 1].id] = true;
            saveData();
            renderPanelBody();
            toast('已创建分类');
          }, 'newGroup');
        });
        newInput.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { try { newBtn.click(); } catch (err) {} }
        });
      }

      /* ---------- 分组操作按钮 ---------- */
      eachNode(body, '[data-gact]', function (btn) {
        btn.addEventListener('click', function (e) {
          try { e.stopPropagation(); } catch (err) {}
          var act = btn.getAttribute('data-gact');
          var gid = btn.getAttribute('data-gid');
          safe(function () { handleGroupAction(act, gid); }, 'groupAction:' + act);
        });
      });

      /* ---------- 分组展开/折叠 ---------- */
      eachNode(body, '.ma-group-head', function (head) {
        head.addEventListener('click', function (e) {
          try {
            if (e.target.closest && e.target.closest('[data-gact]')) return;
            var grp = head.parentNode;
            var gid = grp.getAttribute('data-gid');
            var isOpen = grp.classList.toggle('open');
            if (OPEN_GROUPS) OPEN_GROUPS[gid] = isOpen;
          } catch (err) {}
        });
      });

      /* ---------- 单卡操作 ---------- */
      eachNode(body, '[data-cact]', function (btn) {
        btn.addEventListener('click', function (e) {
          try { e.stopPropagation(); } catch (err) {}
          var act = btn.getAttribute('data-cact');
          var cid = btn.getAttribute('data-cid');
          safe(function () { handleCardAction(act, cid); }, 'cardAction:' + act);
        });
      });

      /* ---------- 全选 ---------- */
      function updateBulkCount() {
        var n = 0, total = 0;
        eachNode(body, '.ma-card-check', function (cb) {
          total++;
          if (cb.checked) n++;
        });
        var el = body.querySelector('#ma-sel-count');
        if (el) el.textContent = '已选 ' + n + ' 个';
        var all = body.querySelector('#ma-sel-all');
        if (all) all.checked = (n > 0 && n === total);
      }

      var selAll = body.querySelector('#ma-sel-all');
      if (selAll) {
        selAll.addEventListener('change', function () {
          var checked = selAll.checked;
          eachNode(body, '.ma-card-check', function (cb) { cb.checked = checked; });
          updateBulkCount();
        });
      }
      eachNode(body, '.ma-card-check', function (cb) {
        cb.addEventListener('change', updateBulkCount);
      });

      /* ---------- 批量删除 ---------- */
      var bulkDel = body.querySelector('#ma-bulk-del');
      if (bulkDel) {
        bulkDel.addEventListener('click', function () {
          safe(function () {
            var cids = [];
            eachNode(body, '.ma-card-check', function (cb) {
              if (cb.checked) cids.push(cb.getAttribute('data-cid'));
            });
            if (!cids.length) { toast('请先勾选字卡'); return; }
            confirmModal({
              title: '批量删除',
              body: '确定删除选中的 ' + cids.length + ' 张字卡？此操作不可撤销。',
              danger: true,
              okText: '删除',
              onOk: function () {
                safe(function () {
                  for (var i = 0; i < cids.length; i++) {
                    var f = findCard(cids[i]);
                    if (f) {
                      f.group.cards = f.group.cards.filter(function (x) { return x.id !== f.card.id; });
                    }
                  }
                  saveData();
                  renderPanelBody();
                  toast('已删除 ' + cids.length + ' 张');
                }, 'bulkDel:apply');
              }
            });
          }, 'bulkDel');
        });
      }

      /* ---------- 批量转移 ---------- */
      var bulkMove = body.querySelector('#ma-bulk-move');
      var bulkTarget = body.querySelector('#ma-bulk-target');
      if (bulkMove && bulkTarget) {
        bulkMove.addEventListener('click', function () {
          safe(function () {
            var tid = bulkTarget.value;
            if (!tid) { toast('请选择目标分类'); return; }
            var target = findGroup(tid);
            if (!target) { toast('目标分类不存在'); return; }
            var cids = [];
            eachNode(body, '.ma-card-check', function (cb) {
              if (cb.checked) cids.push(cb.getAttribute('data-cid'));
            });
            if (!cids.length) { toast('请先勾选字卡'); return; }

            var moved = 0;
            for (var i = 0; i < cids.length; i++) {
              var f = findCard(cids[i]);
              if (f && f.group.id !== tid) {
                f.group.cards = f.group.cards.filter(function (x) { return x.id !== f.card.id; });
                target.cards.push(f.card);
                moved++;
              }
            }
            saveData();
            renderPanelBody();
            toast(moved ? ('已转移 ' + moved + ' 张') : '没有需要转移的字卡');
          }, 'bulkMove');
        });
      }
    }, 'bindCardsEvents');
  }

  /* ---------- 分组操作执行 ---------- */
  function handleGroupAction(act, gid) {
    var g = findGroup(gid);
    if (!g) return;

    /* 重命名 */
    if (act === 'rename') {
      confirmModal({
        title: '重命名分类',
        html: '<input type="text" class="ma-input" id="ma-rename-input" maxlength="20" value="' + esc(g.name) + '">',
        okText: '保存',
        onOk: function () {
          safe(function () {
            var inp = document.getElementById('ma-rename-input');
            if (!inp) return;
            var v = String(inp.value || '').trim();
            if (!v) { toast('名称不能为空'); return; }
            g.name = v;
            saveData();
            renderPanelBody();
            toast('已重命名');
          }, 'rename:apply');
        }
      });
      setTimeout(function () {
        try {
          var i = document.getElementById('ma-rename-input');
          if (i) { i.focus(); i.select(); }
        } catch (e) {}
      }, 50);
      return;
    }

    /* 上移 / 下移 */
    if (act === 'up' || act === 'down') {
      var idx = arrFindIndex(DB.groups, function (x) { return x.id === gid; });
      if (idx < 0) return;
      var target = act === 'up' ? idx - 1 : idx + 1;
      if (target < 0 || target >= DB.groups.length) return;
      var tmp = DB.groups[idx];
      DB.groups[idx] = DB.groups[target];
      DB.groups[target] = tmp;
      saveData();
      renderPanelBody();
      return;
    }

    /* 禁用 / 启用（对分组） */
    if (act === 'toggle') {
      if ((g.disabledBy || []).indexOf('user') >= 0) {
        g.disabledBy = g.disabledBy.filter(function (x) { return x !== 'user'; });
      } else {
        if (!Array.isArray(g.disabledBy)) g.disabledBy = [];
        g.disabledBy.push('user');
      }
      saveData();
      renderPanelBody();
      return;
    }

    /* 删除分类 */
    if (act === 'delete') {
      /* 空分类直接删 */
      if (!g.cards.length) {
        DB.groups = DB.groups.filter(function (x) { return x.id !== gid; });
        if (OPEN_GROUPS) delete OPEN_GROUPS[gid];
        saveData();
        renderPanelBody();
        toast('已删除分类');
        return;
      }

      /* 非空分类：必须选择迁移目标（用户要求） */
      var others = [];
      for (var oi = 0; oi < DB.groups.length; oi++) {
        if (DB.groups[oi].id !== gid) others.push(DB.groups[oi]);
      }
      if (!others.length) {
        confirmModal({
          title: '无法删除',
          body: '这是唯一的分类，且含 ' + g.cards.length + ' 张字卡。请先创建另一个分类再删除。',
          okText: '知道了'
        });
        return;
      }

      var opts = '';
      for (var oi2 = 0; oi2 < others.length; oi2++) {
        opts += '<option value="' + esc(others[oi2].id) + '">' + esc(others[oi2].name) + '</option>';
      }

      confirmModal({
        title: '删除分类',
        html:
          '<div style="line-height:1.6;">分类「<b>' + esc(g.name) + '</b>」有 <b>' + g.cards.length + '</b> 张字卡。<br>' +
          '请选择将这些字卡<b>全部转移到</b>：</div>' +
          '<select class="ma-select" id="ma-del-target" style="margin-top:10px;">' + opts + '</select>',
        okText: '迁移并删除',
        danger: true,
        onOk: function () {
          safe(function () {
            var sel = document.getElementById('ma-del-target');
            var tid = sel ? sel.value : '';
            var target = findGroup(tid);
            if (!target) { toast('目标分类不存在'); return; }
            var movedCount = g.cards.length;
            for (var i = 0; i < g.cards.length; i++) {
              target.cards.push(g.cards[i]);
            }
            DB.groups = DB.groups.filter(function (x) { return x.id !== gid; });
            if (OPEN_GROUPS) delete OPEN_GROUPS[gid];
            saveData();
            renderPanelBody();
            toast('已迁移 ' + movedCount + ' 张字卡并删除分类');
          }, 'deleteGroup:apply');
        }
      });
      return;
    }
  }

  /* ---------- 单卡操作执行 ---------- */
  function handleCardAction(act, cid) {
    var f = findCard(cid);
    if (!f) return;
    var card = f.card;

    /* 编辑 */
    if (act === 'edit') {
      confirmModal({
        title: '编辑字卡',
        html: '<textarea class="ma-textarea" id="ma-edit-input" maxlength="500">' + esc(card.text) + '</textarea>',
        okText: '保存',
        onOk: function () {
          safe(function () {
            var inp = document.getElementById('ma-edit-input');
            if (!inp) return;
            var v = String(inp.value || '').trim();
            if (!v) { toast('内容不能为空'); return; }
            card.text = v;
            saveData();
            renderPanelBody();
            toast('已保存');
          }, 'editCard:apply');
        }
      });
      setTimeout(function () {
        try {
          var i = document.getElementById('ma-edit-input');
          if (i) { i.focus(); }
        } catch (e) {}
      }, 50);
      return;
    }

    /* 发送 */
    if (act === 'send') {
      safe(function () { sendCardToChat(cid); }, 'sendCard:' + cid);
      return;
    }

    /* 禁用 / 启用（只操作 'user'） */
    if (act === 'toggle') {
      if (!Array.isArray(card.disabledBy)) card.disabledBy = [];
      if (card.disabledBy.indexOf('user') >= 0) {
        card.disabledBy = card.disabledBy.filter(function (x) { return x !== 'user'; });
      } else {
        card.disabledBy.push('user');
      }
      saveData();
      renderPanelBody();
      return;
    }

    /* 删除 */
    if (act === 'delete') {
      confirmModal({
        title: '删除字卡',
        body: '确定删除这张字卡？此操作不可撤销。',
        danger: true,
        okText: '删除',
        onOk: function () {
          safe(function () {
            f.group.cards = f.group.cards.filter(function (x) { return x.id !== cid; });
            saveData();
            renderPanelBody();
            toast('已删除');
          }, 'deleteCard:apply');
        }
      });
      return;
    }
  }

  /* ==========================================================================
   * 模块六（基础版）：点击【发送】→ 写入 chat-msgs → 尝试无刷新渲染
   * 说明：本函数在第 4 部分会做"无刷新渲染"的增强版封装，但这里先提供完整可用的基础实现。
   * ========================================================================== */
  function sendCardToChat(cid) {
    safe(function () {
      var f = findCard(cid);
      if (!f) { toast('字卡不存在'); return; }
      var text = f.card.text;
      if (!text) { toast('字卡内容为空'); return; }

      /* 1. 写入 localStorage */
      var msgs = readChatMsgs();
      msgs.push({ side: 'in', text: text, time: Date.now() });
      if (!writeChatMsgs(msgs)) { toast('发送失败，无法写入'); return; }

      /* 2. 优先调用原站框架渲染 */
      var rendered = false;
      try {
        if (typeof window.loadMsgs === 'function') {
          window.loadMsgs();
          rendered = true;
        }
      } catch (e1) {}
      try {
        if (typeof window.renderWindow === 'function') {
          window.renderWindow();
          rendered = true;
        }
      } catch (e2) {}

      /* 3. 兜底 DOM 插入 */
      if (!rendered) {
        try {
          var chatBody = document.querySelector('#chat-body');
          if (chatBody) {
            var bubble = document.createElement('div');
            bubble.className = 'msg in ma-injected-msg';
            bubble.setAttribute('data-ma-injected', '1');
            bubble.textContent = text;
            bubble.style.cssText =
              'max-width:75%;padding:8px 12px;margin:6px 0 6px auto;' +
              'background:#ff6b81;color:#fff;border-radius:14px;word-break:break-all;' +
              'font-size:14px;width:fit-content;width:-webkit-fit-content;' +
              'box-sizing:border-box;';
            chatBody.appendChild(bubble);
            try { chatBody.scrollTop = chatBody.scrollHeight; } catch (e) {}
            rendered = true;
          }
        } catch (e3) {}
      }

      if (rendered) {
        toast('已发送');
      } else {
        toast('消息已保存，刷新页面后可见');
      }
    }, 'sendCardToChat');
  }
  /* ==========================================================================
   * 第 4 部分：初始化引导 + 生命周期守护 + 收尾
   * ========================================================================== */

  /* --------------------------- URL 参数解析 --------------------------- */
  function parseUrlForceShow() {
    return safe(function () {
      var search = (window.location && window.location.search) || '';
      if (!search) return false;

      if (typeof URLSearchParams !== 'undefined') {
        try {
          var params = new URLSearchParams(search);
          var v = params.get('show_audit');
          if (v === 'true' || v === '1') return true;
          if (v === 'false' || v === '0') return false;
        } catch (e) { /* ignore */ }
      }
      return /[?&]show_audit=(true|1)(?:&|$)/i.test(search);
    }, 'parseUrlForceShow', false);
  }

  /* --------------------------- DOM ready 兼容 --------------------------- */
  function onReady(fn) {
    safe(function () {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
          safe(fn, 'ready:cb');
        }, { once: true });
      } else {
        // 已加载完成，异步调度，避免阻塞原页面
        setTimeout(function () { safe(fn, 'ready:cb'); }, 0);
      }
    }, 'onReady');
  }

  /* --------------------------- 生命周期守护 --------------------------- */
  /* 原网站若发生整页重渲染（SPA 常见），我们的 root 可能被移除。
   * 这里以 3 秒频率轻量巡检，发现丢失则重建入口与面板骨架。
   * 注意：只在 root 被移除时重建，不会打断用户正在进行的操作。
   */
  var guardTimer = null;

  function startGuard() {
    safe(function () {
      if (guardTimer) return;
      guardTimer = setInterval(function () {
        safe(function () {
          if (!document.body) return;

          /* 1. root 丢失 → 全量重建入口 */
          if (!ROOT || !document.body.contains(ROOT)) {
            ROOT = null;
            FAB = null;
            MASK = null;
            PANEL = null;
            PANEL_OPEN = false;

            safe(function () { buildFab(); }, 'guard:buildFab');
            safe(function () { buildUI(); }, 'guard:buildUI');
            safe(function () { applyAppearance(); }, 'guard:appearance');
            safe(function () { applyFabPosition(); }, 'guard:pos');
            safe(function () { applyVisibility(); }, 'guard:vis');
            safe(function () { updateBadge(); }, 'guard:badge');
          }

          /* 2. 克隆图标丢失 → 重新克隆注入 */
          if (!APP_ICON_EL || !document.body.contains(APP_ICON_EL)) {
            APP_ICON_EL = null;
            APP_ICON_IMG_EL = null;
            safe(function () { injectAppIcon(); }, 'guard:appIcon');
            safe(function () { applyAppearance(); }, 'guard:appIconAppearance');
            safe(function () { applyVisibility(); }, 'guard:appIconVis');
            safe(function () { updateBadge(); }, 'guard:appIconBadge');
          }
        }, 'guard:tick');
      }, 3000);
    }, 'startGuard');
  }

  /* --------------------------- 主启动流程 --------------------------- */
  function bootstrap() {
    /* 1. 解析 URL（?show_audit=true 强制唤醒） */
    URL_FORCE_SHOW = parseUrlForceShow();

    /* 2. 数据层装载（loadData 内部已 try/catch + 结构校验） */
    DB = loadData();

    /* 3. 样式注入（最早注入，避免闪烁） */
    injectCSS();

    /* 4. 根容器 */
    ensureRoot();

    /* 5. 双入口 UI */
    buildFab();          // 悬浮球（第 2 部分）
    buildUI();           // 面板骨架 + 裁剪器容器 + 模态容器 + toast（第 2 部分）

    /* 6. 外观 & 位置 & 可见性 */
    applyAppearance();   // 颜色 / 大小 / 图片
    applyFabPosition();  // 悬浮球位置
    applyVisibility();   // hideAll 逻辑（内置 URL_FORCE_SHOW 豁免）
    updateBadge();       // 静默红点

    /* 7. 窗口 resize 监听 */
    bindResize();

    /* 8. 原生 App 图标克隆注入（带轮询，等待原页面异步渲染完成） */
    startAppIconWatcher();

    /* 9. 梦角引擎启动（首跑 + 30 分钟周期） */
    startEngine();

    /* 10. 生命周期守护 */
    startGuard();

    /* 11. URL 强制唤醒的可见反馈（静默 toast，不 alert） */
    if (URL_FORCE_SHOW) {
      safe(function () {
        if (FAB) FAB.classList.remove('ma-hidden');
        if (APP_ICON_EL) APP_ICON_EL.classList.remove('ma-hidden');
        toast('已通过 ?show_audit=true 强制唤醒审核入口');
      }, 'forceShow:toast');
    }

    /* 12. 调试接口（可选） */
    safe(function () {
      window.__MY_AUDIT_READY__ = true;
    }, 'readyFlag');
  }

  /* --------------------------- 启动调度（多级兜底） --------------------------- */
  try {
    onReady(function () {
      try {
        bootstrap();
      } catch (bootErr) {
        /* 一级兜底：bootstrap 失败时，至少把样式和根容器注入，绝不白屏 */
        try { console.warn('[审计] bootstrap 失败：', bootErr); } catch (e1) {}
        try { injectCSS(); } catch (e2) {}
        try { ensureRoot(); } catch (e3) {}
        try { toast('审核外挂初始化异常，已降级为静默模式'); } catch (e4) {}
      }
    });
  } catch (schedErr) {
    /* 二级兜底：连 onReady 都失败（极端环境），只尝试注入样式 */
    try { console.warn('[审计] onReady 失败：', schedErr); } catch (e1) {}
    try { injectCSS(); } catch (e2) {}
  }

  /* --------------------------- 卸载清理（供调试使用） --------------------------- */
  try {
    window.__MY_AUDIT_UNMOUNT__ = function () {
      safe(function () {
        if (guardTimer) { clearInterval(guardTimer); guardTimer = null; }
        if (appIconInjectTimer) { clearInterval(appIconInjectTimer); appIconInjectTimer = null; }
        if (ROOT && ROOT.parentNode) {
          try { ROOT.parentNode.removeChild(ROOT); } catch (e) {}
        }
        if (APP_ICON_EL && APP_ICON_EL.parentNode) {
          try { APP_ICON_EL.parentNode.removeChild(APP_ICON_EL); } catch (e) {}
        }
        var style = document.getElementById('ma-style');
        if (style && style.parentNode) {
          try { style.parentNode.removeChild(style); } catch (e) {}
        }
        window.__MY_AUDIT_LOADED__ = false;
        window.__MY_AUDIT_READY__ = false;
      }, 'unmount');
    };
  } catch (e) { /* ignore */ }

})();
