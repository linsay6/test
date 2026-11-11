/* ============================================================================
 * my-new-feature.js 极限性能版 (最终版)
 * ========================================================================== */
(function () {
  'use strict';

  try { if (window.__MY_AUDIT_LOADED__) return; window.__MY_AUDIT_LOADED__ = true; } catch (e) {}

  var LS_KEY_CHAT = 'xy-home-v2:default:chat-msgs';
  var LS_KEY_DATA = 'my-audit-cards';
  var DATA_VERSION = 1;
  var ENGINE_INTERVAL = 30 * 60 * 1000;
  var RECENT_MS = 15 * 60 * 1000;
  var MIN_LEN = 5, MAX_LEN = 35, MAX_AUTO_PENDING = 5, MAX_GRAB_PER_TICK = 2;
  var MISCHIEF_RATE = 0.02, HISTORY_LIMIT = 100;
  var EMO_WORDS = ['喜欢', '爱', '想你', '开心'];
  var SENDER_MJ = '梦角', SENDER_ME = '我', Z_BASE = 2147483000;

  var DB = null, ROOT = null, FAB = null, MASK = null, PANEL = null;
  var CURRENT_TAB = 'pending', PANEL_OPEN = false, URL_FORCE_SHOW = false;
  var APP_ICON_EL = null, APP_ICON_IMG_EL = null, ORIGINAL_APP_HTML = null;
  var OPEN_GROUPS = null;
  var INJECTED_MSGS = []; 

  function safe(fn, name, def) { try { return fn(); } catch (err) { try { console.warn('[审计] ' + (name || 'task') + ' 出错：', err); } catch (e2) {} return def; } }
  function uid(prefix) { return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
  function esc(str) { try { return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); } catch (e) { return ''; } }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtTime(ts) { try { var d = new Date(Number(ts) || Date.now()); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); } catch (e) { return ''; } }
  function fmtRelative(ts) { try { var diff = Date.now() - Number(ts || 0); if (diff < 60000) return '刚刚'; if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'; if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前'; return fmtTime(ts); } catch (e) { return ''; } }
  function clamp(n, a, b) { n = Number(n); if (isNaN(n)) n = a; return Math.min(b, Math.max(a, n)); }
  function isEmotional(text) { try { for (var i = 0; i < EMO_WORDS.length; i++) if (String(text).indexOf(EMO_WORDS[i]) >= 0) return true; } catch (e) {} return false; }
  function arrFindIndex(arr, fn) { try { for (var i = 0; i < arr.length; i++) if (fn(arr[i], i)) return i; } catch (e) {} return -1; }
  function eachNode(c, sel, fn) { try { var ns = c.querySelectorAll(sel); for (var i = 0; i < ns.length; i++) fn(ns[i], i); } catch (e) {} }

  /* --- 数据防覆盖底层拦截 --- */
  (function hookLocalStorage() {
    try {
      var originalSetItem = localStorage.setItem;
      localStorage.setItem = function (key, value) {
        if (key === LS_KEY_CHAT && INJECTED_MSGS.length > 0 && typeof value === 'string') {
          try {
            var lastMsg = INJECTED_MSGS[INJECTED_MSGS.length - 1];
            if (value.indexOf(lastMsg.text) === -1) {
              var msgs = JSON.parse(value);
              if (Array.isArray(msgs)) {
                for (var i = 0; i < INJECTED_MSGS.length; i++) {
                  var im = INJECTED_MSGS[i];
                  var exists = msgs.some(function (m) { return m.text === im.text && m.time === im.time; });
                  if (!exists) msgs.push(im);
                }
                value = JSON.stringify(msgs);
              }
            }
          } catch (e) {}
        }
        originalSetItem.call(localStorage, key, value);
      };
    } catch (e) {}
  })();

  function defaultSettings() { return { ballColor: '#ff6b81', ballSize: 52, ballImage: '', appImage: '', appName: '审核', appColor: '#333333', hideAll: false, ballPos: null }; }
  function defaultData() { return { version: DATA_VERSION, groups: [], pending: [], history: [], settings: defaultSettings(), meta: { lastGrabAt: 0, grabbedKeys: [], lastMischiefAt: 0, isGrabbing: false } }; }
  function normalizeData(d) {
    var def = defaultData(); if (!d || typeof d !== 'object' || Array.isArray(d)) d = def;
    if (!Array.isArray(d.groups)) d.groups = [];
    if (d.groups.length === 0) d.groups.push({ id: uid('g'), name: '默认分组', disabledBy: [], cards: [] });
    for (var gi = 0; gi < d.groups.length; gi++) {
      var g = d.groups[gi]; if (!g || typeof g !== 'object') { d.groups.splice(gi, 1); gi--; continue; }
      if (!g.id) g.id = uid('g'); if (typeof g.name !== 'string') g.name = '未命名'; if (!Array.isArray(g.disabledBy)) g.disabledBy = []; if (!Array.isArray(g.cards)) g.cards = [];
      for (var ci = 0; ci < g.cards.length; ci++) {
        var c = g.cards[ci]; if (!c || typeof c !== 'object') { g.cards.splice(ci, 1); ci--; continue; }
        if (!c.id) c.id = uid('c'); if (typeof c.text !== 'string') c.text = ''; if (!Array.isArray(c.disabledBy)) c.disabledBy = []; if (typeof c.createdAt !== 'number') c.createdAt = Date.now();
      }
    }
    if (!Array.isArray(d.pending)) d.pending = [];
    for (var pi = 0; pi < d.pending.length; pi++) { var p = d.pending[pi]; if (!p || typeof p !== 'object') { d.pending.splice(pi, 1); pi--; continue; } if (!p.id) p.id = uid('p'); if (!p.status) p.status = 'pending'; if (typeof p.time !== 'number') p.time = Date.now(); if (!p.sender) p.sender = SENDER_MJ; }
    if (!Array.isArray(d.history)) d.history = []; if (d.history.length > HISTORY_LIMIT) d.history = d.history.slice(-HISTORY_LIMIT);
    if (!d.settings || typeof d.settings !== 'object') d.settings = defaultSettings();
    var s = d.settings, ds = defaultSettings();
    if (typeof s.ballColor !== 'string' || !s.ballColor) s.ballColor = ds.ballColor; if (typeof s.ballSize !== 'number' || !isFinite(s.ballSize)) s.ballSize = ds.ballSize; s.ballSize = clamp(s.ballSize, 36, 88);
    if (typeof s.ballImage !== 'string') s.ballImage = ''; if (typeof s.appImage !== 'string') s.appImage = ''; 
    if (typeof s.appName !== 'string' || !s.appName) s.appName = ds.appName;
    if (typeof s.appColor !== 'string' || !s.appColor) s.appColor = ds.appColor;
    if (typeof s.hideAll !== 'boolean') s.hideAll = false;
    if (!s.ballPos || typeof s.ballPos !== 'object' || typeof s.ballPos.x !== 'number' || typeof s.ballPos.y !== 'number') s.ballPos = null;
    if (!d.meta || typeof d.meta !== 'object') d.meta = def.meta; if (typeof d.meta.lastGrabAt !== 'number') d.meta.lastGrabAt = 0; if (typeof d.meta.lastMischiefAt !== 'number') d.meta.lastMischiefAt = 0; if (!Array.isArray(d.meta.grabbedKeys)) d.meta.grabbedKeys = []; if (d.meta.grabbedKeys.length > 400) d.meta.grabbedKeys = d.meta.grabbedKeys.slice(-400); if (typeof d.meta.isGrabbing !== 'boolean') d.meta.isGrabbing = false;
    return d;
  }
  function loadData() { return safe(function () { var raw = localStorage.getItem(LS_KEY_DATA); if (!raw) return defaultData(); return normalizeData(JSON.parse(raw)); }, 'loadData', defaultData()); }
  function saveData() { return safe(function () { localStorage.setItem(LS_KEY_DATA, JSON.stringify(DB)); return true; }, 'saveData', false); }
  function readChatMsgs() { return safe(function () { var raw = localStorage.getItem(LS_KEY_CHAT); if (!raw) return []; var arr = JSON.parse(raw); return Array.isArray(arr) ? arr : []; }, 'readChatMsgs', []); }
  function findGroup(gid) { try { for (var i = 0; i < DB.groups.length; i++) if (DB.groups[i].id === gid) return DB.groups[i]; } catch (e) {} return null; }
  function findCard(cid) { try { for (var i = 0; i < DB.groups.length; i++) { var g = DB.groups[i]; for (var j = 0; j < g.cards.length; j++) if (g.cards[j].id === cid) return { group: g, card: g.cards[j] }; } } catch (e) {} return null; }
  function pushHistory(rec) { safe(function () { DB.history.push({ id: uid('h'), sender: rec.sender || SENDER_MJ, action: rec.action || 'add', text: rec.text || '', result: rec.result || 'agree', time: Date.now(), extra: rec.extra || '' }); if (DB.history.length > HISTORY_LIMIT) DB.history = DB.history.slice(-HISTORY_LIMIT); saveData(); }, 'pushHistory'); }

  function injectBubbleToChat(text) {
    try {
      var now = Date.now();
      var newMsg = { side: 'in', text: text, time: now };
      INJECTED_MSGS.push(newMsg); if (INJECTED_MSGS.length > 50) INJECTED_MSGS.shift();

      var msgs = readChatMsgs(); msgs.push(newMsg); 
      localStorage.setItem(LS_KEY_CHAT, JSON.stringify(msgs));
      
      var chatBody = document.getElementById('chat-body');
      if (!chatBody) return true;

      var blackList = ['语音', '通话', '红包', '领取', '撤回', '礼物', '转账', '词典', '连发', '情绪', '心意', '意图'];
      var templateNode = null;
      var children = Array.from(chatBody.children);

      for (var i = children.length - 1; i >= 0; i--) {
        var el = children[i], cls = (el.className || '').toLowerCase();
        if (cls.indexOf('out') >= 0 || cls.indexOf('me') >= 0 || cls.indexOf('right') >= 0) continue;
        var txt = el.textContent || '';
        var isBlack = false;
        for (var b = 0; b < blackList.length; b++) { if (txt.indexOf(blackList[b]) >= 0) { isBlack = true; break; } }
        if (isBlack) continue; 
        if (el.querySelector('.app-name, .icon, img, svg') && txt.trim().length < 5) continue;
        templateNode = el; break;
      }

      var bubbleEl;
      if (templateNode) {
          bubbleEl = templateNode.cloneNode(true);
          if (bubbleEl.id) bubbleEl.removeAttribute('id');
          var nodesWithId = bubbleEl.querySelectorAll('[id]'); for (var k = 0; k < nodesWithId.length; k++) nodesWithId[k].removeAttribute('id');
          if (bubbleEl.classList) { bubbleEl.classList.remove('msg-out', 'me', 'right', 'self'); bubbleEl.classList.add('msg-in', 'left'); }
          bubbleEl.style.alignSelf = 'flex-start'; bubbleEl.style.marginLeft = '0'; bubbleEl.style.marginRight = 'auto';
          var walker = document.createTreeWalker(bubbleEl, NodeFilter.SHOW_TEXT, null, false), maxLen = 0, targetTextNode = null, tn;
          while ((tn = walker.nextNode())) { var len = tn.nodeValue.trim().length; if (len > maxLen) { maxLen = len; targetTextNode = tn; } }
          if (targetTextNode) targetTextNode.nodeValue = text; else bubbleEl.innerText = text;
      } else {
          bubbleEl = document.createElement('div');
          bubbleEl.className = 'msg in left';
          bubbleEl.style.cssText = 'display:flex; margin: 10px 15px; align-self: flex-start; clear: both;';
          var inner = document.createElement('div');
          inner.style.cssText = 'max-width: 75%; padding: 10px 14px; border-radius: 14px; background: #fff; color: #333; font-size: 14px; word-break: break-all; box-shadow: 0 1px 2px rgba(0,0,0,0.05); line-height: 1.4;';
          inner.textContent = text;
          bubbleEl.appendChild(inner);
      }
      
      bubbleEl.setAttribute('data-ma-injected', '1');
      chatBody.appendChild(bubbleEl);
      try { chatBody.scrollTop = chatBody.scrollHeight; window.scrollTo(0, document.body.scrollHeight); } catch (e) {}
      return true;
    } catch (err) { return false; }
  }

  function checkAndRepairChat() {
    var chatBody = document.getElementById('chat-body');
    if (!chatBody || INJECTED_MSGS.length === 0) return;
    var injectedNodes = chatBody.querySelectorAll('[data-ma-injected="1"]');
    if (injectedNodes.length === INJECTED_MSGS.length) return;
    
    for (var i = 0; i < injectedNodes.length; i++) injectedNodes[i].remove();
    var blackList = ['语音', '通话', '红包', '领取', '撤回', '礼物', '转账', '词典', '连发', '情绪', '心意', '意图'];
    var templateNode = null;
    var children = Array.from(chatBody.children);
    for (var i = children.length - 1; i >= 0; i--) {
      var el = children[i], cls = (el.className || '').toLowerCase();
      if (cls.indexOf('out') >= 0 || cls.indexOf('me') >= 0 || cls.indexOf('right') >= 0) continue;
      var txt = el.textContent || '';
      var isBlack = false;
      for (var b = 0; b < blackList.length; b++) { if (txt.indexOf(blackList[b]) >= 0) { isBlack = true; break; } }
      if (isBlack) continue; 
      if (el.querySelector('.app-name, .icon, img, svg') && txt.trim().length < 5) continue;
      templateNode = el; break;
    }

    for (var m = 0; m < INJECTED_MSGS.length; m++) {
        var msg = INJECTED_MSGS[m];
        var bubbleEl;
        if (templateNode) {
            bubbleEl = templateNode.cloneNode(true);
            if (bubbleEl.id) bubbleEl.removeAttribute('id');
            var nodesWithId = bubbleEl.querySelectorAll('[id]'); for (var k = 0; k < nodesWithId.length; k++) nodesWithId[k].removeAttribute('id');
            if (bubbleEl.classList) { bubbleEl.classList.remove('msg-out', 'me', 'right', 'self'); bubbleEl.classList.add('msg-in', 'left'); }
            bubbleEl.style.alignSelf = 'flex-start'; bubbleEl.style.marginLeft = '0'; bubbleEl.style.marginRight = 'auto';
            var walker = document.createTreeWalker(bubbleEl, NodeFilter.SHOW_TEXT, null, false), maxLen = 0, targetTextNode = null, tn;
            while ((tn = walker.nextNode())) { var len = tn.nodeValue.trim().length; if (len > maxLen) { maxLen = len; targetTextNode = tn; } }
            if (targetTextNode) targetTextNode.nodeValue = msg.text; else bubbleEl.innerText = msg.text;
        } else {
            bubbleEl = document.createElement('div');
            bubbleEl.className = 'msg in left';
            bubbleEl.style.cssText = 'display:flex; margin: 10px 15px; align-self: flex-start; clear: both;';
            var inner = document.createElement('div');
            inner.style.cssText = 'max-width: 75%; padding: 10px 14px; border-radius: 14px; background: #fff; color: #333; font-size: 14px; word-break: break-all; box-shadow: 0 1px 2px rgba(0,0,0,0.05); line-height: 1.4;';
            inner.textContent = msg.text;
            bubbleEl.appendChild(inner);
        }
        bubbleEl.setAttribute('data-ma-injected', '1');
        chatBody.appendChild(bubbleEl);
    }
    try { chatBody.scrollTop = chatBody.scrollHeight; } catch (e) {}
  }

  function autoPendingCount() { var n = 0; try { for (var i = 0; i < DB.pending.length; i++) { var p = DB.pending[i]; if (p.status === 'pending' && p.sender === SENDER_MJ && p.action === 'add') n++; } } catch (e) {} return n; }
  function pendingCount() { var n = 0; try { for (var i = 0; i < DB.pending.length; i++) if (DB.pending[i].status === 'pending') n++; } catch (e) {} return n; }
  
  function grabFromChat() {
    safe(function () {
      if (!DB || DB.meta.isGrabbing) return;
      if (autoPendingCount() >= MAX_AUTO_PENDING) return;
      DB.meta.isGrabbing = true;
      try {
        var msgs = readChatMsgs(), now = Date.now(), cands = [];
        for (var i = 0; i < msgs.length; i++) {
          var m = msgs[i]; if (!m || typeof m !== 'object' || m.side !== 'out' || typeof m.text !== 'string') continue;
          var t = m.text.trim(), len = t.length; if (len < MIN_LEN || len > MAX_LEN) continue;
          var tm = Number(m.time) || 0; if (!tm || now - tm > RECENT_MS || now - tm < -60000) continue;
          var key = t + '@@' + tm; if (DB.meta.grabbedKeys.indexOf(key) >= 0) continue;
          cands.push({ text: t, time: tm, key: key });
        }
        if (!cands.length) return; 
        cands.sort(function () { return Math.random() - 0.5; });
        var added = 0;
        for (var j = 0; j < cands.length; j++) {
          if (added >= MAX_GRAB_PER_TICK || autoPendingCount() + added >= MAX_AUTO_PENDING) break;
          var c = cands[j], emo = isEmotional(c.text), pass = emo ? (Math.random() > 0.7) : (Math.random() > 0.95);
          DB.meta.grabbedKeys.push(c.key); if (!pass) continue;
          DB.pending.push({ id: uid('p'), action: 'add', text: c.text, cardId: '', fromGroupId: '', fromGroupName: '', toGroupId: '', toGroupName: '', sender: SENDER_MJ, auto: true, emo: emo, time: Date.now(), status: 'pending', note: emo ? '含情感词' : '常规抓取' });
          added++;
        }
        if (DB.meta.grabbedKeys.length > 400) DB.meta.grabbedKeys = DB.meta.grabbedKeys.slice(-400);
        DB.meta.lastGrabAt = Date.now();
      } finally {
        DB.meta.isGrabbing = false;
      }
    }, 'grabFromChat');
  }
  
  function maybeMischief() {
    safe(function () {
      if (!DB || Math.random() > MISCHIEF_RATE) return;
      var pool = []; for (var i = 0; i < DB.groups.length; i++) { var g = DB.groups[i]; for (var j = 0; j < g.cards.length; j++) pool.push({ group: g, card: g.cards[j] }); }
      if (!pool.length) return; var pick = pool[Math.floor(Math.random() * pool.length)], group = pick.group, card = pick.card;
      var groupDisabled = (group.disabledBy || []).length > 0, cardDisabled = (card.disabledBy || []).length > 0, isDisabled = groupDisabled || cardDisabled;
      var actions = isDisabled ? ['enable', 'delete', 'move'] : ['disable', 'delete', 'move'], action = actions[Math.floor(Math.random() * actions.length)], toGroupId = '', toGroupName = '';
      if (action === 'move') {
        var others = []; for (var k = 0; k < DB.groups.length; k++) if (DB.groups[k].id !== group.id) others.push(DB.groups[k]);
        if (!others.length) action = isDisabled ? 'enable' : 'disable'; else { var tgt = others[Math.floor(Math.random() * others.length)]; toGroupId = tgt.id; toGroupName = tgt.name; }
      }
      DB.pending.push({ id: uid('p'), action: action, text: card.text, cardId: card.id, fromGroupId: group.id, fromGroupName: group.name, toGroupId: toGroupId, toGroupName: toGroupName, sender: SENDER_MJ, auto: true, time: Date.now(), status: 'pending', note: '随机整理申请' });
      DB.meta.lastMischiefAt = Date.now();
    }, 'maybeMischief');
  }
  
  function autoSendCard() {
    safe(function () {
      if (!DB || !DB.groups) return; var validCards = [];
      try { for (var i = 0; i < DB.groups.length; i++) { var g = DB.groups[i]; if (g.disabledBy && g.disabledBy.length > 0) continue; for (var j = 0; j < g.cards.length; j++) { var c = g.cards[j]; if (c.disabledBy && c.disabledBy.length > 0) continue; if (c.text && c.text.trim()) validCards.push(c.text.trim()); } } } catch (e) { return; }
      if (validCards.length === 0) return; var randomText = validCards[Math.floor(Math.random() * validCards.length)];
      var ok = injectBubbleToChat(randomText); if (ok) console.log('[审计] 梦角自动发送成功：', randomText);
    }, 'autoSendCard');
  }
  
  function tickEngine() { safe(function () { grabFromChat(); maybeMischief(); autoSendCard(); saveData(); updateBadge(); if (PANEL_OPEN && CURRENT_TAB === 'pending') renderPanelBody(); }, 'tickEngine'); }
  function startEngine() { safe(function () { var now = Date.now(); if (!DB.meta.lastGrabAt || (now - DB.meta.lastGrabAt) > ENGINE_INTERVAL) tickEngine(); else { maybeMischief(); saveData(); updateBadge(); } setInterval(function () { safe(tickEngine, 'tickEngine:interval'); }, ENGINE_INTERVAL); }, 'startEngine'); }

  function injectCSS() {
    safe(function () {
      if (document.getElementById('ma-style')) return;
      var css = [
        '#ma-root{position:static;margin:0;padding:0;}','#ma-root,#ma-root *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}',
        '#ma-fab{position:fixed;z-index:' + (Z_BASE + 10) + ';display:flex;align-items:center;justify-content:center;border-radius:50%;color:#fff;font-size:13px;font-weight:700;cursor:pointer;user-select:none;background-color:#ff6b81;background-size:cover;background-position:center;box-shadow:none;border:none;touch-action:none;}',
        '#ma-fab:active{transform:scale(.94);}','#ma-fab.ma-hidden{display:none!important;}',
        '#ma-fab .ma-fab-dot{position:absolute;top:-2px;right:-2px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:#ff2d55;display:none;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700;border:1px solid #fff;}','#ma-fab .ma-fab-dot.on{display:flex;}','#ma-fab.ma-has-img .ma-fab-txt{display:none;}',
        
        '#ma-app-icon{position:relative;cursor:pointer;}',
        '#ma-app-icon .ma-app-dot{position:absolute;top:-6px;right:-6px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;background:#fff;display:none;align-items:center;justify-content:center;color:#333;font-size:11px;font-weight:600;border:1px solid #e0e0e0;box-shadow:0 1px 3px rgba(0,0,0,0.15);z-index:10;box-sizing:border-box;transform:scale(0.95);}',
        '#ma-app-icon .ma-app-dot.on{display:flex;}',
        
        '#ma-mask{position:fixed;left:0;top:0;right:0;bottom:0;z-index:' + (Z_BASE + 100) + ';background:rgba(0,0,0,.42);display:none;align-items:center;justify-content:center;}','#ma-mask.on{display:flex;}',
        '#ma-panel{width:min(560px,94vw);max-height:86vh;display:flex;flex-direction:column;background:#fff;border-radius:16px;overflow:hidden;font-size:14px;color:#222;box-shadow:0 12px 40px rgba(0,0,0,.22);}',
        '.ma-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #f0f0f0;background:#fafafa;flex-shrink:0;}',
        '.ma-title{font-size:16px;font-weight:700;}','.ma-close{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;color:#999;cursor:pointer;}',
        '.ma-tabs{display:flex;border-bottom:1px solid #eee;background:#fff;overflow-x:auto;flex-shrink:0;}',
        '.ma-tab{flex:1 0 auto;padding:10px 12px;text-align:center;cursor:pointer;font-size:13px;color:#666;white-space:nowrap;border-bottom:2px solid transparent;}','.ma-tab.on{color:#ff4d6d;border-bottom-color:#ff4d6d;font-weight:600;}','.ma-tab-badge{display:inline-block;min-width:16px;height:16px;line-height:16px;padding:0 4px;border-radius:8px;background:#ff2d55;color:#fff;font-size:10px;margin-left:4px;font-weight:600;vertical-align:middle;}',
        '.ma-body{flex:1;overflow-y:auto;padding:12px 14px 20px;}','.ma-btn{display:inline-flex;align-items:center;justify-content:center;padding:6px 14px;border-radius:8px;border:1px solid #ddd;background:#fff;color:#333;font-size:13px;cursor:pointer;white-space:nowrap;}','.ma-btn.primary{background:#ff4d6d;border-color:#ff4d6d;color:#fff;}','.ma-btn.danger{background:#fff;border-color:#ffb3c0;color:#e0355a;}','.ma-btn.sm{padding:3px 9px;font-size:12px;}',
        '.ma-input,.ma-select,.ma-textarea{width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:8px;font-size:13px;outline:none;}','.ma-row{display:flex;align-items:center;gap:8px;margin-bottom:10px;}','.ma-empty{text-align:center;color:#bbb;padding:40px 10px;font-size:13px;}',
        '.ma-pending-item{border:1px solid #f0f0f0;border-radius:12px;padding:10px 12px;margin-bottom:10px;}','.ma-pending-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;}','.ma-act-tag{display:inline-block;padding:1px 8px;border-radius:6px;font-size:11px;font-weight:600;background:#eef4ff;color:#2b6cff;}','.ma-act-tag.add{background:#e9f9ef;color:#12a150;}','.ma-act-tag.del{background:#ffeef1;color:#e0355a;}',
        '.ma-group{border:1px solid #eee;border-radius:12px;margin-bottom:10px;overflow:hidden;}','.ma-group-head{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:#fafafa;cursor:pointer;}','.ma-group-title{display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px;}','.ma-group-body{display:none;padding:8px 10px;}','.ma-group.open .ma-group-body{display:block;}',
        '.ma-card{display:flex;align-items:flex-start;gap:8px;padding:7px 8px;border-radius:8px;}','.ma-card-check{margin-top:3px;}','.ma-card-main{flex:1;min-width:0;}','.ma-card-text{font-size:13px;}','.ma-card.disabled .ma-card-text{color:#b5b5b5;text-decoration:line-through;}','.ma-card-ops{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;}','.ma-badge-dis{display:inline-block;padding:0 6px;border-radius:5px;font-size:10px;line-height:16px;font-weight:600;}','.ma-badge-dis.user{background:#ffeef1;color:#e0355a;}','.ma-badge-dis.mj{background:#f0edff;color:#6c4cf0;}','.ma-badge-dis.both{background:#3a3a3a;color:#fff;}',
        '.ma-bulkbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;background:#fafafa;border-radius:10px;margin-bottom:10px;font-size:12px;color:#666;}',
        '.ma-set-block{border:1px solid #eee;border-radius:12px;padding:12px;margin-bottom:12px;}','.ma-thumb{width:52px;height:52px;border-radius:50%;background:#f0f0f0 center/cover no-repeat;}','.ma-thumb.square{border-radius:14px;}',
        '.ma-switch{position:relative;width:44px;height:24px;border-radius:12px;background:#ddd;cursor:pointer;}','.ma-switch.on{background:#ff4d6d;}','.ma-switch::after{content:"";position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:.2s;}','.ma-switch.on::after{left:22px;}',
        '#ma-crop-mask{position:fixed;left:0;top:0;right:0;bottom:0;z-index:' + (Z_BASE + 200) + ';background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;}','#ma-crop-mask.on{display:flex;}','.ma-crop-box{width:min(340px,92vw);background:#fff;border-radius:16px;overflow:hidden;}','.ma-crop-stage{padding:18px 0;display:flex;justify-content:center;background:#f7f7f8;}',
        '#ma-modal-mask{position:fixed;left:0;top:0;right:0;bottom:0;z-index:' + (Z_BASE + 300) + ';background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;}','#ma-modal-mask.on{display:flex;}','.ma-modal{width:min(360px,90vw);background:#fff;border-radius:14px;overflow:hidden;}','.ma-modal-title{padding:14px 16px 6px;font-size:15px;font-weight:700;}','.ma-modal-body{padding:6px 16px 14px;font-size:13px;color:#555;}','.ma-modal-actions{display:flex;gap:10px;padding:0 16px 16px;}','.ma-modal-actions .ma-btn{flex:1;}',
        '#ma-toast{position:fixed;left:50%;bottom:80px;transform:translateX(-50%);z-index:' + (Z_BASE + 400) + ';background:rgba(0,0,0,.8);color:#fff;padding:8px 18px;border-radius:20px;font-size:13px;opacity:0;transition:.25s;pointer-events:none;}','#ma-toast.on{opacity:1;}'
      ].join('\n');
      var style = document.createElement('style'); style.id = 'ma-style'; style.appendChild(document.createTextNode(css)); (document.head || document.documentElement).appendChild(style);
    }, 'injectCSS');
  }

  function ensureRoot() { if (ROOT && document.body && document.body.contains(ROOT)) return ROOT; ROOT = document.createElement('div'); ROOT.id = 'ma-root'; (document.body || document.documentElement).appendChild(ROOT); return ROOT; }
  function toast(msg, ms) { safe(function () { ensureRoot(); var el = document.getElementById('ma-toast'); if (!el) { el = document.createElement('div'); el.id = 'ma-toast'; ROOT.appendChild(el); } el.textContent = String(msg == null ? '' : msg); el.classList.add('on'); clearTimeout(el.__maTimer); el.__maTimer = setTimeout(function () { el.classList.remove('on'); }, ms || 1800); }, 'toast'); }
  
  function buildFab() {
    safe(function () {
      ensureRoot(); var old = document.getElementById('ma-fab'); if (old && old.parentNode) old.parentNode.removeChild(old);
      FAB = document.createElement('div'); FAB.id = 'ma-fab'; FAB.innerHTML = '<span class="ma-fab-txt">审</span><i class="ma-fab-dot"></i>'; ROOT.appendChild(FAB);
      applyFabPosition(); bindFabDrag();
      FAB.addEventListener('click', function (e) { if (FAB.__maMoved) { FAB.__maMoved = false; return; } try { e.stopPropagation(); } catch (err) {} openPanel(); });
    }, 'buildFab');
  }
  function applyFabPosition() {
    safe(function () {
      if (!FAB) return; var s = DB.settings, size = s.ballSize || 52, w = window.innerWidth, h = window.innerHeight, x, y;
      if (s.ballPos && typeof s.ballPos.x === 'number') { x = clamp(s.ballPos.x, 4, Math.max(4, w - size - 4)); y = clamp(s.ballPos.y, 4, Math.max(4, h - size - 4)); }
      else { x = w - size - 18; y = h - size - 96; }
      FAB.style.left = x + 'px'; FAB.style.top = y + 'px'; FAB.style.width = size + 'px'; FAB.style.height = size + 'px';
    }, 'applyFabPosition');
  }
  function bindFabDrag() {
    safe(function () {
      if (!FAB || FAB.__maDragBound) return; FAB.__maDragBound = true;
      var dragging = false, startX = 0, startY = 0, originX = 0, originY = 0, rafId = null;
      
      function onDown(e) { 
        dragging = true; FAB.__maMoved = false; 
        var r = FAB.getBoundingClientRect(); 
        startX = e.clientX; startY = e.clientY; originX = r.left; originY = r.top; 
        FAB.style.transition = 'none'; 
        e.preventDefault(); 
      }
      
      function onMove(e) { 
        if (!dragging) return; 
        var dx = e.clientX - startX, dy = e.clientY - startY; 
        if (!FAB.__maMoved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) FAB.__maMoved = true; 
        if (!FAB.__maMoved) return; 
        
        if (rafId) return; // RAF 节流，绝不卡顿
        rafId = requestAnimationFrame(function() {
            var size = FAB.offsetWidth || 52, w = window.innerWidth, h = window.innerHeight; 
            FAB.style.left = clamp(originX + dx, 4, Math.max(4, w - size - 4)) + 'px'; 
            FAB.style.top = clamp(originY + dy, 4, Math.max(4, h - size - 4)) + 'px'; 
            rafId = null;
        });
        e.preventDefault(); 
      }
      
      function onUp(e) { 
        if (!dragging) return; 
        dragging = false; FAB.style.transition = ''; 
        if (FAB.__maMoved) { 
          var size = FAB.offsetWidth || 52; 
          DB.settings.ballPos = { x: clamp(parseFloat(FAB.style.left), 4, Math.max(4, window.innerWidth - size - 4)), y: clamp(parseFloat(FAB.style.top), 4, Math.max(4, window.innerHeight - size - 4)) }; 
          saveData(); 
        } 
      }
      
      if (window.PointerEvent) { FAB.addEventListener('pointerdown', onDown); FAB.addEventListener('pointermove', onMove); FAB.addEventListener('pointerup', onUp); }
    }, 'bindFabDrag');
  }

  function injectAppIcon() {
    return safe(function () {
      if (APP_ICON_EL && document.body.contains(APP_ICON_EL)) return true;
      var natives = document.querySelectorAll('.app:not([data-ma-clone])'); if (!natives.length) return false;
      var src = natives[0];
      var clone = null; try { clone = src.cloneNode(true); } catch (e) { return false; }
      if (clone.id) clone.removeAttribute('id');
      var ids = clone.querySelectorAll('[id]'); for (var k = 0; k < ids.length; k++) ids[k].removeAttribute('id');
      
      // 保存一份最原始的干净HTML，用于“移除自定义图标”时恢复
      if (!ORIGINAL_APP_HTML) {
          ORIGINAL_APP_HTML = clone.innerHTML;
      }
      
      clone.removeAttribute('style'); var styled = clone.querySelectorAll('[style]'); for (var si = 0; si < styled.length; si++) styled[si].removeAttribute('style');
      try { var walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT, null, false); var textNodes = [], tn; while ((tn = walker.nextNode())) textNodes.push(tn); for (var ti = 0; ti < textNodes.length; ti++) textNodes[ti].nodeValue = ''; } catch (e6) {}
      
      var innerIcon = clone.querySelector('.app-icon,.icon,img,svg,[class*="icon"]');
      var innerName = clone.querySelector('.app-name,.app-title,.app-label,.name,.title,.label,[class*="name"],[class*="label"],[class*="title"]');
      
      if (innerIcon) {
          APP_ICON_IMG_EL = innerIcon;
      } else {
          APP_ICON_IMG_EL = document.createElement('div');
          APP_ICON_IMG_EL.className = 'ma-custom-icon-wrap';
          APP_ICON_IMG_EL.style.cssText = 'width:36px;height:36px;margin:0 auto 4px;border-radius:10px;background-color:#f5f5f5;background-size:cover;background-position:center;';
          clone.insertBefore(APP_ICON_IMG_EL, clone.firstChild);
      }

      if (innerName) {
          innerName.setAttribute('data-ma-name', '1');
      } else {
          var span = document.createElement('div'); span.setAttribute('data-ma-name', '1');
          clone.appendChild(span);
      }

      var dot = document.createElement('i'); dot.className = 'ma-app-dot'; clone.appendChild(dot);
      clone.id = 'ma-app-icon'; clone.setAttribute('data-ma-clone', '1');
      
      var grid = document.querySelector('.app-grid'); if (grid) grid.appendChild(clone);
      APP_ICON_EL = clone;
      clone.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); openPanel(); });
      
      applyAppearance(); updateBadge(); return true;
    }, 'injectAppIcon', false);
  }

  /* 极速自适应监听，一旦DOM有插入，立刻用RAF渲染 */
  function startAppIconObserver() {
    safe(function () {
      if (window.__maAppIconObserver) return;
      if (injectAppIcon()) return;

      window.__maAppIconObserver = new MutationObserver(function () {
        if (APP_ICON_EL && document.body.contains(APP_ICON_EL)) return;
        requestAnimationFrame(function() {
            var grid = document.querySelector('.app-grid');
            if (grid) injectAppIcon();
        });
      });
      
      window.__maAppIconObserver.observe(document.body, { childList: true, subtree: true });
    }, 'startAppIconObserver');
  }

  function applyVisibility() {
    safe(function () {
      var hide = !!(DB.settings.hideAll && !URL_FORCE_SHOW);
      if (FAB) { if (hide) FAB.classList.add('ma-hidden'); else FAB.classList.remove('ma-hidden'); }
      if (APP_ICON_EL) { APP_ICON_EL.classList.remove('ma-hidden'); }
      bindNativeHijack(hide);
    }, 'applyVisibility');
  }
  function bindNativeHijack(on) {
    safe(function () {
      var natives = document.querySelectorAll('.app:not([data-ma-clone])');
      for (var i = 0; i < natives.length; i++) {
        var el = natives[i];
        if (on) {
          if (!el.__maHijack) {
            el.__maHijack = function (e) { try { if (!DB.settings.hideAll) return; e.preventDefault(); e.stopPropagation(); openPanel(); } catch (err) {} };
            el.addEventListener('click', el.__maHijack, true);
          }
        } else if (el.__maHijack) { try { el.removeEventListener('click', el.__maHijack, true); } catch (e2) {} el.__maHijack = null; }
      }
    }, 'bindNativeHijack');
  }

  function applyAppearance() {
    safe(function () {
      var s = DB.settings;
      if (FAB) {
        var size = clamp(s.ballSize || 52, 36, 88); FAB.style.width = size + 'px'; FAB.style.height = size + 'px'; FAB.style.fontSize = Math.max(11, Math.round(size * 0.30)) + 'px';
        if (s.ballImage) { FAB.style.backgroundImage = 'url("' + s.ballImage + '")'; FAB.style.backgroundColor = 'transparent'; FAB.classList.add('ma-has-img'); }
        else { FAB.style.backgroundImage = ''; FAB.style.backgroundColor = s.ballColor || '#ff6b81'; FAB.classList.remove('ma-has-img'); }
      }
      
      if (APP_ICON_EL) {
        var nameEl = APP_ICON_EL.querySelector('[data-ma-name]');
        if (nameEl) {
            nameEl.textContent = s.appName || '审核';
            nameEl.style.cssText = 'font-size:12px;line-height:1.4;text-align:center;width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:' + (s.appColor || '#333333') + ';';
        }
        
        var holder = APP_ICON_IMG_EL;
        if (holder) {
            if (s.appImage) {
                if (holder.tagName === 'IMG') holder.src = s.appImage;
                else {
                    holder.style.backgroundImage = 'url("' + s.appImage + '")';
                    holder.style.backgroundSize = 'cover';
                    holder.style.backgroundPosition = 'center';
                }
            } else {
                // 移除图片时，恢复原始原貌
                if (holder.tagName === 'IMG') {
                    var origImg = APP_ICON_EL.querySelector('img');
                    if (origImg && origImg !== holder) origImg.removeAttribute('src');
                    holder.removeAttribute('src'); 
                } else if (holder.tagName !== 'SVG') {
                    holder.style.backgroundImage = 'none';
                }
                if (ORIGINAL_APP_HTML && APP_ICON_EL) {
                    // 如果有原始备份且需要恢复，可以重新把内容塞回去（视原网页结构而定）
                    // 这里为了极简，不强求全部 innerHTML 重置，依靠CSS清理已经够了
                }
            }
        }
      }
    }, 'applyAppearance');
  }
  
  function updateBadge() { 
    safe(function () { 
      var n = pendingCount(); 
      var f = FAB ? FAB.querySelector('.ma-fab-dot') : null; 
      if (f) { if (n > 0) { f.textContent = n > 99 ? '99+' : n; f.classList.add('on'); } else { f.textContent = ''; f.classList.remove('on'); } }
      var a = APP_ICON_EL ? APP_ICON_EL.querySelector('.ma-app-dot') : null; 
      if (a) { 
        if (n > 0) { a.textContent = n > 99 ? '99+' : n; a.classList.add('on'); } 
        else { a.textContent = ''; a.classList.remove('on'); a.style.display = 'none'; } 
      } 
      var t = PANEL ? PANEL.querySelector('.ma-tab[data-tab="pending"] .ma-tab-badge') : null; 
      if (t) { t.textContent = n > 99 ? '99+' : String(n); t.style.display = n > 0 ? 'inline-block' : 'none'; } 
    }, 'updateBadge'); 
  }

  var TAB_DEF = [{ key: 'pending', label: '待审核' }, { key: 'cards', label: '字卡库' }, { key: 'history', label: '历史档案' }, { key: 'settings', label: '设置' }];
  function buildUI() {
    safe(function () {
      ensureRoot(); var oldMask = document.getElementById('ma-mask'); if (oldMask && oldMask.parentNode) oldMask.parentNode.removeChild(oldMask);
      MASK = document.createElement('div'); MASK.id = 'ma-mask'; PANEL = document.createElement('div'); PANEL.id = 'ma-panel';
      var tabHtml = ''; for (var i = 0; i < TAB_DEF.length; i++) { var t = TAB_DEF[i]; tabHtml += '<div class="ma-tab' + (t.key === CURRENT_TAB ? ' on' : '') + '" data-tab="' + t.key + '">' + t.label + (t.key === 'pending' ? '<span class="ma-tab-badge" style="display:none;">0</span>' : '') + '</div>'; }
      PANEL.innerHTML = '<div class="ma-header"><div class="ma-title">审核中心</div><div class="ma-close" id="ma-close">×</div></div><div class="ma-tabs" id="ma-tabs">' + tabHtml + '</div><div class="ma-body" id="ma-body"></div>';
      MASK.appendChild(PANEL); ROOT.appendChild(MASK);
      var cb = PANEL.querySelector('#ma-close'); if (cb) cb.addEventListener('click', closePanel);
      MASK.addEventListener('click', function (e) { if (e.target === MASK) closePanel(); });
      var tb = PANEL.querySelector('#ma-tabs'); if (tb) tb.addEventListener('click', function (e) { var el = e.target; while (el && el !== tb && !el.getAttribute('data-tab')) el = el.parentNode; if (!el || el === tb) return; CURRENT_TAB = el.getAttribute('data-tab'); renderTabs(); renderPanelBody(); });
      if (!document.getElementById('ma-crop-mask')) { var cm = document.createElement('div'); cm.id = 'ma-crop-mask'; ROOT.appendChild(cm); }
      if (!document.getElementById('ma-modal-mask')) { var mm = document.createElement('div'); mm.id = 'ma-modal-mask'; ROOT.appendChild(mm); }
      if (!document.getElementById('ma-toast')) { var tt = document.createElement('div'); tt.id = 'ma-toast'; ROOT.appendChild(tt); }
    }, 'buildUI');
  }
  function renderTabs() { safe(function () { if (!PANEL) return; var ts = PANEL.querySelectorAll('.ma-tab'); for (var i = 0; i < ts.length; i++) { if (ts[i].getAttribute('data-tab') === CURRENT_TAB) ts[i].classList.add('on'); else ts[i].classList.remove('on'); } updateBadge(); }, 'renderTabs'); }
  function openPanel() { safe(function () { ensureRoot(); if (!MASK) buildUI(); if (!MASK) return; MASK.classList.add('on'); PANEL_OPEN = true; renderTabs(); renderPanelBody(); updateBadge(); }, 'openPanel'); }
  function closePanel() { safe(function () { if (MASK) MASK.classList.remove('on'); PANEL_OPEN = false; }, 'closePanel'); }
  
  function renderPanelBody() {
    safe(function () {
      if (!PANEL) return; var body = PANEL.querySelector('#ma-body'); if (!body) return; var html = '';
      if (CURRENT_TAB === 'pending') html = renderPendingTab(); else if (CURRENT_TAB === 'cards') html = renderCardsTab(); else if (CURRENT_TAB === 'history') html = renderHistoryTab(); else html = renderSettingsTab();
      body.innerHTML = html || '';
      if (CURRENT_TAB === 'pending') bindPendingEvents(body); else if (CURRENT_TAB === 'cards') bindCardsEvents(body); else if (CURRENT_TAB === 'settings') bindSettingsEvents(body);
    }, 'renderPanelBody');
  }

  function renderPendingTab() {
    var pending = []; for (var pi = 0; pi < DB.pending.length; pi++) if (DB.pending[pi].status === 'pending') pending.push(DB.pending[pi]);
    if (!pending.length) return '<div class="ma-empty">暂无待审核记录</div>';
    pending.sort(function (a, b) { return (b.time || 0) - (a.time || 0); });
    
    var h = '';
    h += '<div class="ma-bulkbar" style="margin-bottom:10px;">';
    h += '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" id="ma-pending-all"> 全选</label>';
    h += '<span id="ma-pending-count" style="color:#888;">已选 0 个</span>';
    h += '<button class="ma-btn sm" id="ma-pending-reject-checked" style="color:#e0355a; border-color:#ffb3c0;">勾选拒绝</button>';
    h += '<button class="ma-btn sm primary" id="ma-pending-approve-checked">勾选同意</button>';
    h += '<div style="flex:1;"></div>';
    h += '<button class="ma-btn sm" id="ma-pending-reject-all" style="color:#e0355a;">全部拒绝</button>';
    h += '<button class="ma-btn sm primary" id="ma-pending-approve-all">全部同意</button>';
    h += '</div>';

    var actM = { add: '新增', delete: '删除', disable: '禁用', enable: '启用', move: '迁移' }, clsM = { add: 'add', delete: 'del', disable: 'dis', enable: 'en', move: 'mv' };
    for (var i = 0; i < pending.length; i++) {
      var p = pending[i];
      h += '<div class="ma-pending-item" data-pid="' + esc(p.id) + '">';
      h += '<div class="ma-pending-top"><div style="display:flex;align-items:center;gap:8px;"><input type="checkbox" class="ma-pending-check" data-pid="' + esc(p.id) + '"><span class="ma-act-tag ' + (clsM[p.action] || '') + '">' + (actM[p.action] || p.action) + '</span></div><span class="ma-sender">来自 <b>' + esc(p.sender) + '</b> · ' + esc(fmtRelative(p.time)) + '</span></div>';
      h += '<div class="ma-pending-text">' + esc(p.text) + '</div>';
      if (p.note) h += '<div class="ma-pending-note" style="font-size:11px;color:#aaa;margin-bottom:8px;">' + esc(p.note) + '</div>';
      if (p.action === 'add') {
        h += '<div class="ma-row" style="margin:4px 0 6px;"><span class="ma-label">存入分类：</span><select class="ma-select" data-sel-group style="flex:1;">';
        if (!DB.groups.length) h += '<option value="">(自动创建默认分类)</option>';
        else for (var gi = 0; gi < DB.groups.length; gi++) h += '<option value="' + esc(DB.groups[gi].id) + '"' + (DB.groups[gi].id === p.toGroupId ? ' selected' : '') + '>' + esc(DB.groups[gi].name) + '</option>';
        h += '</select></div>';
      }
      if (p.action === 'move') h += '<div style="font-size:12px;color:#888;margin:2px 0 6px;">迁移：<b>' + esc(p.fromGroupName) + '</b> → <b>' + esc(p.toGroupName) + '</b></div>';
      h += '<div class="ma-pending-actions" style="display:flex;justify-content:flex-end;gap:8px;"><button class="ma-btn sm" data-pact="reject">拒绝</button><button class="ma-btn sm primary" data-pact="approve">同意</button></div></div>';
    }
    return h;
  }
  
  function bindPendingEvents(body) {
    safe(function () {
      var checkboxes = body.querySelectorAll('.ma-pending-check');
      var countEl = body.querySelector('#ma-pending-count');
      var allCb = body.querySelector('#ma-pending-all');

      function updatePendingCount() {
        var n = 0, total = checkboxes.length;
        for (var i = 0; i < total; i++) { if (checkboxes[i].checked) n++; }
        if (countEl) countEl.textContent = '已选 ' + n + ' 个';
        if (allCb) allCb.checked = (n > 0 && n === total);
      }

      if (allCb) allCb.addEventListener('change', function () { for (var i = 0; i < checkboxes.length; i++) checkboxes[i].checked = allCb.checked; updatePendingCount(); });
      for (var i = 0; i < checkboxes.length; i++) checkboxes[i].addEventListener('change', updatePendingCount);

      var btnAppChecked = body.querySelector('#ma-pending-approve-checked');
      if (btnAppChecked) btnAppChecked.addEventListener('click', function () { safe(function () {
          var cbs = body.querySelectorAll('.ma-pending-check:checked'); if (!cbs.length) { toast('请先勾选'); return; }
          var cnt = 0;
          for (var i = 0; i < cbs.length; i++) {
              var pid = cbs[i].getAttribute('data-pid'), p = null;
              for (var k = 0; k < DB.pending.length; k++) if (DB.pending[k].id === pid) { p = DB.pending[k]; break; }
              if (!p) continue;
              var itemNode = cbs[i].closest('.ma-pending-item');
              var sel = itemNode ? itemNode.querySelector('[data-sel-group]') : null;
              var targetGid = sel ? sel.value : (DB.groups.length > 0 ? DB.groups[0].id : '');
              if (approvePending(p, targetGid)) { DB.pending = DB.pending.filter(function (x) { return x.id !== pid; }); cnt++; }
          }
          saveData(); renderPanelBody(); updateBadge(); toast('已同意 ' + cnt + ' 条');
      }, 'bulkApproveChecked'); });

      var btnRejChecked = body.querySelector('#ma-pending-reject-checked');
      if (btnRejChecked) btnRejChecked.addEventListener('click', function () { safe(function () {
          var cbs = body.querySelectorAll('.ma-pending-check:checked'); if (!cbs.length) { toast('请先勾选'); return; }
          var cnt = 0;
          for (var i = 0; i < cbs.length; i++) {
              var pid = cbs[i].getAttribute('data-pid'), p = null;
              for (var k = 0; k < DB.pending.length; k++) if (DB.pending[k].id === pid) { p = DB.pending[k]; break; }
              if (!p) continue;
              rejectPending(p); DB.pending = DB.pending.filter(function (x) { return x.id !== pid; }); cnt++;
          }
          saveData(); renderPanelBody(); updateBadge(); toast('已拒绝 ' + cnt + ' 条');
      }, 'bulkRejectChecked'); });

      var btnAppAll = body.querySelector('#ma-pending-approve-all');
      if (btnAppAll) btnAppAll.addEventListener('click', function () { safe(function () {
          var cnt = 0; var list = DB.pending.slice();
          for (var i = 0; i < list.length; i++) { var p = list[i]; if (p.status !== 'pending') continue; var targetGid = DB.groups.length > 0 ? DB.groups[0].id : ''; if (approvePending(p, targetGid)) cnt++; DB.pending = DB.pending.filter(function (x) { return x.id !== p.id; }); }
          saveData(); renderPanelBody(); updateBadge(); toast('已批量同意 ' + cnt + ' 条');
      }, 'bulkApproveAll'); });

      var btnRejAll = body.querySelector('#ma-pending-reject-all');
      if (btnRejAll) btnRejAll.addEventListener('click', function () { safe(function () {
          var cnt = 0; var list = DB.pending.slice();
          for (var i = 0; i < list.length; i++) { var p = list[i]; if (p.status !== 'pending') continue; rejectPending(p); DB.pending = DB.pending.filter(function (x) { return x.id !== p.id; }); cnt++; }
          saveData(); renderPanelBody(); updateBadge(); toast('已批量拒绝 ' + cnt + ' 条');
      }, 'bulkRejectAll'); });

      eachNode(body, '.ma-pending-item', function (item) {
        var pid = item.getAttribute('data-pid'), p = null; for (var i = 0; i < DB.pending.length; i++) if (DB.pending[i].id === pid) { p = DB.pending[i]; break; } if (!p) return;
        var ab = item.querySelector('[data-pact="approve"]'), rb = item.querySelector('[data-pact="reject"]');
        if (ab) ab.addEventListener('click', function () { safe(function () { var sel = item.querySelector('[data-sel-group]'); if (approvePending(p, sel ? sel.value : '')) { DB.pending = DB.pending.filter(function (x) { return x.id !== p.id; }); saveData(); renderPanelBody(); updateBadge(); toast('已同意并入库'); } else toast('操作失败'); }, 'approve'); });
        if (rb) rb.addEventListener('click', function () { safe(function () { rejectPending(p); DB.pending = DB.pending.filter(function (x) { return x.id !== p.id; }); saveData(); renderPanelBody(); updateBadge(); toast('已拒绝'); }, 'reject'); });
      });
    }, 'bindPendingEvents');
  }
  
  function approvePending(p, targetGid) {
    if (!p) return false; var ok = false;
    if (p.action === 'add') { var g = targetGid ? findGroup(targetGid) : null; if (!g) { if (!DB.groups.length) { g = { id: uid('g'), name: '默认', disabledBy: [], cards: [] }; DB.groups.push(g); } else g = DB.groups[0]; } g.cards.push({ id: uid('c'), text: p.text, disabledBy: [], createdAt: Date.now() }); ok = true; }
    else if (p.action === 'delete') { var f1 = findCard(p.cardId); if (f1) { f1.group.cards = f1.group.cards.filter(function (x) { return x.id !== f1.card.id; }); ok = true; } }
    else if (p.action === 'disable') { var f2 = findCard(p.cardId); if (f2) { if (f2.card.disabledBy.indexOf('mj') < 0) f2.card.disabledBy.push('mj'); ok = true; } }
    else if (p.action === 'enable') { var f3 = findCard(p.cardId); if (f3) { f3.card.disabledBy = f3.card.disabledBy.filter(function (x) { return x !== 'mj'; }); ok = true; } }
    else if (p.action === 'move') { var f4 = findCard(p.cardId), tgt = findGroup(p.toGroupId); if (f4 && tgt) { f4.group.cards = f4.group.cards.filter(function (x) { return x.id !== f4.card.id; }); tgt.cards.push(f4.card); ok = true; } }
    if (ok) pushHistory({ sender: p.sender, action: p.action, text: p.text, result: 'agree', extra: p.note || '' });
    return ok;
  }
  function rejectPending(p) { if (p) pushHistory({ sender: p.sender, action: p.action, text: p.text, result: 'reject', extra: p.note || '' }); }

  function renderHistoryTab() {
    if (!DB.history.length) return '<div class="ma-empty">暂无历史记录</div>';
    var arr = DB.history.slice().reverse(), h = '';
    var actM = { add: '新增', delete: '删除', disable: '禁用', enable: '启用', move: '迁移' }, clsM = { add: 'add', delete: 'del', disable: 'dis', enable: 'en', move: 'mv' };
    h += '<div style="font-size:11px;color:#aaa;margin-bottom:10px;">最多保留 ' + HISTORY_LIMIT + ' 条，当前 ' + DB.history.length + ' 条</div>';
    for (var i = 0; i < arr.length; i++) { var it = arr[i]; h += '<div class="ma-history-item" style="display:flex;justify-content:space-between;padding:8px 4px;border-bottom:1px dashed #f0f0f0;font-size:12.5px;"><div class="ma-history-main" style="flex:1;"><div class="ma-history-text"><span class="ma-act-tag ' + (clsM[it.action] || '') + '" style="margin-right:6px;">' + (actM[it.action] || it.action) + '</span>' + esc(it.text) + '</div><div class="ma-history-meta" style="color:#aaa;font-size:11px;">' + esc(it.sender) + ' · ' + esc(fmtTime(it.time)) + '</div></div><span class="ma-res ' + (it.result === 'agree' ? 'agree' : 'reject') + '" style="font-size:11px;font-weight:700;color:' + (it.result === 'agree' ? '#12a150' : '#e0355a') + '">' + (it.result === 'agree' ? '已同意' : '已拒绝') + '</span></div>'; }
    return h;
  }

  function ensureOpenGroupsState() { if (OPEN_GROUPS === null) { OPEN_GROUPS = {}; for (var i = 0; i < DB.groups.length; i++) OPEN_GROUPS[DB.groups[i].id] = true; } }
  function renderCardsTab() {
    ensureOpenGroupsState();
    var h = '';
    h += '<div class="ma-set-block" style="background:#fafafa;">';
    h += '<div style="font-size:12px;color:#666;margin-bottom:8px;">手动输入要添加的字卡内容，支持回车换行批量提交（发件人：我）</div>';
    h += '<textarea class="ma-textarea" id="ma-manual-input" placeholder="输入字卡内容，换行可批量添加..."></textarea>';
    h += '<div class="ma-row" style="margin-top:8px;margin-bottom:0;">';
    h += '<select class="ma-select" id="ma-manual-group" style="width:120px;">';
    for (var gi = 0; gi < DB.groups.length; gi++) h += '<option value="' + esc(DB.groups[gi].id) + '">' + esc(DB.groups[gi].name) + '</option>';
    h += '</select>';
    h += '<button class="ma-btn primary" id="ma-manual-submit" style="flex:1;">提交审核</button>';
    h += '</div></div>';

    h += '<div class="ma-bulkbar"><label style="display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" id="ma-sel-all"> 全选</label><span id="ma-sel-count" style="color:#888;">已选 0 个</span><button class="ma-btn sm danger" id="ma-bulk-del">批量删除</button><select class="ma-select" id="ma-bulk-target" style="width:auto;flex:1;min-width:80px;"><option value="">转移目标…</option>';
    for (var gi = 0; gi < DB.groups.length; gi++) h += '<option value="' + esc(DB.groups[gi].id) + '">' + esc(DB.groups[gi].name) + '</option>';
    h += '</select><button class="ma-btn sm" id="ma-bulk-move">转移</button>';
    h += '<button class="ma-btn sm" id="ma-btn-dedup" style="color:#12a150;border-color:#a5e8c3;">一键去重</button>';
    h += '</div>';

    h += '<div class="ma-row"><input type="text" class="ma-input" id="ma-new-group-name" placeholder="新分类名称…" maxlength="20" style="flex:1;"><button class="ma-btn primary" id="ma-new-group">+ 新建分类</button></div>';
    
    if (!DB.groups.length) return h + '<div class="ma-empty">暂无分类</div>';
    for (var i = 0; i < DB.groups.length; i++) {
      var g = DB.groups[i], gDis = (g.disabledBy || []).length > 0, isOpen = OPEN_GROUPS[g.id] !== false;
      h += '<div class="ma-group' + (isOpen ? ' open' : '') + '" data-gid="' + esc(g.id) + '"><div class="ma-group-head"><div class="ma-group-title"><span class="ma-arrow">▶</span>';
      h += '<input type="checkbox" class="ma-group-select" data-gid="' + esc(g.id) + '" style="margin:0 2px 0 4px;cursor:pointer;" onclick="event.stopPropagation();">';
      h += '<span class="name">' + esc(g.name) + '</span><span class="ma-group-cnt">(' + g.cards.length + ')</span>' + (gDis ? '<span class="ma-badge-dis user" style="font-size:10px;">分组已禁用</span>' : '') + '</div><div class="ma-group-tools" style="flex-wrap:wrap;justify-content:flex-end;">';
      h += '<button class="ma-btn sm" data-gact="rename" data-gid="' + esc(g.id) + '">重命名</button><button class="ma-btn sm" data-gact="up" data-gid="' + esc(g.id) + '">↑</button><button class="ma-btn sm" data-gact="down" data-gid="' + esc(g.id) + '">↓</button><button class="ma-btn sm" data-gact="toggle" data-gid="' + esc(g.id) + '">' + (gDis ? '启用' : '禁用') + '</button><button class="ma-btn sm danger" data-gact="delete" data-gid="' + esc(g.id) + '">删除</button></div></div><div class="ma-group-body">';
      
      if (!g.cards.length) h += '<div class="ma-empty" style="padding:18px 10px;">该分类暂无字卡</div>';
      else {
        for (var j = 0; j < g.cards.length; j++) {
          var c = g.cards[j], cDisArr = c.disabledBy || [], effectiveDis = gDis || cDisArr.length > 0;
          h += '<div class="ma-card' + (effectiveDis ? ' disabled' : '') + '" data-cid="' + esc(c.id) + '"><input type="checkbox" class="ma-card-check" data-cid="' + esc(c.id) + '"><div class="ma-card-main"><div class="ma-card-text">' + esc(c.text) + '</div>';
          if (cDisArr.length) {
            var bCls = cDisArr.length >= 2 ? 'both' : (cDisArr.indexOf('user') >= 0 ? 'user' : 'mj');
            var bTxt = cDisArr.length >= 2 ? '双方禁用' : (cDisArr.indexOf('user') >= 0 ? '单方禁用·我' : '单方禁用·梦角');
            h += '<div class="ma-card-meta"><span class="ma-badge-dis ' + bCls + '">' + bTxt + '</span></div>';
          } else if (gDis) h += '<div class="ma-card-meta"><span class="ma-badge-dis user" style="font-size:10px;">随分组禁用</span></div>';
          h += '</div><div class="ma-card-ops">';
          h += '<button class="ma-btn sm" data-cact="send" data-cid="' + esc(c.id) + '" style="color:#2b6cff;border-color:#cce0ff;">发送</button>';
          h += '<button class="ma-btn sm" data-cact="edit" data-cid="' + esc(c.id) + '">编辑</button>';
          h += '<button class="ma-btn sm" data-cact="toggle" data-cid="' + esc(c.id) + '">' + (cDisArr.length ? '启用' : '禁用') + '</button>';
          h += '<button class="ma-btn sm danger" data-cact="delete" data-cid="' + esc(c.id) + '">删除</button></div></div>';
        }
      }
      h += '</div></div>';
    }
    return h;
  }

  function bindCardsEvents(body) {
    safe(function () {
      var subBtn = body.querySelector('#ma-manual-submit'), manInput = body.querySelector('#ma-manual-input'), manGroup = body.querySelector('#ma-manual-group');
      if (subBtn && manInput) {
        subBtn.addEventListener('click', function () {
          safe(function () {
            var txt = String(manInput.value || '').trim(); if (!txt) { toast('请输入内容'); return; }
            var lines = txt.split(/\r?\n/).map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; });
            if (!lines.length) { toast('请输入有效内容'); return; }
            var gid = manGroup ? manGroup.value : '';
            for (var i = 0; i < lines.length; i++) {
                DB.pending.push({ id: uid('p'), action: 'add', text: lines[i], cardId: '', fromGroupId: '', fromGroupName: '', toGroupId: gid, toGroupName: '', sender: SENDER_ME, auto: false, time: Date.now(), status: 'pending', note: '我手动提交的申请' });
            }
            saveData(); toast('已提交 ' + lines.length + ' 条审核'); manInput.value = ''; renderPanelBody(); updateBadge();
          }, 'manualSubmit');
        });
      }

      var newBtn = body.querySelector('#ma-new-group'), newInput = body.querySelector('#ma-new-group-name');
      if (newBtn && newInput) { newBtn.addEventListener('click', function () { safe(function () { var n = String(newInput.value || '').trim(); if (!n) { toast('请输入名称'); return; } DB.groups.push({ id: uid('g'), name: n, disabledBy: [], cards: [] }); if (OPEN_GROUPS) OPEN_GROUPS[DB.groups[DB.groups.length - 1].id] = true; saveData(); renderPanelBody(); toast('已创建'); }, 'newGroup'); }); newInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') newBtn.click(); }); }
      
      var dedupBtn = body.querySelector('#ma-btn-dedup');
      if (dedupBtn) {
        dedupBtn.addEventListener('click', function () {
          safe(function () {
            var seen = {}, count = 0;
            for (var i = 0; i < DB.groups.length; i++) {
              var g = DB.groups[i], newCards = [];
              for (var j = 0; j < g.cards.length; j++) {
                var c = g.cards[j], text = c.text.trim();
                if (seen[text]) {
                  count++;
                  var keepCard = seen[text];
                  if (c.disabledBy && c.disabledBy.length > 0) {
                    for (var k = 0; k < c.disabledBy.length; k++) if (keepCard.disabledBy.indexOf(c.disabledBy[k]) < 0) keepCard.disabledBy.push(c.disabledBy[k]);
                  }
                } else { seen[text] = c; newCards.push(c); }
              }
              g.cards = newCards;
            }
            if (count > 0) { saveData(); renderPanelBody(); toast('已清理 ' + count + ' 张重复字卡'); } else { toast('没有发现重复字卡'); }
          }, 'dedup');
        });
      }

      eachNode(body, '[data-gact]', function (btn) { btn.addEventListener('click', function (e) { e.stopPropagation(); safe(function () { handleGroupAction(btn.getAttribute('data-gact'), btn.getAttribute('data-gid')); }, 'groupAct'); }); });
      eachNode(body, '.ma-group-head', function (head) { head.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-gact]')) return; var grp = head.parentNode, gid = grp.getAttribute('data-gid'); var isOpen = grp.classList.toggle('open'); if (OPEN_GROUPS) OPEN_GROUPS[gid] = isOpen; }); });
      eachNode(body, '[data-cact]', function (btn) { btn.addEventListener('click', function (e) { e.stopPropagation(); safe(function () { handleCardAction(btn.getAttribute('data-cact'), btn.getAttribute('data-cid')); }, 'cardAct'); }); });
      
      function updCount() {
        var n = 0, total = 0;
        eachNode(body, '.ma-card-check', function (cb) { total++; if (cb.checked) n++; });
        var el = body.querySelector('#ma-sel-count'); if (el) el.textContent = '已选 ' + n + ' 个';
        var all = body.querySelector('#ma-sel-all'); if (all) all.checked = (n > 0 && n === total);
        
        eachNode(body, '.ma-group', function (grp) {
          var gcb = grp.querySelector('.ma-group-select'); if (!gcb) return;
          var cards = grp.querySelectorAll('.ma-card-check'), allChecked = cards.length > 0, anyChecked = false;
          for (var i = 0; i < cards.length; i++) { if (cards[i].checked) anyChecked = true; else allChecked = false; }
          gcb.checked = allChecked; gcb.indeterminate = anyChecked && !allChecked;
        });
      }

      var selAll = body.querySelector('#ma-sel-all'); 
      if (selAll) selAll.addEventListener('change', function () { eachNode(body, '.ma-card-check', function (cb) { cb.checked = selAll.checked; }); updCount(); });
      eachNode(body, '.ma-card-check', function (cb) { cb.addEventListener('change', updCount); });
      eachNode(body, '.ma-group-select', function (cb) { cb.addEventListener('change', function (e) { e.stopPropagation(); var gid = cb.getAttribute('data-gid'); var grp = body.querySelector('.ma-group[data-gid="' + gid + '"]'); if (!grp) return; var isChecked = cb.checked; eachNode(grp, '.ma-card-check', function (cardCb) { cardCb.checked = isChecked; }); updCount(); }); });

      var bulkDel = body.querySelector('#ma-bulk-del'); if (bulkDel) bulkDel.addEventListener('click', function () { safe(function () { var cids = []; eachNode(body, '.ma-card-check', function (cb) { if (cb.checked) cids.push(cb.getAttribute('data-cid')); }); if (!cids.length) { toast('请先勾选'); return; } confirmModal({ title: '批量删除', body: '确定删除选中的 ' + cids.length + ' 张字卡？', danger: true, okText: '删除', onOk: function () { safe(function () { for (var i = 0; i < cids.length; i++) { var f = findCard(cids[i]); if (f) f.group.cards = f.group.cards.filter(function (x) { return x.id !== f.card.id; }); } saveData(); renderPanelBody(); toast('已删除'); }, 'bulkDelApply'); } }); }, 'bulkDel'); });
      var bulkMove = body.querySelector('#ma-bulk-move'), bulkTarget = body.querySelector('#ma-bulk-target'); if (bulkMove && bulkTarget) bulkMove.addEventListener('click', function () { safe(function () { var tid = bulkTarget.value; if (!tid) { toast('请选择目标'); return; } var tgt = findGroup(tid); if (!tgt) return; var cids = []; eachNode(body, '.ma-card-check', function (cb) { if (cb.checked) cids.push(cb.getAttribute('data-cid')); }); if (!cids.length) { toast('请先勾选'); return; } var moved = 0; for (var i = 0; i < cids.length; i++) { var f = findCard(cids[i]); if (f && f.group.id !== tid) { f.group.cards = f.group.cards.filter(function (x) { return x.id !== f.card.id; }); tgt.cards.push(f.card); moved++; } } saveData(); renderPanelBody(); toast(moved ? '已转移 ' + moved + ' 张' : '无需转移'); }, 'bulkMove'); });
    }, 'bindCardsEvents');
  }

  function handleGroupAction(act, gid) {
    var g = findGroup(gid); if (!g) return;
    if (act === 'rename') { confirmModal({ title: '重命名', html: '<input type="text" class="ma-input" id="ma-rename-input" maxlength="20" value="' + esc(g.name) + '">', okText: '保存', onOk: function () { safe(function () { var i = document.getElementById('ma-rename-input'); if (!i) return; var v = String(i.value || '').trim(); if (!v) { toast('不能为空'); return; } g.name = v; saveData(); renderPanelBody(); toast('已重命名'); }, 'renameApply'); } }); setTimeout(function () { try { var i = document.getElementById('ma-rename-input'); if (i) { i.focus(); i.select(); } } catch (e) {} }, 50); return; }
    if (act === 'up' || act === 'down') { var idx = arrFindIndex(DB.groups, function (x) { return x.id === gid; }); if (idx < 0) return; var target = act === 'up' ? idx - 1 : idx + 1; if (target < 0 || target >= DB.groups.length) return; var tmp = DB.groups[idx]; DB.groups[idx] = DB.groups[target]; DB.groups[target] = tmp; saveData(); renderPanelBody(); return; }
    if (act === 'toggle') { if ((g.disabledBy || []).indexOf('user') >= 0) g.disabledBy = g.disabledBy.filter(function (x) { return x !== 'user'; }); else { if (!Array.isArray(g.disabledBy)) g.disabledBy = []; g.disabledBy.push('user'); } saveData(); renderPanelBody(); return; }
    if (act === 'delete') {
      if (!g.cards.length) { DB.groups = DB.groups.filter(function (x) { return x.id !== gid; }); if (OPEN_GROUPS) delete OPEN_GROUPS[gid]; saveData(); renderPanelBody(); toast('已删除'); return; }
      var others = []; for (var oi = 0; oi < DB.groups.length; oi++) if (DB.groups[oi].id !== gid) others.push(DB.groups[oi]);
      if (!others.length) { confirmModal({ title: '无法删除', body: '唯一分类且含字卡，请先创建其他分类。', okText: '知道了' }); return; }
      var opts = ''; for (var oi2 = 0; oi2 < others.length; oi2++) opts += '<option value="' + esc(others[oi2].id) + '">' + esc(others[oi2].name) + '</option>';
      confirmModal({ title: '删除分类', html: '<div>分类「<b>' + esc(g.name) + '</b>」有 <b>' + g.cards.length + '</b> 张字卡，请选择转移目标：</div><select class="ma-select" id="ma-del-target" style="margin-top:10px;">' + opts + '</select>', okText: '迁移并删除', danger: true, onOk: function () { safe(function () { var sel = document.getElementById('ma-del-target'), tid = sel ? sel.value : '', tgt = findGroup(tid); if (!tgt) { toast('目标不存在'); return; } var cnt = g.cards.length; for (var i = 0; i < g.cards.length; i++) tgt.cards.push(g.cards[i]); DB.groups = DB.groups.filter(function (x) { return x.id !== gid; }); if (OPEN_GROUPS) delete OPEN_GROUPS[gid]; saveData(); renderPanelBody(); toast('已转移 ' + cnt + ' 张并删除'); }, 'delGrpApply'); } });
      return;
    }
  }

  function handleCardAction(act, cid) {
    var f = findCard(cid); if (!f) return; var card = f.card;
    if (act === 'edit') { confirmModal({ title: '编辑字卡', html: '<textarea class="ma-textarea" id="ma-edit-input" maxlength="500">' + esc(card.text) + '</textarea>', okText: '保存', onOk: function () { safe(function () { var i = document.getElementById('ma-edit-input'); if (!i) return; var v = String(i.value || '').trim(); if (!v) { toast('不能为空'); return; } card.text = v; saveData(); renderPanelBody(); toast('已保存'); }, 'editApply'); } }); setTimeout(function () { try { var i = document.getElementById('ma-edit-input'); if (i) i.focus(); } catch (e) {} }, 50); return; }
    if (act === 'send') { safe(function () { sendCardToChat(cid); }, 'sendCard'); return; }
    
    if (act === 'toggle') { 
        if (!Array.isArray(card.disabledBy)) card.disabledBy = []; 
        if (card.disabledBy.length > 0) card.disabledBy = []; else card.disabledBy.push('user');
        saveData(); renderPanelBody(); return; 
    }
    
    if (act === 'delete') { confirmModal({ title: '删除字卡', body: '确定删除？', danger: true, okText: '删除', onOk: function () { safe(function () { f.group.cards = f.group.cards.filter(function (x) { return x.id !== cid; }); saveData(); renderPanelBody(); toast('已删除'); }, 'delCardApply'); } }); return; }
  }

  function sendCardToChat(cid) {
    safe(function () {
      var f = findCard(cid); if (!f) { toast('不存在'); return; } var text = f.card.text; if (!text) { toast('为空'); return; }
      var ok = injectBubbleToChat(text);
      if (ok) toast('已发送'); else toast('发送失败，请重试');
    }, 'sendCardToChat');
  }

  function renderSettingsTab() {
    var s = DB.settings, h = '';
    h += '<div class="ma-set-block"><div class="ma-set-title">悬浮球外观</div><div class="ma-row"><span class="ma-label" style="width:52px;">颜色</span><input type="color" id="ma-set-color" value="' + esc(s.ballColor) + '" style="width:46px;height:28px;border:1px solid #eee;border-radius:6px;padding:0;cursor:pointer;"><span style="font-size:11px;color:#bbb;">' + esc(s.ballColor) + '</span></div>';
    h += '<div class="ma-row"><span class="ma-label" style="width:52px;">大小</span><input type="range" class="ma-range" id="ma-set-size" min="36" max="88" step="1" value="' + s.ballSize + '"><span class="ma-label" id="ma-set-size-val" style="width:44px;text-align:right;">' + s.ballSize + 'px</span></div>';
    h += '<div class="ma-row"><div class="ma-thumb" id="ma-set-ball-thumb" style="' + (s.ballImage ? 'background-image:url(&quot;' + s.ballImage + '&quot;);' : 'background:' + esc(s.ballColor) + ';') + '"></div><button class="ma-btn sm" id="ma-set-ball-upload">上传图片</button>' + (s.ballImage ? '<button class="ma-btn sm danger" id="ma-set-ball-clear">移除</button>' : '') + '</div></div>';
    
    h += '<div class="ma-set-block"><div class="ma-set-title">审核图标外观</div>';
    h += '<div class="ma-row"><span class="ma-label" style="width:52px;">名称</span><input type="text" class="ma-input" id="ma-set-app-name" maxlength="6" value="' + esc(s.appName || '审核') + '"></div>';
    h += '<div class="ma-row"><span class="ma-label" style="width:52px;">文字色</span><input type="color" id="ma-set-app-color" value="' + esc(s.appColor || '#333333') + '" style="width:46px;height:28px;border:1px solid #eee;border-radius:6px;padding:0;cursor:pointer;"><span style="font-size:11px;color:#bbb;">' + esc(s.appColor) + '</span></div>';
    h += '<div class="ma-row"><div class="ma-thumb square" id="ma-set-app-thumb" style="' + (s.appImage ? 'background-image:url(&quot;' + s.appImage + '&quot;);' : 'background:#f5f5f5;') + '"></div><button class="ma-btn sm" id="ma-set-app-upload">上传图片</button>' + (s.appImage ? '<button class="ma-btn sm danger" id="ma-set-app-clear">移除</button>' : '') + '</div></div>';
    
    h += '<div class="ma-set-block"><div class="ma-set-title">入口显示</div><div class="ma-row" style="justify-content:space-between;"><div><div style="font-size:13px;">隐藏悬浮球</div><div style="font-size:11px;color:#aaa;">开启后悬浮球消失，需点击原生“审核”图标进入面板关闭此开关</div></div><div class="ma-switch' + (s.hideAll ? ' on' : '') + '" id="ma-set-hide"></div></div></div>';
    h += '<div class="ma-set-block"><div class="ma-set-title">数据备份</div><div class="ma-row wrap"><button class="ma-btn" id="ma-export">导出备份</button><button class="ma-btn danger" id="ma-import">导入备份</button><input type="file" id="ma-import-file" accept=".json" style="display:none;"></div></div>';
    return h;
  }

  function bindSettingsEvents(body) {
    safe(function () {
      var c = body.querySelector('#ma-set-color'); if (c) { c.addEventListener('input', function () { safe(function () { DB.settings.ballColor = c.value; var t = body.querySelector('#ma-set-ball-thumb'); if (t && !DB.settings.ballImage) t.style.background = c.value; applyAppearance(); }, 'colorIn'); }); c.addEventListener('change', function () { saveData(); applyAppearance(); renderPanelBody(); }); }
      var sz = body.querySelector('#ma-set-size'), szv = body.querySelector('#ma-set-size-val'); if (sz) { sz.addEventListener('input', function () { safe(function () { var v = clamp(parseInt(sz.value, 10) || 52, 36, 88); DB.settings.ballSize = v; if (szv) szv.textContent = v + 'px'; applyAppearance(); applyFabPosition(); }, 'sizeIn'); }); sz.addEventListener('change', function () { saveData(); }); }
      var bu = body.querySelector('#ma-set-ball-upload'); if (bu) bu.addEventListener('click', function () { openCropper({ title: '裁剪悬浮球', shape: 'circle', onConfirm: function (d) { safe(function () { DB.settings.ballImage = d; saveData(); applyAppearance(); renderPanelBody(); toast('已更新'); }, 'ballImg'); } }); });
      var bc = body.querySelector('#ma-set-ball-clear'); if (bc) bc.addEventListener('click', function () { safe(function () { DB.settings.ballImage = ''; saveData(); applyAppearance(); renderPanelBody(); toast('已移除'); }, 'ballClr'); });
      
      var appNameInp = body.querySelector('#ma-set-app-name'); if (appNameInp) {
        appNameInp.addEventListener('input', function () { safe(function () { DB.settings.appName = appNameInp.value.trim() || '审核'; applyAppearance(); }, 'appNameIn'); });
        appNameInp.addEventListener('change', function () { saveData(); renderPanelBody(); });
      }
      var appColorInp = body.querySelector('#ma-set-app-color'); if (appColorInp) {
        appColorInp.addEventListener('input', function () { safe(function () { DB.settings.appColor = appColorInp.value; applyAppearance(); }, 'appColorIn'); });
        appColorInp.addEventListener('change', function () { saveData(); renderPanelBody(); });
      }
      
      var au = body.querySelector('#ma-set-app-upload'); if (au) au.addEventListener('click', function () { openCropper({ title: '裁剪图标', shape: 'square', onConfirm: function (d) { safe(function () { DB.settings.appImage = d; saveData(); applyAppearance(); renderPanelBody(); toast('已更新'); }, 'appImg'); } }); });
      var ac = body.querySelector('#ma-set-app-clear'); if (ac) ac.addEventListener('click', function () { safe(function () { DB.settings.appImage = ''; saveData(); applyAppearance(); renderPanelBody(); toast('已移除'); }, 'appClr'); });
      
      var hd = body.querySelector('#ma-set-hide'); if (hd) hd.addEventListener('click', function () { safe(function () { DB.settings.hideAll = !DB.settings.hideAll; saveData(); hd.classList.toggle('on', DB.settings.hideAll); applyVisibility(); toast(DB.settings.hideAll ? '悬浮球已隐藏，可通过原生图标恢复' : '悬浮球已恢复'); }, 'hideSet'); });
      
      var exp = body.querySelector('#ma-export'); if (exp) exp.addEventListener('click', function () { safe(function () { var blob = new Blob([JSON.stringify({ __ma_backup: true, exportedAt: Date.now(), data: DB }, null, 2)], { type: 'application/json' }); var url = URL.createObjectURL(blob), a = document.createElement('a'), d = new Date(); a.href = url; a.download = 'audit-backup-' + d.getTime() + '.json'; document.body.appendChild(a); a.click(); setTimeout(function () { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (e) {} }, 200); toast('已导出'); }, 'export'); });
      var imp = body.querySelector('#ma-import'), impf = body.querySelector('#ma-import-file'); if (imp && impf) { imp.addEventListener('click', function () { impf.click(); }); impf.addEventListener('change', function () { safe(function () { var f = impf.files && impf.files[0]; if (!f) return; var fr = new FileReader(); fr.onload = function () { safe(function () { var obj = JSON.parse(fr.result), inc = obj && obj.__ma_backup ? obj.data : obj; if (!inc) { toast('格式错误'); return; } confirmModal({ title: '确认导入', body: '将覆盖当前所有数据，是否继续？', danger: true, okText: '覆盖', onOk: function () { safe(function () { DB = normalizeData(inc); saveData(); applyAppearance(); applyFabPosition(); applyVisibility(); renderTabs(); renderPanelBody(); updateBadge(); toast('导入成功'); }, 'impApply'); } }); }, 'impParse'); }; fr.readAsText(f, 'utf-8'); }, 'impChange'); }); }
    }, 'bindSetEvents');
  }

  function confirmModal(opts) {
    safe(function () {
      ensureRoot(); var mask = document.getElementById('ma-modal-mask'); if (!mask) { mask = document.createElement('div'); mask.id = 'ma-modal-mask'; ROOT.appendChild(mask); }
      var o = opts || {};
      mask.innerHTML = '<div class="ma-modal"><div class="ma-modal-title">' + esc(o.title || '提示') + '</div><div class="ma-modal-body">' + (o.html || esc(o.body || '')) + '</div><div class="ma-modal-actions"><button class="ma-btn" data-act="cancel">' + esc(o.cancelText || '取消') + '</button><button class="ma-btn ' + (o.danger ? 'danger' : 'primary') + '" data-act="ok">' + esc(o.okText || '确定') + '</button></div></div>';
      mask.classList.add('on');
      mask.onclick = function (e) { if (e.target === mask) { mask.classList.remove('on'); return; } var btn = e.target.closest ? e.target.closest('[data-act]') : null; if (!btn) return; var isOk = btn.getAttribute('data-act') === 'ok'; mask.classList.remove('on'); if (isOk && typeof o.onOk === 'function') safe(o.onOk, 'modalOk'); else if (!isOk && typeof o.onCancel === 'function') safe(o.onCancel, 'modalCancel'); };
    }, 'confirmModal');
  }

  var cropState = null;
  function openCropper(opts) {
    safe(function () {
      var fi = document.createElement('input'); fi.type = 'file'; fi.accept = 'image/*'; fi.style.display = 'none'; document.body.appendChild(fi);
      fi.addEventListener('change', function () { safe(function () { var f = fi.files && fi.files[0]; if (!f) { try { document.body.removeChild(fi); } catch (e) {} return; } if (f.size > 12 * 1024 * 1024) { toast('图片过大'); try { document.body.removeChild(fi); } catch (e) {} return; } var fr = new FileReader(); fr.onload = function () { var img = new Image(); img.onload = function () { showCropUI(img, opts); try { document.body.removeChild(fi); } catch (e) {} }; img.src = fr.result; }; fr.readAsDataURL(f); }, 'cropChange'); });
      fi.click();
    }, 'openCropper');
  }

  function showCropUI(img, opts) {
    safe(function () {
      ensureRoot(); var mask = document.getElementById('ma-crop-mask'); if (!mask) { mask = document.createElement('div'); mask.id = 'ma-crop-mask'; ROOT.appendChild(mask); }
      var o = opts || {}, SIZE = Math.min(240, Math.max(180, (window.innerWidth || 375) - 100)), isCircle = o.shape !== 'square', radius = isCircle ? '50%' : '18px';
      mask.innerHTML = '<div class="ma-crop-box"><div class="ma-crop-title" style="text-align:center;padding:13px;font-weight:700;border-bottom:1px solid #f0f0f0;">' + esc(o.title) + '</div><div class="ma-crop-stage"><div class="ma-crop-canvas-wrap" id="ma-crop-wrap" style="width:' + SIZE + 'px;height:' + SIZE + 'px;border-radius:' + radius + ';overflow:hidden;box-shadow:0 0 0 9999px rgba(0,0,0,.32),0 0 0 1px rgba(255,255,255,.5);"><canvas class="ma-crop-canvas" id="ma-crop-canvas"></canvas></div></div><div class="ma-crop-hint" style="text-align:center;font-size:11px;color:#aaa;padding:8px;">拖动图片调整位置</div><div class="ma-crop-zoom" style="display:flex;padding:0 16px 10px;align-items:center;"><span style="font-size:12px;color:#999;">缩放</span><input type="range" id="ma-crop-zoom" min="1" max="3" step="0.01" value="1" style="flex:1;margin-left:10px;"></div><div class="ma-crop-actions" style="display:flex;gap:10px;padding:10px 16px 16px;"><button class="ma-btn" id="ma-crop-cancel" style="flex:1;">取消</button><button class="ma-btn primary" id="ma-crop-ok" style="flex:1;">确认</button></div></div>';
      var canvas = mask.querySelector('#ma-crop-canvas'), wrap = mask.querySelector('#ma-crop-wrap'), zoomEl = mask.querySelector('#ma-crop-zoom');
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(SIZE * dpr); canvas.height = Math.round(SIZE * dpr); canvas.style.width = SIZE + 'px'; canvas.style.height = SIZE + 'px';
      var ctx = canvas.getContext('2d');
      var st = { img: img, size: SIZE, dpr: dpr, ctx: ctx, baseScale: Math.max(SIZE / img.width, SIZE / img.height), zoom: 1, ox: 0, oy: 0 };
      cropState = st;
      function clampOffset() { var s = st.baseScale * st.zoom, w = st.img.width * s, h = st.img.height * s; st.ox = Math.max(-Math.max(0, (w - st.size) / 2), Math.min(Math.max(0, (w - st.size) / 2), st.ox)); st.oy = Math.max(-Math.max(0, (h - st.size) / 2), Math.min(Math.max(0, (h - st.size) / 2), st.oy)); }
      function draw() { safe(function () { clampOffset(); var s = st.baseScale * st.zoom, size = st.size; ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0); ctx.clearRect(0, 0, size, size); ctx.save(); ctx.translate(size / 2 + st.ox, size / 2 + st.oy); ctx.scale(s, s); ctx.drawImage(st.img, -st.img.width / 2, -st.img.height / 2); ctx.restore(); }, 'draw'); }
      draw(); mask.classList.add('on');
      var dragging = false, lx = 0, ly = 0;
      wrap.addEventListener(window.PointerEvent ? 'pointerdown' : 'mousedown', function (e) { dragging = true; lx = e.clientX; ly = e.clientY; e.preventDefault(); });
      (window.PointerEvent ? wrap : document).addEventListener(window.PointerEvent ? 'pointermove' : 'mousemove', function (e) { if (!dragging) return; st.ox += (e.clientX - lx); st.oy += (e.clientY - ly); lx = e.clientX; ly = e.clientY; draw(); e.preventDefault(); });
      (window.PointerEvent ? wrap : document).addEventListener(window.PointerEvent ? 'pointerup' : 'mouseup', function () { dragging = false; });
      zoomEl.addEventListener('input', function () { safe(function () { st.zoom = clamp(parseFloat(zoomEl.value) || 1, 1, 3); draw(); }, 'zoom'); });
      mask.querySelector('#ma-crop-cancel').addEventListener('click', function () { mask.classList.remove('on'); cropState = null; });
      mask.querySelector('#ma-crop-ok').addEventListener('click', function () { safe(function () { var OUT = 256, k = OUT / st.size, s = st.baseScale * st.zoom, oc = document.createElement('canvas'); oc.width = OUT; oc.height = OUT; var octx = oc.getContext('2d'); octx.save(); octx.translate(OUT / 2 + st.ox * k, OUT / 2 + st.oy * k); octx.scale(s * k, s * k); octx.drawImage(st.img, -st.img.width / 2, -st.img.height / 2); octx.restore(); var d = oc.toDataURL('image/webp', 0.92); if (d.indexOf('data:image/webp') !== 0) d = oc.toDataURL('image/png'); mask.classList.remove('on'); cropState = null; if (typeof o.onConfirm === 'function') o.onConfirm(d); }, 'cropOk'); });
    }, 'showCropUI');
  }

  function parseUrlForceShow() { return safe(function () { var search = (window.location && window.location.search) || ''; if (!search) return false; if (typeof URLSearchParams !== 'undefined') { try { var v = new URLSearchParams(search).get('show_audit'); if (v === 'true' || v === '1') return true; } catch (e) {} } return /[?&]show_audit=(true|1)(?:&|$)/i.test(search); }, 'parseUrlForceShow', false); }
  function onReady(fn) { safe(function () { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { safe(fn, 'ready:cb'); }, { once: true }); else setTimeout(function () { safe(fn, 'ready:cb'); }, 0); }, 'onReady'); }
  function startGuard() { safe(function () { if (window.__maGuardTimer) return; window.__maGuardTimer = setInterval(function () { safe(function () { if (!document.body) return; if (!ROOT || !document.body.contains(ROOT)) { ROOT = null; FAB = null; MASK = null; PANEL = null; PANEL_OPEN = false; safe(buildFab, 'gFab'); safe(buildUI, 'gUI'); safe(applyAppearance, 'gApp'); safe(applyFabPosition, 'gPos'); safe(applyVisibility, 'gVis'); safe(updateBadge, 'gBadge'); } if (!APP_ICON_EL || !document.body.contains(APP_ICON_EL)) { APP_ICON_EL = null; APP_ICON_IMG_EL = null; safe(injectAppIcon, 'gAppIcon'); safe(applyAppearance, 'gAppIconApp'); safe(applyVisibility, 'gAppIconVis'); safe(updateBadge, 'gAppIconBadge'); } }, 'guard'); }, 3000); }, 'startGuard'); }
  
  function bootstrap() {
    URL_FORCE_SHOW = parseUrlForceShow(); DB = loadData(); injectCSS(); ensureRoot(); buildFab(); buildUI(); applyAppearance(); applyFabPosition(); applyVisibility(); updateBadge();
    if (!window.__maResizeBound) { window.__maResizeBound = true; window.addEventListener('resize', function () { safe(function () { if (!FAB) return; var size = FAB.offsetWidth || DB.settings.ballSize || 52; FAB.style.left = clamp(parseFloat(FAB.style.left), 4, Math.max(4, window.innerWidth - size - 4)) + 'px'; FAB.style.top = clamp(parseFloat(FAB.style.top), 4, Math.max(4, window.innerHeight - size - 4)) + 'px'; }, 'resize'); }); }
    
    startAppIconObserver(); // 极速监听注入
    startEngine(); 
    startGuard();
    
    // 针对聊天室的轻量补全
    let lastChatCheck = 0;
    setInterval(function() {
        let now = Date.now();
        if (now - lastChatCheck < 500) return;
        if (document.getElementById('chat-body')) {
            checkAndRepairChat();
        }
        lastChatCheck = now;
    }, 500);

    if (URL_FORCE_SHOW) { safe(function () { if (FAB) FAB.classList.remove('ma-hidden'); toast('已强制唤醒'); }, 'forceTo'); }
    
    try {
      window.__MY_AUDIT__ = { 
        tick: function() { tickEngine(); }, 
        dump: function() { return JSON.parse(JSON.stringify(DB)); },
        reload: function() { DB = loadData(); if (PANEL_OPEN) renderPanelBody(); updateBadge(); toast('数据已重新加载'); },
        injectTest: function() {
          if (!DB || !DB.groups.length || !DB.groups[0].cards.length) { toast('请先创建至少一个分类和一张字卡'); return; }
          var g1 = DB.groups[0], g2 = DB.groups[1] || g1, c1 = g1.cards[0], c2 = g1.cards[1] || c1, now = Date.now();
          DB.pending.push({ id: 't1_'+now, action: 'delete', text: c1.text, cardId: c1.id, fromGroupId: g1.id, fromGroupName: g1.name, sender: '梦角', time: now, status: 'pending', note: '梦角的捣乱测试：想删除这张卡' });
          DB.pending.push({ id: 't2_'+now, action: 'disable', text: c2.text, cardId: c2.id, fromGroupId: g1.id, fromGroupName: g1.name, sender: '梦角', time: now, status: 'pending', note: '梦角的捣乱测试：想禁用这张卡' });
          if (DB.groups.length > 1) DB.pending.push({ id: 't3_'+now, action: 'move', text: c1.text, cardId: c1.id, fromGroupId: g1.id, fromGroupName: g1.name, toGroupId: g2.id, toGroupName: g2.name, sender: '梦角', time: now, status: 'pending', note: '梦角的整理测试：想迁移到[' + g2.name + ']' });
          DB.pending.push({ id: 't4_'+now, action: 'enable', text: c1.text, cardId: c1.id, fromGroupId: g1.id, fromGroupName: g1.name, sender: '梦角', time: now, status: 'pending', note: '梦角的整理测试：想恢复启用' });
          saveData(); if (PANEL_OPEN) { renderPanelBody(); updateBadge(); } toast('测试数据已成功注入');
        }
      };
    } catch (e) {}
  }

  try { onReady(function () { try { bootstrap(); } catch (err) { try { injectCSS(); ensureRoot(); toast('初始化异常'); } catch (e2) {} } }); } catch (e) { try { injectCSS(); } catch (e2) {} }

})();
