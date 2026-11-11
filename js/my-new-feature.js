/* ============================================================================
 * my-new-feature.js 终极完美版
 * 修复：1. 红点变数字 2. 精准抓取完整消息行（带时间/头像） 3. 禁用逻辑反转
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
  var APP_ICON_EL = null, APP_ICON_IMG_EL = null, appIconInjectTimer = null;
  var OPEN_GROUPS = null;

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

  function defaultSettings() { return { ballColor: '#ff6b81', ballSize: 52, ballImage: '', appImage: '', hideAll: false, ballPos: null }; }
  function defaultData() { return { version: DATA_VERSION, groups: [], pending: [], history: [], settings: defaultSettings(), meta: { lastGrabAt: 0, grabbedKeys: [], lastMischiefAt: 0 } }; }
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
    if (typeof s.ballImage !== 'string') s.ballImage = ''; if (typeof s.appImage !== 'string') s.appImage = ''; if (typeof s.hideAll !== 'boolean') s.hideAll = false;
    if (!s.ballPos || typeof s.ballPos !== 'object' || typeof s.ballPos.x !== 'number' || typeof s.ballPos.y !== 'number') s.ballPos = null;
    if (!d.meta || typeof d.meta !== 'object') d.meta = def.meta; if (typeof d.meta.lastGrabAt !== 'number') d.meta.lastGrabAt = 0; if (typeof d.meta.lastMischiefAt !== 'number') d.meta.lastMischiefAt = 0; if (!Array.isArray(d.meta.grabbedKeys)) d.meta.grabbedKeys = []; if (d.meta.grabbedKeys.length > 400) d.meta.grabbedKeys = d.meta.grabbedKeys.slice(-400);
    return d;
  }
  function loadData() { return safe(function () { var raw = localStorage.getItem(LS_KEY_DATA); if (!raw) return defaultData(); return normalizeData(JSON.parse(raw)); }, 'loadData', defaultData()); }
  function saveData() { return safe(function () { localStorage.setItem(LS_KEY_DATA, JSON.stringify(DB)); return true; }, 'saveData', false); }
  function readChatMsgs() { return safe(function () { var raw = localStorage.getItem(LS_KEY_CHAT); if (!raw) return []; var arr = JSON.parse(raw); return Array.isArray(arr) ? arr : []; }, 'readChatMsgs', []); }
  function writeChatMsgs(arr) { return safe(function () { localStorage.setItem(LS_KEY_CHAT, JSON.stringify(arr)); return true; }, 'writeChatMsgs', false); }
  function findGroup(gid) { try { for (var i = 0; i < DB.groups.length; i++) if (DB.groups[i].id === gid) return DB.groups[i]; } catch (e) {} return null; }
  function findCard(cid) { try { for (var i = 0; i < DB.groups.length; i++) { var g = DB.groups[i]; for (var j = 0; j < g.cards.length; j++) if (g.cards[j].id === cid) return { group: g, card: g.cards[j] }; } } catch (e) {} return null; }
  function pushHistory(rec) { safe(function () { DB.history.push({ id: uid('h'), sender: rec.sender || SENDER_MJ, action: rec.action || 'add', text: rec.text || '', result: rec.result || 'agree', time: Date.now(), extra: rec.extra || '' }); if (DB.history.length > HISTORY_LIMIT) DB.history = DB.history.slice(-HISTORY_LIMIT); saveData(); }, 'pushHistory'); }

  /* 终极修复：智能抓取包含时间/头像的完整消息行 */
  function injectBubbleToChat(text) {
    try {
      var msgs = readChatMsgs(); msgs.push({ side: 'in', text: text, time: Date.now() }); writeChatMsgs(msgs);
      var chatBody = document.getElementById('chat-body');
      if (!chatBody) { console.warn('[审计] 找不到 #chat-body'); return false; }
      var children = Array.from(chatBody.children), templateNode = null;
      
      // 第一遍：寻找带有时间格式或头像的完整节点
      for (var i = children.length - 1; i >= 0; i--) {
        var el = children[i], cls = (el.className || '').toLowerCase();
        if (cls.indexOf('out') >= 0 || cls.indexOf('me') >= 0 || cls.indexOf('right') >= 0 || cls.indexOf('self') >= 0) continue;
        var txt = el.textContent || '';
        if (txt.indexOf('词典拼词') >= 0 || txt.indexOf('交流意图') >= 0) continue;
        
        // 核心判断：有 HH:MM 时间格式 或 有 img/svg 头像
        var hasTime = /\d{1,2}:\d{2}/.test(txt);
        var hasAvatar = el.querySelector('img, svg, .avatar, [class*="avatar"]');
        if ((hasTime || hasAvatar) && txt.trim().length > 0) {
            templateNode = el; 
            break;
        }
      }

      // 第二遍兜底：如果上面没找到，说明原网页结构特殊，退化找普通文字节点
      if (!templateNode) {
        for (var i = children.length - 1; i >= 0; i--) {
          var el = children[i], cls = (el.className || '').toLowerCase();
          if (cls.indexOf('out') >= 0 || cls.indexOf('me') >= 0 || cls.indexOf('right') >= 0 || cls.indexOf('self') >= 0) continue;
          var txt = el.textContent || '';
          if (txt.indexOf('词典拼词') >= 0 || txt.indexOf('交流意图') >= 0) continue;
          if (txt.trim().length > 0) { templateNode = el; break; }
        }
      }

      if (!templateNode) { console.warn('[审计] 找不到可克隆的对方气泡节点'); return false; }
      var clone = templateNode.cloneNode(true);
      if (clone.id) clone.removeAttribute('id');
      var nodesWithId = clone.querySelectorAll('[id]'); for (var k = 0; k < nodesWithId.length; k++) nodesWithId[k].removeAttribute('id');
      
      // 寻找最长的文本节点进行替换（保护时间、头像等不被修改）
      var walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT, null, false), maxLen = 0, targetTextNode = null, tn;
      while ((tn = walker.nextNode())) { 
          var len = tn.nodeValue.trim().length; 
          // 跳过时间格式的节点
          if (/^\d{1,2}:\d{2}$/.test(tn.nodeValue.trim())) continue;
          if (len > maxLen) { maxLen = len; targetTextNode = tn; } 
      }
      if (targetTextNode) targetTextNode.nodeValue = text; else clone.innerText = text;
      
      chatBody.appendChild(clone);
      try { chatBody.scrollTop = chatBody.scrollHeight; if (chatBody.parentNode) chatBody.parentNode.scrollTop = chatBody.parentNode.scrollHeight; window.scrollTo(0, document.body.scrollHeight); } catch (e) {}
      return true;
    } catch (err) { console.warn('[审计] 注入气泡异常：', err); return false; }
  }

  function autoPendingCount() { var n = 0; try { for (var i = 0; i < DB.pending.length; i++) { var p = DB.pending[i]; if (p.status === 'pending' && p.sender === SENDER_MJ && p.action === 'add') n++; } } catch (e) {} return n; }
  function pendingCount() { var n = 0; try { for (var i = 0; i < DB.pending.length; i++) if (DB.pending[i].status === 'pending') n++; } catch (e) {} return n; }
  function grabFromChat() {
    safe(function () {
      if (!DB || autoPendingCount() >= MAX_AUTO_PENDING) return;
      var msgs = readChatMsgs(), now = Date.now(), cands = [];
      for (var i = 0; i < msgs.length; i++) {
        var m = msgs[i]; if (!m || typeof m !== 'object' || m.side !== 'out' || typeof m.text !== 'string') continue;
        var t = m.text.trim(), len = t.length; if (len < MIN_LEN || len > MAX_LEN) continue;
        var tm = Number(m.time) || 0; if (!tm || now - tm > RECENT_MS || now - tm < -60000) continue;
        var key = t + '@@' + tm; if (DB.meta.grabbedKeys.indexOf(key) >= 0) continue;
        cands.push({ text: t, time: tm, key: key });
      }
      if (!cands.length) return; cands.sort(function () { return Math.random() - 0.5; });
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
      try { for (var i = 0; i < DB.groups.length; i++) { var g = DB.groups[i]; if (g.disabledBy && g.disabledBy.length > 0) continue; for (var j = 0; j < g.cards.length; j++) { var c = g.cards[j]; if (c.disabledBy && c.disabledBy.length > 0) continue; if (c.text && c.text.trim()) validCards.push(c.text.trim()); } } } catch (e) { console.warn('[审计] 读取字卡库出错：', e); return; }
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
        '#ma-fab{position:fixed;z-index:' + (Z_BASE + 10) + ';display:flex;align-items:center;justify-content:center;border-radius:50%;color:#fff;font-size:13px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;cursor:pointer;user-select:none;background-color:#ff6b81;background-size:cover;background-position:center;background-repeat:no-repeat;box-shadow:none;border:none;outline:none;transition:transform .15s ease,opacity .2s ease;touch-action:none;overflow:visible;}',
        '#ma-fab:active{transform:scale(.94);}','#ma-fab.ma-hidden{display:none!important;}',
        '#ma-fab .ma-fab-dot{position:absolute;top:-1px;right:-1px;width:11px;height:11px;border-radius:50%;background:#ff2d55;display:none;pointer-events:none;}','#ma-fab .ma-fab-dot.on{display:block;}','#ma-fab.ma-has-img .ma-fab-txt{display:none;}',
        '#ma-app-icon{position:relative;cursor:pointer;}',
        // 新增：原生图标的数字角标样式
        '#ma-app-icon .ma-app-badge{position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:#ff2d55;color:#fff;font-size:10px;display:none;align-items:center;justify-content:center;font-weight:bold;border:1px solid #fff;box-sizing:border-box;}',
        '#ma-mask{position:fixed;left:0;top:0;right:0;bottom:0;z-index:' + (Z_BASE + 100) + ';background:rgba(0,0,0,.42);display:none;align-items:center;justify-content:center;}','#ma-mask.on{display:flex;}',
        '#ma-panel{width:min(560px,94vw);max-height:86vh;display:flex;flex-direction:column;background:#fff;border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;font-size:14px;color:#222;line-height:1.5;box-shadow:0 12px 40px rgba(0,0,0,.22);}',
        '.ma-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #f0f0f0;background:#fafafa;}','.ma-title{font-size:16px;font-weight:700;}','.ma-close{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;color:#999;cursor:pointer;}','.ma-close:hover{background:#eee;color:#333;}',
        '.ma-tabs{display:flex;border-bottom:1px solid #eee;background:#fff;overflow-x:auto;}','.ma-tab{flex:1 0 auto;padding:10px 12px;text-align:center;cursor:pointer;font-size:13px;color:#666;white-space:nowrap;position:relative;border-bottom:2px solid transparent;}','.ma-tab.on{color:#ff4d6d;border-bottom-color:#ff4d6d;font-weight:600;}','.ma-tab-badge{display:inline-block;min-width:16px;height:16px;line-height:16px;padding:0 4px;border-radius:8px;background:#ff2d55;color:#fff;font-size:10px;margin-left:4px;font-weight:600;vertical-align:middle;}',
        '.ma-body{flex:1;overflow-y:auto;padding:12px 14px 20px;}','.ma-btn{display:inline-flex;align-items:center;justify-content:center;padding:6px 14px;border-radius:8px;border:1px solid #ddd;background:#fff;color:#333;font-size:13px;cursor:pointer;line-height:1.4;white-space:nowrap;}','.ma-btn:hover{background:#f6f6f6;}','.ma-btn.primary{background:#ff4d6d;border-color:#ff4d6d;color:#fff;}','.ma-btn.danger{background:#fff;border-color:#ffb3c0;color:#e0355a;}','.ma-btn.sm{padding:3px 9px;font-size:12px;border-radius:6px;}',
        '.ma-input,.ma-select,.ma-textarea{width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:8px;font-size:13px;color:#222;background:#fff;outline:none;font-family:inherit;}','.ma-row{display:flex;align-items:center;gap:8px;margin-bottom:10px;}','.ma-empty{text-align:center;color:#bbb;padding:40px 10px;font-size:13px;}',
        '.ma-pending-item{border:1px solid #f0f0f0;border-radius:12px;padding:10px 12px;margin-bottom:10px;}','.ma-pending-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;}','.ma-act-tag{display:inline-block;padding:1px 8px;border-radius:6px;font-size:11px;font-weight:600;background:#eef4ff;color:#2b6cff;}','.ma-act-tag.add{background:#e9f9ef;color:#12a150;}','.ma-act-tag.del{background:#ffeef1;color:#e0355a;}','.ma-act-tag.dis{background:#fff5e6;color:#c47d00;}',
        '.ma-group{border:1px solid #eee;border-radius:12px;margin-bottom:10px;overflow:hidden;}','.ma-group-head{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:#fafafa;cursor:pointer;}','.ma-group-title{display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px;}','.ma-group-cnt{font-size:11px;color:#999;font-weight:400;}','.ma-group-body{display:none;padding:8px 10px 10px;border-top:1px solid #f0f0f0;}','.ma-group.open .ma-group-body{display:block;}','.ma-arrow{display:inline-block;transition:transform .18s;color:#aaa;font-size:11px;}','.ma-group.open .ma-arrow{transform:rotate(90deg);}',
        '.ma-card{display:flex;align-items:flex-start;gap:8px;padding:7px 8px;border-radius:8px;}','.ma-card:hover{background:#fafafa;}','.ma-card-check{margin-top:3px;flex-shrink:0;}','.ma-card-main{flex:1;min-width:0;}','.ma-card-text{font-size:13px;color:#222;word-break:break-all;}','.ma-card.disabled .ma-card-text{color:#b5b5b5;text-decoration:line-through;}','.ma-card-ops{display:flex;gap:4px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;}','.ma-badge-dis{display:inline-block;padding:0 6px;border-radius:5px;font-size:10px;line-height:16px;font-weight:600;}','.ma-badge-dis.user{background:#ffeef1;color:#e0355a;}','.ma-badge-dis.mj{background:#f0edff;color:#6c4cf0;}','.ma-badge-dis.both{background:#3a3a3a;color:#fff;}',
        '.ma-bulkbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;background:#fafafa;border-radius:10px;margin-bottom:10px;font-size:12px;color:#666;}',
        '.ma-set-block{border:1px solid #eee;border-radius:12px;padding:12px;margin-bottom:12px;}','.ma-set-title{font-size:13px;font-weight:700;margin-bottom:10px;}','.ma-range{width:100%;accent-color:#ff4d6d;}','.ma-thumb{width:52px;height:52px;border-radius:50%;background:#f0f0f0 center/cover no-repeat;border:1px solid #e5e5e5;flex-shrink:0;}','.ma-thumb.square{border-radius:14px;}',
        '.ma-switch{position:relative;width:44px;height:24px;border-radius:12px;background:#ddd;cursor:pointer;transition:.2s;flex-shrink:0;}','.ma-switch.on{background:#ff4d6d;}','.ma-switch::after{content:"";position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:.2s;}','.ma-switch.on::after{left:22px;}',
        '#ma-crop-mask{position:fixed;left:0;top:0;right:0;bottom:0;z-index:' + (Z_BASE + 200) + ';background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;}','#ma-crop-mask.on{display:flex;}','.ma-crop-box{width:min(340px,92vw);background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,.3);}','.ma-crop-title{padding:13px 16px;font-size:14px;font-weight:700;border-bottom:1px solid #f0f0f0;text-align:center;}','.ma-crop-stage{position:relative;width:100%;padding:18px 0;display:flex;align-items:center;justify-content:center;background:#f7f7f8;}','.ma-crop-canvas-wrap{position:relative;touch-action:none;cursor:grab;}','.ma-crop-canvas{display:block;background:#fff;}','.ma-crop-actions{display:flex;gap:10px;padding:12px 16px 16px;}','.ma-crop-actions .ma-btn{flex:1;padding:9px 0;font-size:14px;}',
        '#ma-modal-mask{position:fixed;left:0;top:0;right:0;bottom:0;z-index:' + (Z_BASE + 300) + ';background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;}','#ma-modal-mask.on{display:flex;}','.ma-modal{width:min(360px,90vw);background:#fff;border-radius:14px;overflow:hidden;}','.ma-modal-title{padding:14px 16px 6px;font-size:15px;font-weight:700;}','.ma-modal-body{padding:6px 16px 14px;font-size:13px;color:#555;}','.ma-modal-actions{display:flex;gap:10px;padding:0 16px 16px;}','.ma-modal-actions .ma-btn{flex:1;padding:8px 0;}',
        '#ma-toast{position:fixed;left:50%;bottom:80px;transform:translateX(-50%) translateY(10px);z-index:' + (Z_BASE + 400) + ';background:rgba(0,0,0,.8);color:#fff;padding:8px 18px;border-radius:20px;font-size:13px;opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;white-space:nowrap;}','#ma-toast.on{opacity:1;transform:translateX(-50%) translateY(0);}'
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
      FAB.style.left = x + 'px'; FAB.style.top = y + 'px'; FAB.style.right = 'auto'; FAB.style.bottom = 'auto'; FAB.style.width = size + 'px'; FAB.style.height = size + 'px';
    }, 'applyFabPosition');
  }
  function bindFabDrag() {
    safe(function () {
      if (!FAB || FAB.__maDragBound) return; FAB.__maDragBound = true;
      var dragging = false, startX = 0, startY = 0, originX = 0, originY = 0;
      function onDown(e) { try { if (e.pointerType === 'mouse' && e.button !== 0) return; dragging = true; FAB.__maMoved = false; var r = FAB.getBoundingClientRect(); startX = e.clientX; startY = e.clientY; originX = r.left; originY = r.top; FAB.style.transition = 'none'; if (FAB.setPointerCapture && e.pointerId != null) { try { FAB.setPointerCapture(e.pointerId); } catch (err) {} } e.preventDefault(); } catch (err) {} }
      function onMove(e) { try { if (!dragging) return; var dx = e.clientX - startX, dy = e.clientY - startY; if (!FAB.__maMoved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) FAB.__maMoved = true; if (!FAB.__maMoved) return; var size = FAB.offsetWidth || DB.settings.ballSize || 52, w = window.innerWidth, h = window.innerHeight; var x = clamp(originX + dx, 4, Math.max(4, w - size - 4)); var y = clamp(originY + dy, 4, Math.max(4, h - size - 4)); FAB.style.left = x + 'px'; FAB.style.top = y + 'px'; e.preventDefault(); } catch (err) {} }
      function onUp(e) { try { if (!dragging) return; dragging = false; FAB.style.transition = ''; if (FAB.__maMoved) { var size = FAB.offsetWidth || 52; DB.settings.ballPos = { x: clamp(parseFloat(FAB.style.left), 4, Math.max(4, window.innerWidth - size - 4)), y: clamp(parseFloat(FAB.style.top), 4, Math.max(4, window.innerHeight - size - 4)) }; saveData(); } if (FAB.releasePointerCapture && e.pointerId != null) { try { FAB.releasePointerCapture(e.pointerId); } catch (err) {} } } catch (err) {} }
      if (window.PointerEvent) { FAB.addEventListener('pointerdown', onDown); FAB.addEventListener('pointermove', onMove); FAB.addEventListener('pointerup', onUp); FAB.addEventListener('pointercancel', onUp); }
    }, 'bindFabDrag');
  }

  function injectAppIcon() {
    return safe(function () {
      if (APP_ICON_EL && document.body.contains(APP_ICON_EL)) return true;
      var natives = document.querySelectorAll('.app:not([data-ma-clone])'); if (!natives.length) return false;
      var src = null; for (var i = 0; i < natives.length; i++) { if (natives[i].offsetParent !== null && natives[i].getBoundingClientRect().width > 0) { src = natives[i]; break; } }
      if (!src) src = natives[0];
      var clone = null; try { clone = src.cloneNode(true); } catch (e) { return false; } if (!clone) return false;
      try { for (var ai = 0; ai < src.attributes.length; ai++) { var attr = src.attributes[ai]; if (attr.name.indexOf('data-') === 0 && attr.name !== 'data-ma-clone') clone.setAttribute(attr.name, attr.value + '_audit'); } } catch (e) {}
      if (clone.id) clone.removeAttribute('id');
      var ids = clone.querySelectorAll ? clone.querySelectorAll('[id]') : []; for (var k = 0; k < ids.length; k++) { try { ids[k].removeAttribute('id'); } catch (e2) {} }
      clone.removeAttribute('style'); var styled = clone.querySelectorAll ? clone.querySelectorAll('[style]') : []; for (var si = 0; si < styled.length; si++) { try { styled[si].removeAttribute('style'); } catch (e3) {} }
      try { var walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT, null, false); var textNodes = [], tn; while ((tn = walker.nextNode())) textNodes.push(tn); for (var ti = 0; ti < textNodes.length; ti++) textNodes[ti].nodeValue = ''; } catch (e6) {}
      var nameEl = null; try { nameEl = clone.querySelector('.app-name,.app-title,.app-label,.name,.title,.label,[class*="name"],[class*="label"],[class*="title"]'); } catch (e8) {}
      if (nameEl && !/^(IMG|SVG|CANVAS)$/i.test(nameEl.tagName || '')) nameEl.textContent = '审核';
      else { var span = document.createElement('div'); span.className = 'ma-clone-name'; span.textContent = '审核'; span.style.cssText = 'font-size:12px;line-height:1.4;text-align:center;width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'; try { clone.appendChild(span); } catch (e9) {} }
      
      // 修复：使用数字角标
      var dot = document.createElement('i'); dot.className = 'ma-app-badge'; try { clone.appendChild(dot); } catch (e10) {}
      
      clone.id = 'ma-app-icon'; clone.setAttribute('data-ma-clone', '1');
      try { APP_ICON_IMG_EL = clone.querySelector('.app-icon,.icon,img,svg,[class*="icon"]'); } catch (e11) { APP_ICON_IMG_EL = null; }
      var grid = document.querySelector('.app-grid'); if (grid) grid.appendChild(clone); else if (src.parentNode) src.parentNode.insertBefore(clone, src.nextSibling); else return false;
      APP_ICON_EL = clone;
      var pdX = 0, pdY = 0, pdMoved = false;
      clone.addEventListener('pointerdown', function (e) { pdX = e.clientX; pdY = e.clientY; pdMoved = false; }, true);
      clone.addEventListener('pointermove', function (e) { if (Math.abs(e.clientX - pdX) > 6 || Math.abs(e.clientY - pdY) > 6) pdMoved = true; }, true);
      clone.addEventListener('click', function (e) { if (pdMoved) { pdMoved = false; return; } try { e.preventDefault(); e.stopPropagation(); } catch (err) {} openPanel(); }, true);
      applyVisibility(); applyAppearance(); updateBadge(); return true;
    }, 'injectAppIcon', false);
  }
  function startAppIconWatcher() { safe(function () { var tries = 0; if (appIconInjectTimer) clearInterval(appIconInjectTimer); if (injectAppIcon()) return; appIconInjectTimer = setInterval(function () { safe(function () { tries++; if (injectAppIcon() || tries >= 40) { clearInterval(appIconInjectTimer); appIconInjectTimer = null; } }, 'appIconWatcher:tick'); }, 800); }, 'startAppIconWatcher'); }
  function refreshAppIcon() { safe(function () { if (APP_ICON_EL && APP_ICON_EL.parentNode) { try { APP_ICON_EL.parentNode.removeChild(APP_ICON_EL); } catch (e) {} } APP_ICON_EL = null; APP_ICON_IMG_EL = null; injectAppIcon(); }, 'refreshAppIcon'); }

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
      if (APP_ICON_EL && s.appImage) {
        var holder = APP_ICON_IMG_EL || APP_ICON_EL;
        try { if (holder.tagName === 'IMG') holder.src = s.appImage; else if (holder.tagName === 'SVG') { APP_ICON_EL.style.backgroundImage = 'url("' + s.appImage + '")'; APP_ICON_EL.style.backgroundSize = 'cover'; APP_ICON_EL.style.backgroundPosition = 'center'; } else { holder.style.backgroundImage = 'url("' + s.appImage + '")'; holder.style.backgroundSize = 'cover'; holder.style.backgroundPosition = 'center'; } } catch (e) {}
      } else if (APP_ICON_EL && !s.appImage && APP_ICON_IMG_EL) { try { if (APP_ICON_IMG_EL.tagName !== 'IMG' && APP_ICON_IMG_EL.tagName !== 'SVG') APP_ICON_IMG_EL.style.backgroundImage = ''; } catch (e2) {} }
    }, 'applyAppearance');
  }
  
  // 修复：红点改成数字显示
  function updateBadge() { 
    safe(function () { 
      var n = pendingCount(); 
      
      var f = FAB ? FAB.querySelector('.ma-fab-dot') : null; 
      if (f) { if (n > 0) f.classList.add('on'); else f.classList.remove('on'); } 
      
      var a = APP_ICON_EL ? APP_ICON_EL.querySelector('.ma-app-badge') : null; 
      if (a) { 
        if (n > 0) { a.textContent = n > 99 ? '99+' : n; a.style.display = 'flex'; } 
        else { a.style.display = 'none'; } 
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
    var h = '', actM = { add: '新增', delete: '删除', disable: '禁用', enable: '启用', move: '迁移' }, clsM = { add: 'add', delete: 'del', disable: 'dis', enable: 'en', move: 'mv' };
    for (var i = 0; i < pending.length; i++) {
      var p = pending[i];
      h += '<div class="ma-pending-item" data-pid="' + esc(p.id) + '"><div class="ma-pending-top"><span class="ma-act-tag ' + (clsM[p.action] || '') + '">' + (actM[p.action] || p.action) + '</span><span class="ma-sender">来自 <b>' + esc(p.sender) + '</b> · ' + esc(fmtRelative(p.time)) + '</span></div><div class="ma-pending-text">' + esc(p.text) + '</div>';
      if (p.note) h += '<div class="ma-pending-note">' + esc(p.note) + '</div>';
      if (p.action === 'add') {
        h += '<div class="ma-row" style="margin:4px 0 6px;"><span class="ma-label">存入分类：</span><select class="ma-select" data-sel-group style="flex:1;">';
        if (!DB.groups.length) h += '<option value="">(自动创建默认分类)</option>';
        else for (var gi = 0; gi < DB.groups.length; gi++) h += '<option value="' + esc(DB.groups[gi].id) + '"' + (DB.groups[gi].id === p.toGroupId ? ' selected' : '') + '>' + esc(DB.groups[gi].name) + '</option>';
        h += '</select></div>';
      }
      if (p.action === 'move') h += '<div style="font-size:12px;color:#888;margin:2px 0 6px;">迁移：<b>' + esc(p.fromGroupName) + '</b> → <b>' + esc(p.toGroupName) + '</b></div>';
      h += '<div class="ma-pending-actions"><button class="ma-btn sm" data-pact="reject">拒绝</button><button class="ma-btn sm primary" data-pact="approve">同意</button></div></div>';
    }
    return h;
  }
  function bindPendingEvents(body) {
    safe(function () {
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
    for (var i = 0; i < arr.length; i++) { var it = arr[i]; h += '<div class="ma-history-item"><div class="ma-history-main"><div class="ma-history-text"><span class="ma-act-tag ' + (clsM[it.action] || '') + '" style="margin-right:6px;">' + (actM[it.action] || it.action) + '</span>' + esc(it.text) + '</div><div class="ma-history-meta">' + esc(it.sender) + ' · ' + esc(fmtTime(it.time)) + '</div></div><span class="ma-res ' + (it.result === 'agree' ? 'agree' : 'reject') + '">' + (it.result === 'agree' ? '已同意' : '已拒绝') + '</span></div>'; }
    return h;
  }

  function ensureOpenGroupsState() { if (OPEN_GROUPS === null) { OPEN_GROUPS = {}; for (var i = 0; i < DB.groups.length; i++) OPEN_GROUPS[DB.groups[i].id] = true; } }
  function renderCardsTab() {
    ensureOpenGroupsState();
    var h = '';
    h += '<div class="ma-set-block" style="background:#fafafa;">';
    h += '<div style="font-size:12px;color:#666;margin-bottom:8px;">手动输入要添加的字卡内容，提交后进入待审核（发件人：我）</div>';
    h += '<textarea class="ma-textarea" id="ma-manual-input" placeholder="输入字卡内容..."></textarea>';
    h += '<div class="ma-row" style="margin-top:8px;margin-bottom:0;">';
    h += '<select class="ma-select" id="ma-manual-group" style="width:120px;">';
    for (var gi = 0; gi < DB.groups.length; gi++) h += '<option value="' + esc(DB.groups[gi].id) + '">' + esc(DB.groups[gi].name) + '</option>';
    h += '</select>';
    h += '<button class="ma-btn primary" id="ma-manual-submit" style="flex:1;">提交审核</button>';
    h += '</div></div>';

    h += '<div class="ma-bulkbar"><label style="display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" id="ma-sel-all"> 全选</label><span id="ma-sel-count" style="color:#888;">已选 0 个</span><button class="ma-btn sm danger" id="ma-bulk-del">批量删除</button><select class="ma-select" id="ma-bulk-target" style="width:auto;flex:1;min-width:80px;"><option value="">转移目标…</option>';
    for (var gi = 0; gi < DB.groups.length; gi++) h += '<option value="' + esc(DB.groups[gi].id) + '">' + esc(DB.groups[gi].name) + '</option>';
    h += '</select><button class="ma-btn sm" id="ma-bulk-move">转移</button></div>';

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
            DB.pending.push({ id: uid('p'), action: 'add', text: txt, cardId: '', fromGroupId: '', fromGroupName: '', toGroupId: manGroup ? manGroup.value : '', toGroupName: '', sender: SENDER_ME, auto: false, time: Date.now(), status: 'pending', note: '我手动提交的申请' });
            saveData(); toast('已提交审核'); manInput.value = ''; renderPanelBody(); updateBadge();
          }, 'manualSubmit');
        });
      }

      var newBtn = body.querySelector('#ma-new-group'), newInput = body.querySelector('#ma-new-group-name');
      if (newBtn && newInput) { newBtn.addEventListener('click', function () { safe(function () { var n = String(newInput.value || '').trim(); if (!n) { toast('请输入名称'); return; } DB.groups.push({ id: uid('g'), name: n, disabledBy: [], cards: [] }); if (OPEN_GROUPS) OPEN_GROUPS[DB.groups[DB.groups.length - 1].id] = true; saveData(); renderPanelBody(); toast('已创建'); }, 'newGroup'); }); newInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') newBtn.click(); }); }
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
          var cards = grp.querySelectorAll('.ma-card-check');
          var allChecked = cards.length > 0;
          var anyChecked = false;
          for (var i = 0; i < cards.length; i++) { if (cards[i].checked) anyChecked = true; else allChecked = false; }
          gcb.checked = allChecked;
          gcb.indeterminate = anyChecked && !allChecked;
        });
      }

      var selAll = body.querySelector('#ma-sel-all'); 
      if (selAll) selAll.addEventListener('change', function () { 
          eachNode(body, '.ma-card-check', function (cb) { cb.checked = selAll.checked; }); 
          updCount(); 
      });

      eachNode(body, '.ma-card-check', function (cb) { cb.addEventListener('change', updCount); });

      eachNode(body, '.ma-group-select', function (cb) {
        cb.addEventListener('change', function (e) {
          e.stopPropagation();
          var gid = cb.getAttribute('data-gid');
          var grp = body.querySelector('.ma-group[data-gid="' + gid + '"]');
          if (!grp) return;
          var isChecked = cb.checked;
          eachNode(grp, '.ma-card-check', function (cardCb) { cardCb.checked = isChecked; });
          updCount();
        });
      });

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
        if (card.disabledBy.length > 0) {
            card.disabledBy = [];
        } else {
            card.disabledBy.push('user');
        }
        saveData(); renderPanelBody(); return; 
    }
    
    if (act === 'delete') { confirmModal({ title: '删除字卡', body: '确定删除？', danger: true, okText: '删除', onOk: function () { safe(function () { f.group.cards = f.group.cards.filter(function (x) { return x.id !== cid; }); saveData(); renderPanelBody(); toast('已删除'); }, 'delCardApply'); } }); return; }
  }

  function sendCardToChat(cid) {
    safe(function () {
      var f = findCard(cid); if (!f) { toast('不存在'); return; } var text = f.card.text; if (!text) { toast('为空'); return; }
      var ok = injectBubbleToChat(text);
      if (ok) toast('已发送'); else toast('消息已保存，刷新后可见');
    }, 'sendCardToChat');
  }

  function renderSettingsTab() {
    var s = DB.settings, h = '';
    h += '<div class="ma-set-block"><div class="ma-set-title">悬浮球外观</div><div class="ma-row"><span class="ma-label" style="width:52px;">颜色</span><input type="color" id="ma-set-color" value="' + esc(s.ballColor) + '" style="width:46px;height:28px;border:1px solid #eee;border-radius:6px;padding:0;cursor:pointer;"><span style="font-size:11px;color:#bbb;">' + esc(s.ballColor) + '</span></div>';
    h += '<div class="ma-row"><span class="ma-label" style="width:52px;">大小</span><input type="range" class="ma-range" id="ma-set-size" min="36" max="88" step="1" value="' + s.ballSize + '"><span class="ma-label" id="ma-set-size-val" style="width:44px;text-align:right;">' + s.ballSize + 'px</span></div>';
    h += '<div class="ma-row"><div class="ma-thumb" id="ma-set-ball-thumb" style="' + (s.ballImage ? 'background-image:url(&quot;' + s.ballImage + '&quot;);' : 'background:' + esc(s.ballColor) + ';') + '"></div><button class="ma-btn sm" id="ma-set-ball-upload">上传图片</button>' + (s.ballImage ? '<button class="ma-btn sm danger" id="ma-set-ball-clear">移除</button>' : '') + '</div></div>';
    h += '<div class="ma-set-block"><div class="ma-set-title">审核图标外观</div><div class="ma-row"><div class="ma-thumb square" id="ma-set-app-thumb" style="' + (s.appImage ? 'background-image:url(&quot;' + s.appImage + '&quot;);' : 'background:#f5f5f5;') + '"></div><button class="ma-btn sm" id="ma-set-app-upload">上传图片</button>' + (s.appImage ? '<button class="ma-btn sm danger" id="ma-set-app-clear">移除</button>' : '') + '</div></div>';
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
      var au = body.querySelector('#ma-set-app-upload'); if (au) au.addEventListener('click', function () { openCropper({ title: '裁剪图标', shape: 'square', onConfirm: function (d) { safe(function () { DB.settings.appImage = d; saveData(); applyAppearance(); renderPanelBody(); toast('已更新'); }, 'appImg'); } }); });
      var ac = body.querySelector('#ma-set-app-clear'); if (ac) ac.addEventListener('click', function () { safe(function () { DB.settings.appImage = ''; saveData(); refreshAppIcon(); applyAppearance(); renderPanelBody(); toast('已移除'); }, 'appClr'); });
      var hd = body.querySelector('#ma-set-hide'); if (hd) hd.addEventListener('click', function () { safe(function () { DB.settings.hideAll = !DB.settings.hideAll; saveData(); hd.classList.toggle('on', DB.settings.hideAll); applyVisibility(); toast(DB.settings.hideAll ? '悬浮球已隐藏，可通过原生图标恢复' : '悬浮球已恢复'); }, 'hideSet'); });
      
      var exp = body.querySelector('#ma-export'); if (exp) exp.addEventListener('click', function () { safe(function () { var blob = new Blob([JSON.stringify({ __ma_backup: true, exportedAt: Date.now(), data: DB }, null, 2)], { type: 'application/json' }); var url = URL.createObjectURL(blob), a = document.createElement('a'), d = new Date(); a.href = url; a.download = 'audit-backup-' + d.getTime() + '.json'; document.body.appendChild(a); a.click(); setTimeout(function () { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (e) {} }, 200); toast('已导出'); }, 'export'); });
      var imp = body.querySelector('#ma-import'), impf = body.querySelector('#ma-import-file'); if (imp && impf) { imp.addEventListener('click', function () { impf.click(); }); impf.addEventListener('change', function () { safe(function () { var f = impf.files && impf.files[0]; if (!f) return; var fr = new FileReader(); fr.onload = function () { safe(function () { var obj = JSON.parse(fr.result), inc = obj && obj.__ma_backup ? obj.data : obj; if (!inc) { toast('格式错误'); return; } confirmModal({ title: '确认导入', body: '将覆盖当前所有数据，是否继续？', danger: true, okText: '覆盖', onOk: function () { safe(function () { DB = normalizeData(inc); saveData(); applyAppearance(); applyFabPosition(); applyVisibility(); refreshAppIcon(); renderTabs(); renderPanelBody(); updateBadge(); toast('导入成功'); }, 'impApply'); } }); }, 'impParse'); }; fr.readAsText(f, 'utf-8'); }, 'impChange'); }); }
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
      mask.innerHTML = '<div class="ma-crop-box"><div class="ma-crop-title">' + esc(o.title) + '</div><div class="ma-crop-stage"><div class="ma-crop-canvas-wrap" id="ma-crop-wrap" style="width:' + SIZE + 'px;height:' + SIZE + 'px;border-radius:' + radius + ';overflow:hidden;box-shadow:0 0 0 9999px rgba(0,0,0,.32),0 0 0 1px rgba(255,255,255,.5);"><canvas class="ma-crop-canvas" id="ma-crop-canvas"></canvas></div></div><div class="ma-crop-hint">拖动图片调整位置</div><div class="ma-crop-zoom"><span style="font-size:12px;color:#999;">缩放</span><input type="range" id="ma-crop-zoom" min="1" max="3" step="0.01" value="1"></div><div class="ma-crop-actions"><button class="ma-btn" id="ma-crop-cancel">取消</button><button class="ma-btn primary" id="ma-crop-ok">确认</button></div></div>';
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
    startAppIconWatcher(); startEngine(); startGuard();
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
