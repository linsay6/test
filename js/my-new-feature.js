// ==UserScript==
// @name         Mochi梦角字卡·双人审核完整版
// @namespace    https://github.com/yourname/yourrepo
// @version      3.2.0
// @description  九宫格审核图标、悬浮球、梦角引擎、双人审批、审核报告字卡Tab、圆形/方形裁剪、移动端顺滑拖拽
// @author       You
// @match        *://*/*
// @grant        none
// @run-at       document-end
// ==/UserScript==
(function () {
  'use strict';
  /* ============================================================
     0. 全局基础层：常量 / 存储 / 工具 / 全局样式
     ============================================================ */
  const STORAGE_CHAT_KEY = 'xy-home-v2:default:chat-msgs';
  const STORAGE_AUDIT_KEY = 'my-audit-cards';
  const DEFAULT_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 20h9"></path>' +
    '<path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>' +
    '</svg>';
  const AUDIT_ICON_TEMPLATE =
    '<div class="app" data-app="audit" data-desk-widget="app-audit">' +
      '<div class="app-ico">' + DEFAULT_ICON_SVG + '</div>' +
      '<div class="app-name">审核</div>' +
    '</div>';

  function deepClone(obj) {
    try { return JSON.parse(JSON.stringify(obj)); }
    catch (e) { return obj; }
  }
  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function formatTime(date) {
    const d = date instanceof Date ? date : new Date(date || Date.now());
    const pad = n => String(n).padStart(2, '0');
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function defaultData() {
    return {
      categories: [
        { id: 'cat-biaodian', name: '标点', disabled: false, collapsed: false, order: 1, cards: [] },
        { id: 'cat-qinghua', name: '情话', disabled: false, collapsed: false, order: 2, cards: [] },
        { id: 'cat-biaobai', name: '表白', disabled: false, collapsed: false, order: 3, cards: [] }
      ],
      pending: [],
      history: [],
      settings: {
        iconCustom: null,
        floatingBall: {
          enabled: true,
          color: '#3b82f6',
          size: 56,
          avatar: null,
          position: { x: 0, y: 0 }
        },
        dreamEngine: {
          enabled: true,
          interval: 30 * 60 * 1000,
          baseProbability: 0.05,
          emotionProbability: 0.3,
          maxPending: 5,
          chaosProbability: 0.02
        }
      }
    };
  }
  function migrateLegacy(raw) {
    try {
      if (!raw || typeof raw !== 'object') return null;
      const hasLegacy = Array.isArray(raw.groups) && Array.isArray(raw.cards);
      const hasNew = Array.isArray(raw.categories) && raw.categories.length > 0;
      if (!hasLegacy || hasNew) return raw;
      const categories = raw.groups.map((g, i) => ({
        id: g.id || ('cat-' + i),
        name: g.name || ('分类' + (i + 1)),
        disabled: !!g.disabled,
        collapsed: !!g.collapsed,
        order: typeof g.order === 'number' ? g.order : i,
        cards: []
      }));
      if (categories.length === 0) {
        categories.push({ id: 'cat-default', name: '默认分组', disabled: false, collapsed: false, order: 0, cards: [] });
      }
      raw.cards.forEach(c => {
        let target = categories.find(x => x.id === c.groupId);
        if (!target) target = categories[0];
        target.cards.push({
          id: c.id || genId(),
          text: c.text || '',
          disabled: !!c.disabled,
          disabledType: c.disabledType || 'single',
          createTime: c.createTime || Date.now()
        });
      });
      raw.categories = categories;
      raw.pending = (raw.auditPending || raw.pending || []).map(normalizePending);
      raw.history = raw.auditHistory || raw.history || [];
      delete raw.groups;
      delete raw.cards;
      delete raw.auditPending;
      delete raw.auditHistory;
      return raw;
    } catch (e) {
      console.warn('[Audit] 旧数据迁移失败，使用默认数据', e);
      return null;
    }
  }
  function normalizePending(p) {
    const actionMap = { add: 'add', delete: 'delete', disable: 'disable', move: 'move', migrate: 'move', restore: 'restore' };
    const action = actionMap[p.action] || actionMap[p.type] || 'add';
    return {
      id: p.id || genId(),
      action: action,
      sender: p.sender || '梦角',
      time: p.time || Date.now(),
      targetText: p.targetText || p.text || '',
      targetCategory: p.targetCategory || p.targetGroupId || null,
      targetCatName: p.targetCatName || null,
      sourceCatId: p.sourceCatId || null,
      sourceCatName: p.sourceCatName || null,
      cardId: p.cardId || null,
      disabledType: p.disabledType || 'single'
    };
  }
  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_AUDIT_KEY);
      if (!raw) return defaultData();
      let parsed = null;
      try { parsed = JSON.parse(raw); }
      catch (e) {
        console.warn('[Audit] 审核数据损坏，安全重置', e);
        return defaultData();
      }
      parsed = migrateLegacy(parsed) || {};
      const base = defaultData();
      const merged = {
        categories: Array.isArray(parsed.categories) && parsed.categories.length ? parsed.categories : base.categories,
        pending: Array.isArray(parsed.pending) ? parsed.pending.map(normalizePending) : [],
        history: Array.isArray(parsed.history) ? parsed.history.slice(-100) : [],
        settings: {
          iconCustom: parsed.settings && parsed.settings.iconCustom ? parsed.settings.iconCustom : null,
          floatingBall: Object.assign({}, base.settings.floatingBall, (parsed.settings || {}).floatingBall || {}),
          dreamEngine: Object.assign({}, base.settings.dreamEngine, (parsed.settings || {}).dreamEngine || {})
        }
      };
      merged.categories.forEach((c, i) => {
        c.id = c.id || genId();
        c.name = c.name || ('分类' + (i + 1));
        c.disabled = !!c.disabled;
        c.collapsed = !!c.collapsed;
        c.order = typeof c.order === 'number' ? c.order : i;
        c.cards = Array.isArray(c.cards) ? c.cards : [];
        c.cards.forEach(card => {
          card.id = card.id || genId();
          card.text = card.text || '';
          card.disabled = !!card.disabled;
          card.disabledType = card.disabledType || 'single';
        });
      });
      return merged;
    } catch (e) {
      console.warn('[Audit] 存储读取异常，使用默认数据', e);
      return defaultData();
    }
  }
  function saveData(data) {
    try {
      localStorage.setItem(STORAGE_AUDIT_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn('[Audit] 存储写入失败', e);
      return false;
    }
  }
  function injectCSS(css, id) {
    try {
      const styleId = id || 'my-audit-global-css';
      if (document.getElementById(styleId)) return;
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    } catch (e) {
      console.warn('[Audit] CSS注入失败', e);
    }
  }
    function toast(msg, color) {
    try {
      let box = document.getElementById('audit-toast');
      if (!box) {
        box = document.createElement('div');
        box.id = 'audit-toast';
        box.style.cssText = 'position:fixed;left:50%;bottom:80px;transform:translateX(-50%);' +
          'padding:8px 14px;border-radius:8px;background:rgba(17,24,39,.9);color:#fff;' +
          'font-size:13px;z-index:100002;pointer-events:none;opacity:0;transition:opacity .2s;';
        document.body.appendChild(box);
      }
      box.textContent = msg;
      box.style.background = color || 'rgba(17,24,39,.9)';
      box.style.opacity = '1';
      clearTimeout(box._timer);
      box._timer = setTimeout(() => { box.style.opacity = '0'; }, 2200);
    } catch (e) {}
  }
  // ========== 新增：梦角新申请 / 新消息通知函数 ==========
  async function requestAuditNotify(title, body) {
    // 页面内toast强提醒
    toast(title + "：" + body, '#3b82f6');
    // 浏览器系统通知（手机切后台可用，需要用户授权）
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    if (Notification.permission === 'granted') {
      new Notification(title, {
        body: body,
        icon: "data:image/svg+xml," + encodeURIComponent(DEFAULT_ICON_SVG),
        tag: "mochi-audit-notify"
      });
    }
  }
  const state = loadData();
  window.__MY_AUDIT__ = {
    data: state,
    save: function () {
      saveData(window.__MY_AUDIT__.data);
      try { window.dispatchEvent(new CustomEvent('my-audit-data-updated')); } catch (e) {}
    },
    reload: function () {
      window.__MY_AUDIT__.data = loadData();
      try { window.dispatchEvent(new CustomEvent('my-audit-data-updated')); } catch (e) {}
    },
    STORAGE: { chat: STORAGE_CHAT_KEY, audit: STORAGE_AUDIT_KEY }
  };

  injectCSS(`
    /* ---------- 审核图标与角标 ---------- */
    .app[data-app="audit"] { position: relative; }
    .app[data-app="audit"] .app-ico img {
      width: 100%; height: 100%; object-fit: cover;
      border-radius: 14px; display: block;
    }
    .audit-badge {
      position: absolute; top: -2px; right: 2px;
      min-width: 18px; height: 18px; line-height: 16px;
      padding: 0 4px; background: #fff;
      border: 1px solid #e5e7eb; border-radius: 9px;
      font-size: 11px; color: #111827; text-align: center;
      box-sizing: border-box; pointer-events: none; z-index: 3;
    }
    .audit-badge[data-count="0"] { display: none !important; }
    /* 装修编辑模式：黑框 + 抖动，对齐原生 */
    .edit-mode .app[data-app="audit"],
    .desk-edit .app[data-app="audit"],
    .decoration-mode .app[data-app="audit"] {
      outline: 1px dashed #111;
      animation: audit-shake .5s infinite;
    }
    @keyframes audit-shake {
      0%, 100% { transform: translateX(0); }
      25% { transform: translateX(-2px); }
      75% { transform: translateX(2px); }
    }

    /* ---------- 悬浮球（修复问题2：角标外露 / 问题4：顺滑） ---------- */
    #audit-floating-ball {
      position: fixed; left: 0; top: 0;
      border-radius: 50%;
      overflow: visible;
      cursor: pointer; user-select: none;
      touch-action: none;
      -webkit-user-select: none;
      -webkit-tap-highlight-color: transparent;
      box-shadow: none;
      will-change: transform;
      transform: translate3d(0,0,0);
      z-index: 99990;
      color: #fff; font-size: 20px;
    }
    #audit-floating-ball .ball-bg {
      width: 100%; height: 100%; border-radius: 50%;
      overflow: hidden; display: flex; align-items: center; justify-content: center;
      background: inherit;
      pointer-events: none;
      font-size: 20px;
      color: #fff;
    }
    #audit-floating-ball img {
      width: 100%; height: 100%; object-fit: cover; display: block; border-radius: 50%;
    }
    #audit-floating-ball .audit-badge {
      position: absolute;
      top: -4px; right: -4px;
      min-width: 18px; height: 18px; line-height: 16px;
      font-size: 11px; padding: 0 4px;
      background: #ef4444; color: #fff;
      border: 2px solid #fff;
      border-radius: 9px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.25);
      box-sizing: content-box;
    }
    #audit-floating-ball .audit-badge[data-count="0"] { display: none !important; }

    /* ---------- 审核面板 ---------- */
    #audit-panel-mask {
      position: fixed; inset: 0; background: rgba(0,0,0,.45);
      z-index: 100000; display: none; align-items: center; justify-content: center;
    }
    #audit-panel {
      width: 880px; max-width: 94vw; height: 600px; max-height: 86vh;
      background: #fff; border-radius: 12px; overflow: hidden;
      display: flex; flex-direction: column;
      font-size: 13px; color: #111827;
    }
    .audit-panel-header {
      padding: 14px 18px; border-bottom: 1px solid #eef0f3;
      display: flex; align-items: center; justify-content: space-between;
    }
    .audit-panel-title { font-size: 16px; font-weight: 600; }
    .audit-panel-close { cursor: pointer; font-size: 20px; color: #6b7280; line-height: 1; background: none; border: none; }
    .audit-tabs { display: flex; gap: 22px; padding: 0 18px; border-bottom: 1px solid #eef0f3; }
    .audit-tab {
      padding: 11px 0; cursor: pointer; color: #6b7280; font-size: 14px;
      border: none; background: none; border-bottom: 2px solid transparent;
      position: relative;
    }
    .audit-tab.active { color: #111827; border-bottom-color: #3b82f6; font-weight: 600; }
    .audit-tab-badge {
      display: inline-block;
      min-width: 18px; height: 18px; line-height: 18px;
      padding: 0 5px; margin-left: 4px;
      background: #ef4444; color: #fff;
      border-radius: 9px; font-size: 11px; font-weight: normal;
      text-align: center; vertical-align: middle;
    }
    .audit-tab-badge[hidden] { display: none !important; }
    .audit-tab-content { flex: 1; overflow-y: auto; padding: 14px 18px; }
    .audit-tab-pane { display: none; }
    .audit-tab-pane.active { display: block; }

    /* ---------- 通用按钮/表单 ---------- */
    .audit-btn {
      padding: 5px 10px; border-radius: 6px; border: 1px solid #d1d5db;
      background: #fff; color: #374151; cursor: pointer; font-size: 12px;
    }
    .audit-btn:hover { background: #f9fafb; }
    .audit-btn-primary { background: #3b82f6; border-color: #3b82f6; color: #fff; }
    .audit-btn-primary:hover { background: #2f6fd8; }
    .audit-btn-danger { background: #ef4444; border-color: #ef4444; color: #fff; }
    .audit-btn-danger:hover { background: #dc2626; }
    .audit-btn-ghost { background: #fff; }
    .audit-btn-sm { padding: 3px 8px; font-size: 11px; }

    /* ---------- 待审核 ---------- */
    .audit-batch-bar {
      display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
      margin-bottom: 10px; font-size: 12px; color: #6b7280;
    }
    .audit-pending-item {
      padding: 12px; border: 1px solid #eef0f3; border-radius: 10px;
      margin-bottom: 8px; display: flex; gap: 10px; align-items: flex-start;
    }
    .audit-pending-info { flex: 1; min-width: 0; }
    .audit-pending-type {
      display: inline-block; padding: 1px 6px; border-radius: 4px;
      font-size: 11px; margin-right: 6px;
    }
    .type-add { background: #dcfce7; color: #166534; }
    .type-delete { background: #fee2e2; color: #991b1b; }
    .type-disable { background: #fef3c7; color: #92400e; }
    .type-move { background: #dbeafe; color: #1e40af; }
    .type-restore { background: #f3e8ff; color: #6b21a8; }
    .audit-pending-desc { font-size: 13px; color: #111827; margin: 4px 0; word-break: break-all; }
    .audit-pending-sender { font-size: 11px; color: #9ca3af; }
    .audit-pending-extra { margin-top: 6px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .audit-pending-actions { display: flex; gap: 6px; flex-shrink: 0; }
    .audit-select {
      padding: 4px 6px; border: 1px solid #d1d5db; border-radius: 6px;
      font-size: 12px; background: #fff; max-width: 150px;
    }
    .audit-input {
      padding: 6px 9px; border: 1px solid #d1d5db; border-radius: 6px;
      font-size: 12px; box-sizing: border-box; width: 100%;
    }

    /* ---------- 历史 ---------- */
    .audit-history-item {
      padding: 9px 10px; border-bottom: 1px solid #f3f4f6;
      display: flex; justify-content: space-between; gap: 10px; font-size: 12px;
    }
    .audit-history-result { font-weight: 600; flex-shrink: 0; }
    .result-approve { color: #166534; }
    .result-reject { color: #991b1b; }

    /* ---------- 设置 ---------- */
    .settings-section { margin-bottom: 18px; }
    .settings-section h4 { margin: 0 0 10px; font-size: 13px; color: #374151; }
    .settings-row {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px; margin-bottom: 9px; font-size: 12px;
    }
    .settings-row > .settings-label {
      min-width: 96px; color: #6b7280; flex-shrink: 0;
    }
    .settings-row > .settings-controls {
      display: flex; align-items: center; gap: 8px;
      justify-content: flex-end; flex: 1;
    }
    .settings-row .audit-input[type="range"] { flex: 1; max-width: 260px; }
    .settings-row input[type="color"] {
      width: 34px; height: 24px; border: 1px solid #d1d5db;
      border-radius: 4px; padding: 0; cursor: pointer;
    }
    .icon-preview {
      width: 44px; height: 44px;
      overflow: hidden; display: flex; align-items: center; justify-content: center;
      background: #fff; flex-shrink: 0;
    }
    .icon-preview img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .icon-preview.rect { border-radius: 14px; border: 1px solid #e5e7eb; }
    .icon-preview.circle { border-radius: 50%; border: 1px solid #e5e7eb; }

    /* ---------- 图片裁剪弹窗 ---------- */
    .audit-cropper-modal {
      position: fixed; inset: 0; background: rgba(0,0,0,.55);
      display: flex; align-items: center; justify-content: center;
      z-index: 100003;
    }
    .audit-cropper-box {
      background: #fff; border-radius: 14px; padding: 18px;
      width: 340px; max-width: 92vw;
      box-shadow: 0 20px 40px rgba(0,0,0,.2);
    }
    .audit-cropper-header {
      font-weight: 600; font-size: 14px; margin-bottom: 14px; text-align: center;
      color: #111827;
    }
    .audit-cropper-canvas-wrap {
      position: relative;
      width: 220px; height: 220px;
      margin: 0 auto 14px;
      background: #f3f4f6;
      overflow: hidden;
    }
    .audit-cropper-canvas { display: block; width: 220px; height: 220px; }
    .audit-cropper-mask {
      position: absolute; inset: 0; pointer-events: none;
      box-shadow: 0 0 0 2000px rgba(0,0,0,.35);
    }
    .audit-cropper-mask.circle { border-radius: 50%; }
    .audit-cropper-mask.square { border-radius: 14px; }
    .audit-cropper-slider-wrap { padding: 0 10px; margin-bottom: 14px; }
    .audit-cropper-slider-wrap input[type="range"] { width: 100%; }
    .audit-cropper-btns { display: flex; gap: 8px; justify-content: center; }
    .audit-cropper-btns .audit-btn { flex: 1; padding: 8px; }
    .audit-cropper-btns .audit-btn-primary { background: #f43f5e; border-color: #f43f5e; }
    .audit-cropper-btns .audit-btn-primary:hover { background: #e11d48; }

    /* ---------- 模块二：字卡库 Tab ---------- */
    #cc-sect-audit {
      display: flex; flex-direction: column; gap: 10px;
      box-sizing: border-box; padding: 2px 0 12px;
    }
    #cc-sect-audit[hidden] { display: none !important; }
        /* 重点：只给我们新增的审核tab生效active样式！原生tab不受这个css影响！ */
    [data-ccsel="audit"].cc-tab-active {
      background: #000 !important;
      color: #fff !important;
      border-color: #000 !important;
    }
    .cc-tab-badge {
      display: inline-block;
      min-width: 20px; height: 20px; line-height: 20px;
      padding: 0 6px; margin-left: 4px;
      background: #f3f4f6; color: #374151;
      border-radius: 10px; font-size: 12px; font-weight: 500;
      text-align: center; vertical-align: middle;
    }
    .cc-tab-active .cc-tab-badge {
      background: rgba(255,255,255,.2);
      color: #fff;
    }

    .cc-audit-toolbar { display: flex; flex-direction: column; gap: 8px; margin-bottom: 6px; }
    .cc-audit-toolbar-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .cc-audit-textarea {
      width: 100%; min-height: 64px; resize: vertical;
      padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 8px;
      font-size: 13px; box-sizing: border-box; line-height: 1.5;
    }
    .cc-audit-list { display: flex; flex-direction: column; gap: 8px; }
    .cc-group { border: 1px solid #eef0f3; border-radius: 10px; overflow: hidden; }
    .cc-group-head {
      display: flex; align-items: center; gap: 8px;
      padding: 9px 12px; background: #fafbfc; cursor: pointer; flex-wrap: wrap;
    }
    .cc-group-title { font-size: 13px; font-weight: 600; color: #111827; }
    .cc-group-title.disabled { color: #9ca3af; text-decoration: line-through; }
    .cc-group-count { font-size: 11px; color: #9ca3af; }
    .cc-group-ops { margin-left: auto; display: flex; gap: 4px; flex-wrap: wrap; }
    .cc-fold { display: inline-block; width: 12px; font-size: 11px; color: #6b7280; transition: transform .15s; }
    .cc-fold.open { transform: rotate(90deg); }
    .cc-group-body { display: flex; flex-direction: column; gap: 6px; padding: 8px 12px 10px; }
    .cc-group-body[hidden] { display: none !important; }
    .cc-card {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 8px; border: 1px solid #f3f4f6; border-radius: 8px;
      background: #fff;
    }
    .cc-card.cc-card-disabled { background: #fafafa; }
    .cc-card-text { flex: 1; font-size: 12px; color: #111827; word-break: break-all; }
    .cc-card-text.disabled { color: #9ca3af; text-decoration: line-through; }
    .cc-card-ops { display: flex; gap: 4px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
    .cc-badge {
      font-size: 10px; padding: 0 4px; border-radius: 3px; flex-shrink: 0;
      border: 1px solid #fecaca; color: #ef4444; background: #fff;
    }
    .cc-badge.both { border-color: #fca5a5; color: #991b1b; background: #fff5f5; }
    .cc-check { width: 14px; height: 14px; cursor: pointer; flex-shrink: 0; }
    .cc-audit-empty { padding: 30px 0; text-align: center; color: #9ca3af; font-size: 12px; }
  `);

  /* ============================================================
     模块一：九宫格审核图标 + 悬浮球 + 梦角引擎 + 审批面板 + 消息发送
     ============================================================ */
  (function Module1_AuditEntry() {
    let panelMask = null;
    let engineTimer = null;
    let engineLock = false;
    let observerTimer = null;
    const injectedRegistry = [];

    /* ---------------- 图标 ---------------- */
    function getDeskContainer() {
      return document.querySelector(
        '.desk-widgets, .app-grid, .nine-grid, .widget-container, [data-desk-area="widgets"]'
      );
    }
    function buildIconNode() {
      const wrap = document.createElement('div');
      wrap.innerHTML = AUDIT_ICON_TEMPLATE.trim();
      return wrap.firstElementChild;
    }
    function applyCustomIcon(iconEl) {
      try {
        const icoEl = iconEl.querySelector('.app-ico');
        if (!icoEl) return;
        const custom = window.__MY_AUDIT__.data.settings.iconCustom;
        if (custom) {
          icoEl.innerHTML = '<img src="' + custom + '" alt="">';
        } else {
          icoEl.innerHTML = DEFAULT_ICON_SVG;
        }
      } catch (e) {
        console.warn('[Audit] 自定义图标应用失败', e);
      }
    }
    function updateBadge() {
      try {
        const count = window.__MY_AUDIT__.data.pending.length;
        // 九宫格图标角标
        const icons = document.querySelectorAll('.app[data-app="audit"]');
        icons.forEach(icon => {
          let badge = icon.querySelector('.audit-badge');
          if (!badge) {
            badge = document.createElement('div');
            badge.className = 'audit-badge';
            icon.appendChild(badge);
          }
          badge.dataset.count = String(count);
          badge.textContent = count > 99 ? '99+' : String(count);
          badge.style.display = count === 0 ? 'none' : '';
        });
        // 悬浮球角标（修复问题2：在外围圆角外露）
        const ball = document.getElementById('audit-floating-ball');
        if (ball) {
          let badge = ball.querySelector(':scope > .audit-badge');
          if (!badge) {
            badge = document.createElement('span');
            badge.className = 'audit-badge';
            ball.appendChild(badge);
          }
          badge.dataset.count = String(count);
          badge.textContent = count > 99 ? '99+' : String(count);
          badge.style.display = count === 0 ? 'none' : '';
        }
        // 面板 Tab 角标（修复问题1：数量 0 时隐藏）
        const tabBadge = document.querySelector('.audit-tab[data-tab="pending"] .audit-tab-badge');
        if (tabBadge) {
          if (count === 0) {
            tabBadge.hidden = true;
            tabBadge.textContent = '';
          } else {
            tabBadge.hidden = false;
            tabBadge.textContent = count > 99 ? '99+' : String(count);
          }
        }
      } catch (e) {
        console.warn('[Audit] 角标更新失败', e);
      }
    }
    function ensureAuditIcon() {
      try {
        const container = getDeskContainer();
        let icon = document.querySelector('.app[data-app="audit"]');
        if (!icon) {
          if (!container) return;
          icon = buildIconNode();
          container.appendChild(icon);
        }
        icon.onclick = function (ev) {
          if (ev) ev.stopPropagation();
          if (typeof window.openAuditPanel === 'function') window.openAuditPanel('pending');
        };
        applyCustomIcon(icon);
        updateBadge();
      } catch (e) {
        console.warn('[Audit] 图标重建失败', e);
      }
    }

    /* ---------------- 悬浮球（修复问题4：移动端顺滑） ---------------- */
    function getBallPos() {
      const s = window.__MY_AUDIT__.data.settings.floatingBall;
      const size = s.size || 56;
      let x = s.position && typeof s.position.x === 'number' ? s.position.x : 0;
      let y = s.position && typeof s.position.y === 'number' ? s.position.y : 0;
      if (x === 0 && y === 0) {
        x = Math.max(0, window.innerWidth - size - 24);
        y = Math.max(0, window.innerHeight - size - 84);
      }
      x = Math.min(Math.max(0, x), Math.max(0, window.innerWidth - size));
      y = Math.min(Math.max(0, y), Math.max(0, window.innerHeight - size));
      return { x: x, y: y };
    }
    function paintBall(ball) {
      try {
        const s = window.__MY_AUDIT__.data.settings.floatingBall;
        const pos = getBallPos();
        ball.style.width = s.size + 'px';
        ball.style.height = s.size + 'px';
        ball.style.background = s.color || '#3b82f6';
        ball.style.transform = 'translate3d(' + pos.x + 'px,' + pos.y + 'px,0)';
        // 保证 ball-bg 存在，角标不放在 ball-bg 内（可外露）
        let inner = ball.querySelector(':scope > .ball-bg');
        if (!inner) {
          ball.innerHTML = '';
          inner = document.createElement('div');
          inner.className = 'ball-bg';
          ball.appendChild(inner);
        }
        inner.style.background = s.color || '#3b82f6';
        inner.style.fontSize = Math.max(14, Math.floor((s.size || 56) * 0.4)) + 'px';
        if (s.avatar) {
          inner.innerHTML = '<img src="' + s.avatar + '" alt="">';
        } else {
          inner.innerHTML = '✍';
        }
        const forceShow = new URLSearchParams(window.location.search).get('show_audit') === 'true';
        ball.style.display = (s.enabled || forceShow) ? 'flex' : 'none';
        updateBadge();
      } catch (e) {
        console.warn('[Audit] 悬浮球样式应用失败', e);
      }
    }
    function createFloatingBall() {
      try {
        let ball = document.getElementById('audit-floating-ball');
        if (!ball) {
          ball = document.createElement('div');
          ball.id = 'audit-floating-ball';
          document.body.appendChild(ball);

          let dragging = false;
          let moved = false;
          let sx = 0, sy = 0, bx = 0, by = 0;
          let rafId = null;
          let pendingX = null, pendingY = null;

          const applyFrame = function () {
            rafId = null;
            if (pendingX == null || pendingY == null) return;
            ball.style.transform = 'translate3d(' + pendingX + 'px,' + pendingY + 'px,0)';
            try {
              window.__MY_AUDIT__.data.settings.floatingBall.position = { x: pendingX, y: pendingY };
            } catch (e) {}
            pendingX = pendingY = null;
          };

          const onDown = function (e) {
            try {
              const p = e.touches ? e.touches[0] : e;
              dragging = true;
              moved = false;
              sx = p.clientX;
              sy = p.clientY;
              const pos = getBallPos();
              bx = pos.x;
              by = pos.y;
              ball.style.transition = 'none';
            } catch (err) {}
          };
          const onMove = function (e) {
            if (!dragging) return;
            try {
              const p = e.touches ? e.touches[0] : e;
              const dx = p.clientX - sx;
              const dy = p.clientY - sy;
              if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
              const size = window.__MY_AUDIT__.data.settings.floatingBall.size || 56;
              const nx = Math.min(Math.max(0, bx + dx), Math.max(0, window.innerWidth - size));
              const ny = Math.min(Math.max(0, by + dy), Math.max(0, window.innerHeight - size));
              pendingX = nx;
              pendingY = ny;
              if (!rafId) rafId = requestAnimationFrame(applyFrame);
              if (e.cancelable) e.preventDefault();
            } catch (err) {}
          };
          const onUp = function () {
            if (!dragging) return;
            dragging = false;
            ball.style.transition = 'transform .08s ease';
            try { window.__MY_AUDIT__.save(); } catch (e) {}
          };

          ball.addEventListener('mousedown', onDown);
          ball.addEventListener('touchstart', onDown, { passive: true });
          document.addEventListener('mousemove', onMove);
          document.addEventListener('touchmove', onMove, { passive: false });
          document.addEventListener('mouseup', onUp);
          document.addEventListener('touchend', onUp);
          document.addEventListener('touchcancel', onUp);

          // 点击事件：只有没拖拽才触发
          ball.addEventListener('click', function (e) {
            if (moved) {
              e.stopPropagation();
              e.preventDefault();
              return;
            }
            if (typeof window.openAuditPanel === 'function') window.openAuditPanel('pending');
          });
        }
        paintBall(ball);
      } catch (e) {
        console.warn('[Audit] 悬浮球创建失败', e);
      }
    }

    /* ---------------- 图片裁剪弹窗（问题3：圆形/方形） ---------------- */
    function openCropper(opts) {
      try {
        const file = opts.file;
        const shape = opts.shape === 'circle' ? 'circle' : 'square';
        const outSize = opts.size || [192, 192];
        const onConfirm = opts.onConfirm;
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (e) {
          const img = new Image();
          img.onload = function () {
            try {
              const CANVAS = 220;
              const modal = document.createElement('div');
              modal.className = 'audit-cropper-modal';
              modal.innerHTML =
                '<div class="audit-cropper-box">' +
                  '<div class="audit-cropper-header">裁剪' + (shape === 'circle' ? '悬浮球头像' : '九宫格图标') + '</div>' +
                  '<div class="audit-cropper-canvas-wrap">' +
                    '<canvas class="audit-cropper-canvas" width="' + CANVAS + '" height="' + CANVAS + '"></canvas>' +
                    '<div class="audit-cropper-mask ' + shape + '"></div>' +
                  '</div>' +
                  '<div class="audit-cropper-slider-wrap">' +
                    '<input type="range" min="1" max="3" step="0.01" value="1">' +
                  '</div>' +
                  '<div class="audit-cropper-btns">' +
                    '<button class="audit-btn audit-cancel">取消</button>' +
                    '<button class="audit-btn audit-btn-primary audit-confirm">确认</button>' +
                  '</div>' +
                '</div>';
              document.body.appendChild(modal);
              const canvas = modal.querySelector('canvas');
              const ctx = canvas.getContext('2d');
              const slider = modal.querySelector('input[type="range"]');
              let zoom = 1;
              let offsetX = 0, offsetY = 0;
              let dragging = false, dsx = 0, dsy = 0, dox = 0, doy = 0;

              function draw() {
                ctx.clearRect(0, 0, CANVAS, CANVAS);
                const minScale = Math.max(CANVAS / img.width, CANVAS / img.height);
                const scale = minScale * zoom;
                const drawW = img.width * scale;
                const drawH = img.height * scale;
                const dx = (CANVAS - drawW) / 2 + offsetX;
                const dy = (CANVAS - drawH) / 2 + offsetY;
                ctx.drawImage(img, dx, dy, drawW, drawH);
              }
              slider.oninput = function () {
                zoom = Number(slider.value);
                draw();
              };
              // 拖动平移
              const startDrag = function (e) {
                const p = e.touches ? e.touches[0] : e;
                dragging = true;
                dsx = p.clientX; dsy = p.clientY;
                dox = offsetX; doy = offsetY;
              };
              const moveDrag = function (e) {
                if (!dragging) return;
                const p = e.touches ? e.touches[0] : e;
                offsetX = dox + (p.clientX - dsx);
                offsetY = doy + (p.clientY - dsy);
                draw();
                if (e.cancelable && e.touches) e.preventDefault();
              };
              const endDrag = function () { dragging = false; };
              canvas.addEventListener('mousedown', startDrag);
              canvas.addEventListener('touchstart', startDrag, { passive: true });
              document.addEventListener('mousemove', moveDrag);
              document.addEventListener('touchmove', moveDrag, { passive: false });
              document.addEventListener('mouseup', endDrag);
              document.addEventListener('touchend', endDrag);

              modal.querySelector('.audit-cancel').onclick = function () { modal.remove(); };
              modal.querySelector('.audit-confirm').onclick = function () {
                try {
                  const out = document.createElement('canvas');
                  out.width = outSize[0];
                  out.height = outSize[1];
                  const octx = out.getContext('2d');
                  if (shape === 'circle') {
                    octx.beginPath();
                    octx.arc(outSize[0] / 2, outSize[1] / 2, Math.min(outSize[0], outSize[1]) / 2, 0, Math.PI * 2);
                    octx.clip();
                  }
                  const scaleOut = outSize[0] / CANVAS;
                  const minScale = Math.max(CANVAS / img.width, CANVAS / img.height);
                  const scale = minScale * zoom;
                  const drawW = img.width * scale;
                  const drawH = img.height * scale;
                  const dx = (CANVAS - drawW) / 2 + offsetX;
                  const dy = (CANVAS - drawH) / 2 + offsetY;
                  octx.drawImage(img, dx * scaleOut, dy * scaleOut, drawW * scaleOut, drawH * scaleOut);
                  onConfirm(out.toDataURL('image/png'));
                  modal.remove();
                } catch (err) {
                  console.warn('[Audit] 裁剪导出失败', err);
                }
              };
              draw();
            } catch (err) {
              console.warn('[Audit] 裁剪面板创建失败', err);
            }
          };
          img.onerror = function () { toast('图片读取失败', '#b91c1c'); };
          img.src = e.target.result;
        };
        reader.readAsDataURL(file);
      } catch (e) {
        console.warn('[Audit] 图片处理失败', e);
      }
    }

    /* ---------------- 面板 ---------------- */
    function openAuditPanel(defaultTab) {
      try {
        if (!panelMask) {
          panelMask = document.createElement('div');
          panelMask.id = 'audit-panel-mask';
          panelMask.innerHTML = '' +
            '<div id="audit-panel">' +
              '<div class="audit-panel-header">' +
                '<div class="audit-panel-title">审核中心</div>' +
                '<button class="audit-panel-close">×</button>' +
              '</div>' +
              '<div class="audit-tabs">' +
                '<button class="audit-tab" data-tab="pending">待审核 <span class="audit-tab-badge" hidden></span></button>' +
                '<button class="audit-tab" data-tab="cardlib">字卡库</button>' +
                '<button class="audit-tab" data-tab="history">历史档案</button>' +
                '<button class="audit-tab" data-tab="settings">设置</button>' +
              '</div>' +
              '<div class="audit-tab-content">' +
                '<div class="audit-tab-pane" data-pane="pending"></div>' +
                '<div class="audit-tab-pane" data-pane="cardlib"></div>' +
                '<div class="audit-tab-pane" data-pane="history"></div>' +
                '<div class="audit-tab-pane" data-pane="settings"></div>' +
              '</div>' +
            '</div>';
          document.body.appendChild(panelMask);
          panelMask.querySelector('.audit-panel-close').onclick = function () {
            panelMask.style.display = 'none';
          };
          panelMask.addEventListener('click', function (e) {
            if (e.target === panelMask) panelMask.style.display = 'none';
          });
          panelMask.querySelectorAll('.audit-tab').forEach(function (tab) {
            tab.onclick = function () {
              panelMask.querySelectorAll('.audit-tab').forEach(function (t) { t.classList.remove('active'); });
              panelMask.querySelectorAll('.audit-tab-pane').forEach(function (p) { p.classList.remove('active'); });
              tab.classList.add('active');
              const pane = panelMask.querySelector('[data-pane="' + tab.dataset.tab + '"]');
              if (pane) pane.classList.add('active');
              if (tab.dataset.tab === 'pending') renderPending();
              if (tab.dataset.tab === 'cardlib') renderCardlibPane();
              if (tab.dataset.tab === 'history') renderHistory();
              if (tab.dataset.tab === 'settings') renderSettings();
            };
          });
        }
        panelMask.style.display = 'flex';
        const target = defaultTab || 'pending';
        panelMask.querySelectorAll('.audit-tab').forEach(function (t) {
          t.classList.toggle('active', t.dataset.tab === target);
        });
        panelMask.querySelectorAll('.audit-tab-pane').forEach(function (p) {
          p.classList.toggle('active', p.dataset.pane === target);
        });
        if (target === 'pending') renderPending();
        if (target === 'cardlib') renderCardlibPane();
        if (target === 'history') renderHistory();
        if (target === 'settings') renderSettings();
        // 无论哪个 Tab，都同步角标
        updateBadge();
      } catch (e) {
        console.warn('[Audit] 面板打开失败', e);
      }
    }

    const ACTION_LABEL = { add: '新增', delete: '删除', disable: '禁用', move: '迁移', restore: '恢复启用' };
    function findCard(pending) {
      const catList = window.__MY_AUDIT__.data.categories;
      for (const cat of catList) {
        if (pending.cardId) {
          const hit = cat.cards.find(function (c) { return c.id === pending.cardId; });
          if (hit) return { cat: cat, card: hit };
        }
      }
      const src = catList.find(function (c) { return c.id === pending.sourceCatId; });
      if (src) {
        const hit = src.cards.find(function (c) { return c.text === pending.targetText; });
        if (hit) return { cat: src, card: hit };
      }
      for (const cat of catList) {
        const hit = cat.cards.find(function (c) { return c.text === pending.targetText; });
        if (hit) return { cat: cat, card: hit };
      }
      return null;
    }
    function renderPending() {
      try {
        const pane = panelMask.querySelector('[data-pane="pending"]');
        const list = window.__MY_AUDIT__.data.pending;
        // 更新Tab角标（问题1：数量 0 时隐藏）
        const tabBadge = panelMask.querySelector('.audit-tab[data-tab="pending"] .audit-tab-badge');
        if (tabBadge) {
          if (list.length === 0) {
            tabBadge.hidden = true;
            tabBadge.textContent = '';
          } else {
            tabBadge.hidden = false;
            tabBadge.textContent = list.length > 99 ? '99+' : String(list.length);
          }
        }

        if (!list.length) {
          pane.innerHTML = '<div style="text-align:center;color:#9ca3af;padding:40px 0;">暂无待审核申请</div>';
          return;
        }
        const cats = window.__MY_AUDIT__.data.categories;
        let html = '';
        html += '<div class="audit-batch-bar">' +
          '<label><input type="checkbox" id="pending-select-all"> 全选</label>' +
          '<button class="audit-btn audit-btn-primary audit-btn-sm" id="pending-batch-approve">批量同意</button>' +
          '<button class="audit-btn audit-btn-danger audit-btn-sm" id="pending-batch-reject">批量拒绝</button>' +
          '<button class="audit-btn audit-btn-sm" id="pending-all-approve">全部同意</button>' +
          '<button class="audit-btn audit-btn-sm" id="pending-all-reject">全部拒绝</button>' +
          '</div>';
        list.forEach(function (item, idx) {
          const label = ACTION_LABEL[item.action] || item.action;
          let desc = '';
          let extra = '';
          if (item.action === 'add') {
            desc = '[' + item.sender + '] 申请新增字卡：「' + item.targetText + '」';
            extra = '<span>存入分类：</span><select class="audit-select pending-target-sel" data-idx="' + idx + '">' +
              cats.map(function (c) {
                return '<option value="' + c.id + '"' + (item.targetCategory === c.id ? ' selected' : '') + '>' + c.name + '</option>';
              }).join('') + '</select>';
          } else if (item.action === 'delete') {
            desc = '[' + item.sender + '] 申请删除字卡：「' + item.targetText + '」';
          } else if (item.action === 'disable') {
            desc = '[' + item.sender + '] 申请禁用字卡：「' + item.targetText + '」';
          } else if (item.action === 'move') {
            desc = '[' + item.sender + '] 申请将「' + item.targetText + '」从【' + (item.sourceCatName || '未知分类') +
              '】迁移至【' + (item.targetCatName || '未知分类') + '】';
            extra = '<span>源分类：</span><select class="audit-select pending-source-sel" data-idx="' + idx + '">' +
              cats.map(function (c) {
                return '<option value="' + c.id + '"' + (item.sourceCatId === c.id ? ' selected' : '') + '>' + c.name + '</option>';
              }).join('') + '</select>' +
              '<span>目标分类：</span><select class="audit-select pending-target-sel" data-idx="' + idx + '">' +
              cats.map(function (c) {
                return '<option value="' + c.id + '"' + (item.targetCategory === c.id ? ' selected' : '') + '>' + c.name + '</option>';
              }).join('') + '</select>';
          } else if (item.action === 'restore') {
            desc = '[' + item.sender + '] 申请恢复启用字卡：「' + item.targetText + '」';
          }
          html += '<div class="audit-pending-item">' +
            '<input type="checkbox" class="pending-check audit-pending-checkbox" data-idx="' + idx + '" style="margin-top:3px;">' +
            '<div class="audit-pending-info">' +
              '<div><span class="audit-pending-type type-' + item.action + '">' + label + '</span>' +
              '<span class="audit-pending-desc">' + desc + '</span></div>' +
              (extra ? '<div class="audit-pending-extra">' + extra + '</div>' : '') +
              '<div class="audit-pending-sender">发件人：' + item.sender + ' · ' + new Date(item.time).toLocaleString() + '</div>' +
            '</div>' +
            '<div class="audit-pending-actions">' +
              '<button class="audit-btn audit-btn-sm pending-approve" data-idx="' + idx + '">同意</button>' +
              '<button class="audit-btn audit-btn-danger audit-btn-sm pending-reject" data-idx="' + idx + '">驳回</button>' +
            '</div>' +
          '</div>';
        });
        pane.innerHTML = html;
        bindPendingEvents(pane);
      } catch (e) {
        console.warn('[Audit] 待审核渲染失败', e);
      }
    }
    function bindPendingEvents(pane) {
      try {
        const all = pane.querySelector('#pending-select-all');
        if (all) {
          all.onchange = function () {
            pane.querySelectorAll('.pending-check').forEach(function (cb) { cb.checked = all.checked; });
          };
        }
        const ba = pane.querySelector('#pending-batch-approve');
        if (ba) ba.onclick = function () { batchApprove(getCheckedIdx(pane)); };
        const br = pane.querySelector('#pending-batch-reject');
        if (br) br.onclick = function () { batchReject(getCheckedIdx(pane)); };
        const aa = pane.querySelector('#pending-all-approve');
        if (aa) aa.onclick = function () {
          batchApprove(window.__MY_AUDIT__.data.pending.map(function (_, i) { return i; }));
        };
        const ar = pane.querySelector('#pending-all-reject');
        if (ar) ar.onclick = function () {
          batchReject(window.__MY_AUDIT__.data.pending.map(function (_, i) { return i; }));
        };
        pane.querySelectorAll('.pending-approve').forEach(function (btn) {
          btn.onclick = function () {
            const idx = Number(btn.dataset.idx);
            if (approveOne(idx, pane)) {
              renderPending();
              updateBadge();
            }
          };
        });
        pane.querySelectorAll('.pending-reject').forEach(function (btn) {
          btn.onclick = function () {
            rejectOne(Number(btn.dataset.idx));
            renderPending();
            updateBadge();
          };
        });
      } catch (e) {
        console.warn('[Audit] 待审核事件绑定失败', e);
      }
    }
    function getCheckedIdx(pane) {
      return Array.from(pane.querySelectorAll('.pending-check:checked')).map(function (cb) { return Number(cb.dataset.idx); });
    }
    function syncPendingSelect(pane, idx) {
      try {
        const item = window.__MY_AUDIT__.data.pending[idx];
        if (!item) return;
        const targetSel = pane.querySelector('.pending-target-sel[data-idx="' + idx + '"]');
        const sourceSel = pane.querySelector('.pending-source-sel[data-idx="' + idx + '"]');
        if (targetSel) {
          item.targetCategory = targetSel.value;
          const cat = window.__MY_AUDIT__.data.categories.find(function (c) { return c.id === targetSel.value; });
          item.targetCatName = cat ? cat.name : null;
        }
        if (sourceSel) {
          item.sourceCatId = sourceSel.value;
          const cat = window.__MY_AUDIT__.data.categories.find(function (c) { return c.id === sourceSel.value; });
          item.sourceCatName = cat ? cat.name : null;
        }
      } catch (e) {}
    }
    function approveOne(idx, pane) {
      try {
        const data = window.__MY_AUDIT__.data;
        const item = data.pending[idx];
        if (!item) return false;
        if (pane) syncPendingSelect(pane, idx);
        if (item.action === 'add') {
          const cat = data.categories.find(function (c) { return c.id === item.targetCategory; });
          if (!cat) { toast('目标分类不存在', '#b91c1c'); return false; }
          if (!item.targetText) { toast('字卡内容为空', '#b91c1c'); return false; }
          const dup = cat.cards.some(function (c) { return c.text === item.targetText; });
          if (dup) { toast('该分类已存在相同字卡', '#b45309'); return false; }
          cat.cards.push({
            id: genId(),
            text: item.targetText,
            disabled: false,
            disabledType: 'single',
            createTime: Date.now()
          });
        } else if (item.action === 'delete') {
          const hit = findCard(item);
          if (!hit) { toast('未找到对应字卡，可能已被删除', '#b45309'); return false; }
          hit.cat.cards = hit.cat.cards.filter(function (c) { return c.id !== hit.card.id; });
        } else if (item.action === 'disable') {
          const hit = findCard(item);
          if (!hit) { toast('未找到对应字卡', '#b45309'); return false; }
          hit.card.disabled = true;
          hit.card.disabledType = item.disabledType === 'both' ? 'both' : 'single';
        } else if (item.action === 'restore') {
          const hit = findCard(item);
          if (!hit) { toast('未找到对应字卡', '#b45309'); return false; }
          hit.card.disabled = false;
        } else if (item.action === 'move') {
          if (item.sourceCatId === item.targetCategory) {
            toast('源分类与目标分类不能相同', '#b91c1c'); return false;
          }
          const src = data.categories.find(function (c) { return c.id === item.sourceCatId; });
          const dst = data.categories.find(function (c) { return c.id === item.targetCategory; });
          if (!src || !dst) { toast('源分类或目标分类不存在', '#b91c1c'); return false; }
          const cardIdx = src.cards.findIndex(function (c) { return c.id === item.cardId && item.cardId; });
          let realIdx = cardIdx;
          if (realIdx < 0) realIdx = src.cards.findIndex(function (c) { return c.text === item.targetText; });
          if (realIdx < 0) { toast('源分类中未找到该字卡', '#b45309'); return false; }
          const card = src.cards.splice(realIdx, 1)[0];
          dst.cards.push(card);
        } else {
          return false;
        }
        pushHistory(item, 'approve');
        data.pending.splice(idx, 1);
        window.__MY_AUDIT__.save();
        try { if (window.__MY_AUDIT_CARD_UI__) window.__MY_AUDIT_CARD_UI__.refresh(); } catch (e) {}
        return true;
      } catch (e) {
        console.warn('[Audit] 审批同意失败', e);
        return false;
      }
    }
    function rejectOne(idx) {
      try {
        const data = window.__MY_AUDIT__.data;
        const item = data.pending[idx];
        if (!item) return;
        pushHistory(item, 'reject');
        data.pending.splice(idx, 1);
        window.__MY_AUDIT__.save();
      } catch (e) {
        console.warn('[Audit] 审批驳回失败', e);
      }
    }
    function batchApprove(indices) {
      try {
        const pane = panelMask ? panelMask.querySelector('[data-pane="pending"]') : null;
        const sorted = indices.slice().sort(function (a, b) { return b - a; });
        sorted.forEach(function (i) {
          const it = window.__MY_AUDIT__.data.pending[i];
          if (!it) return;
          if (it.action === 'add' || it.action === 'move') {
            if (pane) syncPendingSelect(pane, i);
          }
          approveOne(i, pane);
        });
        window.__MY_AUDIT__.save();
        renderPending();
        updateBadge();
      } catch (e) {
        console.warn('[Audit] 批量同意失败', e);
      }
    }
    function batchReject(indices) {
      try {
        const sorted = indices.slice().sort(function (a, b) { return b - a; });
        sorted.forEach(function (i) { rejectOne(i); });
        renderPending();
        updateBadge();
      } catch (e) {
        console.warn('[Audit] 批量拒绝失败', e);
      }
    }
    function pushHistory(item, result) {
      try {
        const list = window.__MY_AUDIT__.data.history;
        list.push({
          action: item.action,
          sender: item.sender,
          targetText: item.targetText,
          sourceCatName: item.sourceCatName || null,
          targetCatName: item.targetCatName || null,
          time: item.time,
          result: result,
          auditTime: Date.now()
        });
        while (list.length > 100) list.shift();
      } catch (e) {}
    }
    function renderHistory() {
      try {
        const pane = panelMask.querySelector('[data-pane="history"]');
        const list = window.__MY_AUDIT__.data.history;
        if (!list.length) {
          pane.innerHTML = '<div style="text-align:center;color:#9ca3af;padding:40px 0;">暂无审批记录</div>';
          return;
        }
        let html = '';
        list.slice().reverse().forEach(function (h) {
          const label = ACTION_LABEL[h.action] || h.action;
          html += '<div class="audit-history-item">' +
            '<div>' +
              '<div><b>' + label + '</b> · ' + (h.targetText || '') + '</div>' +
              '<div style="color:#9ca3af;margin-top:3px;">' + h.sender + ' · ' + new Date(h.time).toLocaleString() + ' · 审核于 ' + new Date(h.auditTime).toLocaleString() + '</div>' +
            '</div>' +
            '<div class="audit-history-result result-' + (h.result === 'approve' ? 'approve' : 'reject') + '">' +
              (h.result === 'approve' ? '已同意' : '已驳回') +
            '</div>' +
          '</div>';
        });
        pane.innerHTML = html;
      } catch (e) {
        console.warn('[Audit] 历史渲染失败', e);
      }
    }
    function renderCardlibPane() {
      try {
        const pane = panelMask.querySelector('[data-pane="cardlib"]');
        if (!pane) return;
        const ui = window.__MY_AUDIT_CARD_UI__;
        if (ui && typeof ui.render === 'function') {
          pane.innerHTML = '';
          ui.render(pane);
        } else {
          pane.innerHTML = '<div style="text-align:center;color:#9ca3af;padding:30px 0;">' +
            '字卡库尚未就绪，请点击页面第三个 Tab「审核报告字卡」查看。</div>';
        }
      } catch (e) {
        console.warn('[Audit] 字卡库面板渲染失败', e);
      }
    }
    function renderSettings() {
      try {
        const pane = panelMask.querySelector('[data-pane="settings"]');
        const s = window.__MY_AUDIT__.data.settings;
        const fb = s.floatingBall;
        const de = s.dreamEngine;
        pane.innerHTML = '' +
          '<div class="settings-section">' +
            '<h4>九宫格图标</h4>' +
            '<div class="settings-row">' +
              '<span class="settings-label">自定义图标</span>' +
              '<div class="settings-controls">' +
                '<div class="icon-preview rect" id="icon-preview"></div>' +
                '<input type="file" id="icon-upload" accept="image/*" hidden>' +
                '<button class="audit-btn audit-btn-sm" id="icon-upload-btn">上传</button>' +
                '<button class="audit-btn audit-btn-sm" id="icon-reset">恢复默认</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="settings-section">' +
            '<h4>悬浮球</h4>' +
            '<div class="settings-row">' +
              '<span class="settings-label">启用悬浮球</span>' +
              '<div class="settings-controls">' +
                '<input type="checkbox" id="ball-enabled">' +
              '</div>' +
            '</div>' +
            '<div class="settings-row">' +
              '<span class="settings-label">颜色</span>' +
              '<div class="settings-controls">' +
                '<input type="color" id="ball-color">' +
                '<button class="audit-btn audit-btn-sm" id="ball-color-reset">恢复默认</button>' +
              '</div>' +
            '</div>' +
            '<div class="settings-row">' +
              '<span class="settings-label">大小 <span id="ball-size-text">56px</span></span>' +
              '<div class="settings-controls">' +
                '<input type="range" id="ball-size" min="36" max="80" step="2">' +
                '<button class="audit-btn audit-btn-sm" id="ball-size-reset">恢复默认</button>' +
              '</div>' +
            '</div>' +
            '<div class="settings-row">' +
              '<span class="settings-label">自定义头像</span>' +
              '<div class="settings-controls">' +
                '<div class="icon-preview circle" id="ball-avatar-preview"></div>' +
                '<input type="file" id="ball-avatar-upload" accept="image/*" hidden>' +
                '<button class="audit-btn audit-btn-sm" id="ball-avatar-btn">上传</button>' +
                '<button class="audit-btn audit-btn-sm" id="ball-avatar-reset">恢复默认</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="settings-section">' +
            '<h4>梦角引擎</h4>' +
            '<div class="settings-row">' +
              '<span class="settings-label">启用自动引擎</span>' +
              '<div class="settings-controls">' +
                '<input type="checkbox" id="engine-enabled">' +
              '</div>' +
            '</div>' +
            '<div class="settings-row">' +
              '<span class="settings-label">说明</span>' +
              '<span style="color:#9ca3af;">每30分钟巡检；主动申请概率2%；待审上限5条</span>' +
            '</div>' +
          '</div>' +
          '<div class="settings-section">' +
            '<h4>数据备份</h4>' +
            '<div class="settings-row">' +
              '<span class="settings-label">备份操作</span>' +
              '<div class="settings-controls">' +
                '<button class="audit-btn audit-btn-sm" id="data-export">导出全部数据</button>' +
                '<input type="file" id="data-import" accept=".json" hidden>' +
                '<button class="audit-btn audit-btn-sm" id="data-import-btn">导入数据</button>' +
              '</div>' +
            '</div>' +
          '</div>';

        // 图标
        const iconPrev = pane.querySelector('#icon-preview');
        iconPrev.innerHTML = s.iconCustom
          ? '<img src="' + s.iconCustom + '" alt="">'
          : '<span style="transform:scale(.8);display:inline-block;">' + DEFAULT_ICON_SVG + '</span>';
        pane.querySelector('#icon-upload-btn').onclick = function () {
          pane.querySelector('#icon-upload').click();
        };
        pane.querySelector('#icon-upload').onchange = function (e) {
          const file = e.target.files && e.target.files[0];
          e.target.value = '';
          if (!file) return;
          openCropper({
            file: file,
            shape: 'square',
            size: [192, 192],
            onConfirm: function (base64) {
              window.__MY_AUDIT__.data.settings.iconCustom = base64;
              window.__MY_AUDIT__.save();
              renderSettings();
              ensureAuditIcon();
              toast('图标已更新');
            }
          });
        };
        pane.querySelector('#icon-reset').onclick = function () {
          window.__MY_AUDIT__.data.settings.iconCustom = null;
          window.__MY_AUDIT__.save();
          renderSettings();
          ensureAuditIcon();
          toast('图标已恢复默认');
        };
        // 悬浮球
        const enabled = pane.querySelector('#ball-enabled');
        enabled.checked = !!fb.enabled;
        enabled.onchange = function () {
          fb.enabled = enabled.checked;
          window.__MY_AUDIT__.save();
          createFloatingBall();
        };
        const color = pane.querySelector('#ball-color');
        color.value = fb.color;
        color.oninput = function () {
          fb.color = color.value;
          window.__MY_AUDIT__.save();
          const ball = document.getElementById('audit-floating-ball');
          if (ball) paintBall(ball);
        };
        pane.querySelector('#ball-color-reset').onclick = function () {
          fb.color = '#3b82f6';
          window.__MY_AUDIT__.save();
          renderSettings();
          const ball = document.getElementById('audit-floating-ball');
          if (ball) paintBall(ball);
        };
        const size = pane.querySelector('#ball-size');
        const sizeText = pane.querySelector('#ball-size-text');
        size.value = fb.size;
        sizeText.textContent = fb.size + 'px';
        size.oninput = function () {
          const v = Number(size.value);
          fb.size = v;
          sizeText.textContent = v + 'px';
          window.__MY_AUDIT__.save();
          const ball = document.getElementById('audit-floating-ball');
          if (ball) paintBall(ball);
        };
        pane.querySelector('#ball-size-reset').onclick = function () {
          fb.size = 56;
          window.__MY_AUDIT__.save();
          renderSettings();
          const ball = document.getElementById('audit-floating-ball');
          if (ball) paintBall(ball);
        };
        const avatarPrev = pane.querySelector('#ball-avatar-preview');
        avatarPrev.innerHTML = fb.avatar ? '<img src="' + fb.avatar + '" alt="">' : '';
        pane.querySelector('#ball-avatar-btn').onclick = function () {
          pane.querySelector('#ball-avatar-upload').click();
        };
        pane.querySelector('#ball-avatar-upload').onchange = function (e) {
          const file = e.target.files && e.target.files[0];
          e.target.value = '';
          if (!file) return;
          openCropper({
            file: file,
            shape: 'circle',
            size: [192, 192],
            onConfirm: function (base64) {
              fb.avatar = base64;
              window.__MY_AUDIT__.save();
              renderSettings();
              const ball = document.getElementById('audit-floating-ball');
              if (ball) paintBall(ball);
              toast('头像已更新');
            }
          });
        };
        pane.querySelector('#ball-avatar-reset').onclick = function () {
          fb.avatar = null;
          window.__MY_AUDIT__.save();
          renderSettings();
          const ball = document.getElementById('audit-floating-ball');
          if (ball) paintBall(ball);
        };
        // 引擎
        const engineEl = pane.querySelector('#engine-enabled');
        engineEl.checked = !!de.enabled;
        engineEl.onchange = function () {
          de.enabled = engineEl.checked;
          window.__MY_AUDIT__.save();
          de.enabled ? startDreamEngine() : stopDreamEngine();
        };
        // 备份
        pane.querySelector('#data-export').onclick = function () {
          try {
            const blob = new Blob([JSON.stringify(window.__MY_AUDIT__.data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'my-audit-cards-' + Date.now() + '.json';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
          } catch (e) {
            console.warn('[Audit] 导出失败', e);
          }
        };
        pane.querySelector('#data-import-btn').onclick = function () {
          pane.querySelector('#data-import').click();
        };
        pane.querySelector('#data-import').onchange = function (e) {
          const file = e.target.files && e.target.files[0];
          e.target.value = '';
          if (!file) return;
          const reader = new FileReader();
          reader.onload = function (ev) {
            try {
              const data = JSON.parse(ev.target.result);
              if (!confirm('确认导入？将覆盖当前全部数据')) return;
              window.__MY_AUDIT__.data = migrateLegacy(data) || data;
              const base = defaultData();
              if (!Array.isArray(window.__MY_AUDIT__.data.categories)) window.__MY_AUDIT__.data.categories = base.categories;
              if (!Array.isArray(window.__MY_AUDIT__.data.pending)) window.__MY_AUDIT__.data.pending = [];
              if (!Array.isArray(window.__MY_AUDIT__.data.history)) window.__MY_AUDIT__.data.history = [];
              if (!window.__MY_AUDIT__.data.settings) window.__MY_AUDIT__.data.settings = base.settings;
              window.__MY_AUDIT__.save();
              ensureAuditIcon();
              createFloatingBall();
              if (window.__MY_AUDIT_CARD_UI__) window.__MY_AUDIT_CARD_UI__.refresh();
              renderPending();
              updateBadge();
              toast('导入成功');
            } catch (err) {
              alert('导入失败，文件格式错误');
            }
          };
          reader.readAsText(file);
        };
      } catch (e) {
        console.warn('[Audit] 设置渲染失败', e);
      }
    }

        /* ---------------- 消息发送（使用旧版稳定同步气泡方案，克隆原生头像，DOM数量对比自愈） ---------------- */
    const INJECTED_MSGS = [];

    // 【绝对稳定】气泡注入方案 (手搓完美同步+头像形状实时联动版)
    function injectBubbleToChat(text, side) {
        var renderSuccess = false;
        try {
            var now = Date.now();
            // side兼容，in=梦角收到消息
            var useSide = side === 'out' ? 'out' : 'in';
            var newMsg = { side: useSide, text: text, time: now };

            // ========== 1. 极度安全的 Store & localStorage 写入 ==========
            try {
                var cid = 'default';
                var store = null;
                try {
                    if (window.storeFor) store = window.storeFor(cid);
                    else if (window.xyStore) store = window.xyStore('xy-home-v2:' + cid);
                } catch(e) {}

                var storeData = null;
                if (store && typeof store.get === 'function') {
                    try {
                        storeData = store.get('chat-msgs');
                        var targetArr = null;
                        if (Array.isArray(storeData)) targetArr = storeData;
                        else if (storeData && typeof storeData === 'object') {
                            for (var k in storeData) { if (Array.isArray(storeData[k])) { targetArr = storeData[k]; break; } }
                        }
                        if (targetArr) {
                            targetArr.push(newMsg);
                            if (typeof store.set === 'function') store.set('chat-msgs', storeData);
                            else if (typeof store.save === 'function') store.save('chat-msgs', storeData);
                        }
                    } catch(err) {}
                }

                var LS_KEY = 'xy-home-v2:' + cid + ':chat-msgs';
                try {
                    var raw = localStorage.getItem(LS_KEY);
                    var parsed = null;

                    if (raw && raw !== '[object Object]' && raw !== 'undefined' && raw !== 'null') {
                        try { parsed = JSON.parse(raw); } catch(e) { parsed = null; }
                    }

                    if (!parsed) {
                        localStorage.setItem(LS_KEY, JSON.stringify([newMsg]));
                    } else {
                        var lsTarget = null;
                        if (Array.isArray(parsed)) {
                            lsTarget = parsed;
                            lsTarget.push(newMsg);
                            localStorage.setItem(LS_KEY, JSON.stringify(lsTarget));
                        } else if (parsed && typeof parsed === 'object') {
                            for (var k in parsed) { if (Array.isArray(parsed[k])) { lsTarget = parsed[k]; break; } }
                            if (lsTarget) {
                                lsTarget.push(newMsg);
                                localStorage.setItem(LS_KEY, JSON.stringify(parsed));
                            }
                        }
                    }
                } catch(e) {}

                INJECTED_MSGS.push(newMsg);
                if (INJECTED_MSGS.length > 50) INJECTED_MSGS.shift();
            } catch (dataErr) {}

            // ========== 2. 尝试调用原网页官方渲染 ==========
            var chatBody = document.getElementById('chat-body');
            if (!chatBody) return true;

            if (typeof window.renderWindow === 'function') {
                try {
                    window.renderWindow(false, false, true);
                    if (typeof window.scrollToBottom === 'function') window.scrollToBottom();
                    return true;
                } catch (e) {}
            }

            // ========== 3. 智能手搓 DOM (精准偷色+形状联动) ==========
            try {
                var bubbleStyle = {
                    backgroundColor: '#ffffff', color: '#333333', borderRadius: '8px',
                    padding: '10px 14px', fontSize: '15px', lineHeight: '1.5',
                    maxWidth: '70%', boxSizing: 'border-box', wordBreak: 'break-all',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)', display: 'inline-block'
                };

                // 提取气泡样式
                var sampleBubble = null;
                var allCandidates = chatBody.querySelectorAll('.bubble, [class*="bubble"], [class*="msg-content"], .text');
                for (var bIdx = allCandidates.length - 1; bIdx >= 0; bIdx--) {
                    var b = allCandidates[bIdx];
                    if (b.closest('[data-ma-injected="1"]')) continue;
                    var cls = (b.className || '').toLowerCase();
                    if (cls.indexOf('out') >= 0 || cls.indexOf('right') >= 0) continue;
                    var rect = b.getBoundingClientRect();
                    var parentRect = chatBody.getBoundingClientRect();
                    var bg = window.getComputedStyle(b).backgroundColor;
                    if (rect.left - parentRect.left < 100 && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
                        sampleBubble = b;
                        break;
                    }
                }

                if (sampleBubble) {
                    var s = window.getComputedStyle(sampleBubble);
                    bubbleStyle.backgroundColor = s.backgroundColor;
                    bubbleStyle.color = s.color;
                    bubbleStyle.borderRadius = s.borderRadius || '8px';
                    var fs = parseInt(s.fontSize, 10);
                    if (fs > 12 && fs < 20) bubbleStyle.fontSize = s.fontSize;
                } else {
                    var rootS = window.getComputedStyle(document.documentElement);
                    var bgVar = rootS.getPropertyValue('--msg-bg') || rootS.getPropertyValue('--bubble-bg');
                    var colorVar = rootS.getPropertyValue('--msg-color') || rootS.getPropertyValue('--bubble-color');
                    if (bgVar && bgVar.trim()) bubbleStyle.backgroundColor = bgVar.trim();
                    if (colorVar && colorVar.trim()) bubbleStyle.color = colorVar.trim();
                }

                // 提取头像与圆角
                var avatarRadius = '4px';
                var sampleAvatar = chatBody.querySelector('img');
                if (sampleAvatar) {
                    var sa = window.getComputedStyle(sampleAvatar);
                    if (sa.borderRadius) avatarRadius = sa.borderRadius;
                }

                var wrapper = document.createElement('div');
                wrapper.setAttribute('data-ma-injected', '1');
                wrapper.style.cssText = 'display: flex; align-items: flex-start; margin-bottom: 15px; padding: 10px; width: 100%; box-sizing: border-box;';

                // 左侧列：包裹头像和时间戳
                var leftCol = document.createElement('div');
                leftCol.style.cssText = 'display: flex; flex-direction: column; align-items: center; margin-right: 12px; flex-shrink: 0; width: 40px;';

                var avatarEl;
                if (sampleAvatar) {
                    avatarEl = sampleAvatar.cloneNode();
                    avatarEl.style.cssText = 'width: 38px; height: 38px; border-radius: ' + avatarRadius + '; object-fit: cover;';
                } else {
                    avatarEl = document.createElement('div');
                    avatarEl.style.cssText = 'width: 38px; height: 38px; border-radius: ' + avatarRadius + '; background: #ddd;';
                }

                var timeEl = document.createElement('div');
                timeEl.style.cssText = 'font-size: 10px; color: #999; margin-top: 6px; white-space: nowrap; transform: scale(0.9);';
                var d = new Date();
                timeEl.textContent = (d.getHours()<10?'0':'') + d.getHours() + ':' + (d.getMinutes()<10?'0':'') + d.getMinutes() + ':' + (d.getSeconds()<10?'0':'') + d.getSeconds();

                leftCol.appendChild(avatarEl);
                leftCol.appendChild(timeEl);

                var bubble = document.createElement('div');
                Object.assign(bubble.style, bubbleStyle);
                bubble.textContent = text;
                bubble.className = 'bubble msg-content';

                wrapper.appendChild(leftCol);
                wrapper.appendChild(bubble);
                chatBody.appendChild(wrapper);

                try { chatBody.scrollTop = chatBody.scrollHeight; window.scrollTo(0, document.body.scrollHeight); } catch (e) {}
                renderSuccess = true;
            } catch (domErr) {}

        } catch (globalErr) {}
        return renderSuccess;
    }

    // 【核心修复】实时监控原生气泡颜色 & 头像圆角，实现免刷新热更新
    function checkAndRepairChat() {
        var chatBody = document.getElementById('chat-body');
        if (!chatBody || INJECTED_MSGS.length === 0) return;

        // 1. 提取最新原生气泡和头像样式
        var bubbleStyle = {
            backgroundColor: '#ffffff', color: '#333333', borderRadius: '8px',
            padding: '10px 14px', fontSize: '15px', lineHeight: '1.5',
            maxWidth: '70%', boxSizing: 'border-box', wordBreak: 'break-all', display: 'inline-block'
        };
        var sampleBubble = null;
        var allCandidates = chatBody.querySelectorAll('.bubble, [class*="bubble"], [class*="msg-content"]');
        for (var bIdx = allCandidates.length - 1; bIdx >= 0; bIdx--) {
            var b = allCandidates[bIdx];
            if (b.closest('[data-ma-injected="1"]')) continue;
            var cls = (b.className || '').toLowerCase();
            if (cls.indexOf('out') >= 0 || cls.indexOf('right') >= 0) continue;
            var rect = b.getBoundingClientRect();
            var parentRect = chatBody.getBoundingClientRect();
            if (rect.left - parentRect.left < 100) { sampleBubble = b; break; }
        }
        if (sampleBubble) {
            var s = window.getComputedStyle(sampleBubble);
            bubbleStyle.backgroundColor = s.backgroundColor;
            bubbleStyle.color = s.color;
            bubbleStyle.borderRadius = s.borderRadius || '8px';
        }

        var currentAvatarRadius = '4px';
        var sampleAvatar = chatBody.querySelector('img');
        if (sampleAvatar) {
            var sa = window.getComputedStyle(sampleAvatar);
            if (sa.borderRadius) currentAvatarRadius = sa.borderRadius;
        }

        var injectedNodes = chatBody.querySelectorAll('[data-ma-injected="1"]');

        // 2. 如果节点数量不对，推倒重来（重新渲染）
        if (injectedNodes.length !== INJECTED_MSGS.length) {
            for (var i = 0; i < injectedNodes.length; i++) injectedNodes[i].remove();

            for (var m = 0; m < INJECTED_MSGS.length; m++) {
                var msg = INJECTED_MSGS[m];

                var wrapper = document.createElement('div');
                wrapper.setAttribute('data-ma-injected', '1');
                wrapper.style.cssText = 'display: flex; align-items: flex-start; margin-bottom: 15px; padding: 10px; width: 100%; box-sizing: border-box;';

                var avatarEl;
                if (sampleAvatar) {
                    avatarEl = sampleAvatar.cloneNode();
                    avatarEl.style.cssText = 'width: 38px; height: 38px; border-radius: ' + currentAvatarRadius + '; object-fit: cover;';
                } else {
                    avatarEl = document.createElement('div');
                    avatarEl.style.cssText = 'width: 38px; height: 38px; border-radius: ' + currentAvatarRadius + '; background: #ddd;';
                }

                var leftCol = document.createElement('div');
                leftCol.style.cssText = 'display: flex; flex-direction: column; align-items: center; margin-right: 12px; flex-shrink: 0; width: 40px;';

                var timeEl = document.createElement('div');
                timeEl.style.cssText = 'font-size: 10px; color: #999; margin-top: 6px; white-space: nowrap; transform: scale(0.9);';
                var d = new Date(msg.time);
                timeEl.textContent = (d.getHours()<10?'0':'') + d.getHours() + ':' + (d.getMinutes()<10?'0':'') + d.getMinutes() + ':' + (d.getSeconds()<10?'0':'') + d.getSeconds();

                leftCol.appendChild(avatarEl);
                leftCol.appendChild(timeEl);

                var bubble = document.createElement('div');
                Object.assign(bubble.style, bubbleStyle);
                bubble.textContent = msg.text;
                bubble.className = 'bubble msg-content';

                wrapper.appendChild(leftCol);
                wrapper.appendChild(bubble);
                chatBody.appendChild(wrapper);
            }
            try { chatBody.scrollTop = chatBody.scrollHeight; } catch (e) {}
        } else {
            // 3. 节点数量正确，执行免刷新热更新
            for (var i = 0; i < injectedNodes.length; i++) {
                var node = injectedNodes[i];

                // 刷气泡颜色
                if (sampleBubble) {
                    var bubble = node.querySelector('.bubble, [class*="msg-content"]');
                    if (bubble) {
                        var s = window.getComputedStyle(sampleBubble);
                        bubble.style.backgroundColor = s.backgroundColor;
                        bubble.style.color = s.color;
                    }
                }

                // 刷头像形状
                var img = node.querySelector('img');
                if (img) {
                    img.style.borderRadius = currentAvatarRadius;
                }
            }
        }
    }

    window.sendAuditCard = injectBubbleToChat;

    /* ---------------- 梦角引擎 ---------------- */
    function getEnabledCards() {
      const out = [];
      try {
        window.__MY_AUDIT__.data.categories.forEach(function (cat) {
          if (cat.disabled) return;
          (cat.cards || []).forEach(function (card) {
            if (!card.disabled && card.text) out.push({ card: card, cat: cat });
          });
        });
      } catch (e) {}
      return out;
    }
    function pendingFull() {
      return window.__MY_AUDIT__.data.pending.length >= window.__MY_AUDIT__.data.settings.dreamEngine.maxPending;
    }
    function autoGrabChat() {
      try {
        const raw = localStorage.getItem(STORAGE_CHAT_KEY);
        if (!raw) return;
        let list;
        try { list = JSON.parse(raw); } catch (e) { return; }
        if (list && !Array.isArray(list) && Array.isArray(list.messages)) list = list.messages;
        if (!Array.isArray(list)) return;
        const now = Date.now();
        const windowMs = 15 * 60 * 1000;
        const candidates = list.filter(function (m) {
          if (!m || m.isInjected) return false;
          const isOut = m.side === 'out' || m.role === 'user' || m.isUser === true;
          if (!isOut) return false;
          const t = typeof m.time === 'number' ? m.time : new Date(m.time || 0).getTime();
          if (!t || now - t > windowMs) return false;
          const text = String(m.text || m.content || '');
          return text.length >= 5 && text.length <= 35;
        });
        if (!candidates.length) return;
        const de = window.__MY_AUDIT__.data.settings.dreamEngine;
        const emotions = ['喜欢', '爱', '想你', '开心'];
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        const text = String(pick.text || pick.content || '').trim();
        if (!text) return;
        let prob = de.baseProbability;
        if (emotions.some(function (w) { return text.indexOf(w) >= 0; })) prob = de.emotionProbability;
        if (Math.random() > prob) return;
        if (pendingFull()) return;
        const cats = window.__MY_AUDIT__.data.categories.filter(function (c) { return !c.disabled; });
        if (!cats.length) return;
        // 防止重复
        if (window.__MY_AUDIT__.data.pending.some(function (p) { return p.action === 'add' && p.targetText === text; })) return;
                window.__MY_AUDIT__.data.pending.push({
          id: genId(),
          action: 'add',
          sender: '梦角',
          time: Date.now(),
          targetText: text,
          targetCategory: cats[0].id,
          targetCatName: cats[0].name,
          sourceCatId: null,
          sourceCatName: null,
          cardId: null
        });
        window.__MY_AUDIT__.save();
        updateBadge();
        requestAuditNotify("梦角提交新增申请", text);
      } catch (e) {
        console.warn('[Audit] 自动抓取失败', e);
      }
    }
    function chaosApply() {
      try {
        const de = window.__MY_AUDIT__.data.settings.dreamEngine;
        if (!de.enabled) return;
        if (pendingFull()) return;
        if (Math.random() > (de.chaosProbability || 0.02)) return;
        const pool = getEnabledCards();
        if (!pool.length) return;
        const types = ['delete', 'disable', 'move'];
        const action = types[Math.floor(Math.random() * 3)];
        const pick = pool[Math.floor(Math.random() * pool.length)];
        if (!pick || !pick.card || !pick.cat) return;
        const dup = window.__MY_AUDIT__.data.pending.some(function (p) {
          return p.targetText === pick.card.text && p.action === action;
        });
        if (dup) return;
        const item = {
          id: genId(),
          action: action,
          sender: '梦角',
          time: Date.now(),
          targetText: pick.card.text,
          cardId: pick.card.id,
          sourceCatId: pick.cat.id,
          sourceCatName: pick.cat.name,
          targetCategory: null,
          targetCatName: null
        };
        if (action === 'move') {
          const others = window.__MY_AUDIT__.data.categories.filter(function (c) {
            return c.id !== pick.cat.id && !c.disabled;
          });
          if (!others.length) return;
          const dst = others[Math.floor(Math.random() * others.length)];
          item.targetCategory = dst.id;
          item.targetCatName = dst.name;
        }
                window.__MY_AUDIT__.data.pending.push(item);
        window.__MY_AUDIT__.save();
        updateBadge();
        const actionName = ACTION_LABEL[item.action] || item.action;
        requestAuditNotify("梦角提交" + actionName + "申请", item.targetText);
      } catch (e) {
        console.warn('[Audit] 梦角申请生成失败', e);
      }
    }
        function autoSendMessage() {
      try {
        const de = window.__MY_AUDIT__.data.settings.dreamEngine;
        if (!de.enabled) return;
        const pool = getEnabledCards();
        if (!pool.length) return;
        const pick = pool[Math.floor(Math.random() * pool.length)];
        if (!pick || !pick.card) return;
        injectBubbleToChat(pick.card.text, 'in');
        requestAuditNotify("梦角发来消息", pick.card.text);
      } catch (e) {
        console.warn('[Audit] 主动发消息失败', e);
      }
    }
    function runEngineCycle() {
      if (engineLock) return;
      engineLock = true;
      try {
        const de = window.__MY_AUDIT__.data.settings.dreamEngine;
        if (!de.enabled) return;
        if (!pendingFull()) autoGrabChat();
        chaosApply();
        autoSendMessage();
      } catch (e) {
        console.warn('[Audit] 引擎周期执行失败', e);
      } finally {
        engineLock = false;
      }
    }
    function startDreamEngine() {
      try {
        if (engineTimer) return;
        if (!window.__MY_AUDIT__.data.settings.dreamEngine.enabled) return;
        engineTimer = setInterval(runEngineCycle, window.__MY_AUDIT__.data.settings.dreamEngine.interval);
        setTimeout(function () {
          try { runEngineCycle(); } catch (e) {}
        }, 6000);
      } catch (e) {
        console.warn('[Audit] 梦角引擎启动失败', e);
      }
    }
    function stopDreamEngine() {
      try {
        if (engineTimer) {
          clearInterval(engineTimer);
          engineTimer = null;
        }
      } catch (e) {
        console.warn('[Audit] 梦角引擎停止失败', e);
      }
    }

    /* ---------------- 自愈 ---------------- */
    function scheduleHeal() {
      if (observerTimer) return;
      observerTimer = setTimeout(function () {
        observerTimer = null;
        try {
          ensureAuditIcon();
          createFloatingBall();
          const ball = document.getElementById('audit-floating-ball');
          if (ball) paintBall(ball);
          checkAndRepairChat();
        } catch (e) {}
      }, 400);
    }
    function initObserver() {
      try {
        const ob = new MutationObserver(function () { scheduleHeal(); });
        ob.observe(document.body, { childList: true, subtree: true });
      } catch (e) {
        console.warn('[Audit] 自愈监听初始化失败', e);
      }
    }
       function init() {
      try {
        ensureAuditIcon();
        createFloatingBall();
        initObserver();
        startDreamEngine();
        setInterval(checkAndRepairChat, 30000);

        window.addEventListener('my-audit-data-updated', function () {
          updateBadge();
        });
        // 聊天记录变化时，同步恢复（防原页面清空）
        window.addEventListener('storage', function (e) {
          if (e.key === STORAGE_CHAT_KEY) {
            setTimeout(restoreInjectedFromStorage, 300);
          }
        });
      } catch (e) {
        console.warn('[Audit] 模块一初始化失败', e);
      }
    }
    window.openAuditPanel = function (tab) { openAuditPanel(tab); };
    if (document.readyState === 'interactive' || document.readyState === 'complete') {
      setTimeout(init, 900);
    } else {
      window.addEventListener('DOMContentLoaded', function () { setTimeout(init, 900); });
    }
  })();

  /* ============================================================
     模块二：审核报告字卡 Tab 独立模块（页面第三个 Tab，只做字卡素材管理）
     ============================================================ */
  (function Module2_CardLibraryTab() {
    const PANE_ID = 'cc-sect-audit';
    const TAB_SELECTOR = '[data-ccsel="audit"]';
    const hosts = [];

    /* ---------------- Tab 容器与切换（修复问题7） ---------------- */
    function findTabParent() {
      const ref = document.querySelector('[id^="cc-sect-"]');
      if (ref && ref.parentNode) return ref.parentNode;
      const tabBar = document.querySelector('[data-ccsel]');
      if (tabBar) {
        const box = tabBar.closest('.tabs, .wordcard-tabs, .section-tabs, .cc-tabs');
        if (box && box.parentNode) return box.parentNode;
        if (tabBar.parentNode) return tabBar.parentNode.parentNode || null;
      }
      return null;
    }
    function ensurePane() {
      try {
        let pane = document.getElementById(PANE_ID);
        if (pane) return pane;
        const parent = findTabParent();
        if (!parent) return null;
        pane = document.createElement('div');
        pane.id = PANE_ID;
        pane.hidden = true;
        parent.appendChild(pane);
        renderCardLibrary(pane);
        return pane;
      } catch (e) {
        console.warn('[Audit] 字卡Tab创建失败', e);
        return null;
      }
    }
            function markTabActive(isOurTabActive) {
      try {
        // 清除全部tab的激活样式
        document.querySelectorAll('[data-ccsel]').forEach(function (el) {
          el.classList.remove('cc-tab-active');
        });
        // 仅当选中我们的审核tab，才给它加上激活黑底
        if (isOurTabActive) {
          const ourTab = document.querySelector(TAB_SELECTOR);
          if (ourTab) ourTab.classList.add('cc-tab-active');
        }
        const tab = document.querySelector(TAB_SELECTOR);
        if (tab) {
          let badge = tab.querySelector('.cc-tab-badge');
          if (!badge) {
            badge = document.createElement('span');
            badge.className = 'cc-tab-badge';
            tab.appendChild(badge);
          }
          badge.textContent = String(countAllCards());
        }
      } catch (e) {}
    }
        function showPane() {
      try {
        const pane = ensurePane();
        if (!pane) return;
        // 原生全部隐藏，只展示审核面板
        document.querySelectorAll('[id^="cc-sect-"]').forEach(function (el) {
          el.hidden = true;
        });
        pane.hidden = false;
        markTabActive(true);
        refresh();
      } catch (e) {
        console.warn('[Audit] Tab 切换失败', e);
      }
    }
        function hidePane() {
      try {
        const pane = document.getElementById(PANE_ID);
        if (pane) pane.hidden = true;
        markTabActive(false);
        // 交还控制权：全部原生面板恢复显示，交给网站原生tab逻辑自己去控制切换
        document.querySelectorAll('[id^="cc-sect-"]').forEach(el => {
          el.hidden = false;
        });
      } catch (e) {
        console.warn('[Audit] Tab 交还失败', e);
      }
    }
           function bindTabSwitch() {
      try {
        document.addEventListener('click', function (e) {
          const tab = e.target.closest('[data-ccsel]');
          if (!tab) return;
          // 点击【审核报告字卡】我们自己的tab
          if (tab.matches(TAB_SELECTOR)) {
            showPane();
            return;
          }
          // 点击原生tab：执行交还，不再重复写显示原生面板（hidePane内部已经处理）
          hidePane();
        }, false);
      } catch (e) {
        console.warn('[Audit] Tab切换绑定失败', e);
      }
    }

    /* ---------------- 字卡库 UI ---------------- */
    function buildHTML() {
      const data = window.__MY_AUDIT__.data;
      const cats = data.categories;
      let html = '';
      html += '<div class="cc-audit-toolbar">';
      html += '<textarea class="cc-audit-textarea cc-batch-input" placeholder="逐行输入字卡，每行一条，可批量添加或提交审核"></textarea>';
      html += '<div class="cc-audit-toolbar-row">';
      html += '<select class="audit-select cc-target-sel">' + cats.map(function (c) {
        return '<option value="' + c.id + '">' + c.name + '</option>';
      }).join('') + '</select>';
      html += '<button class="audit-btn audit-btn-primary audit-btn-sm cc-add-btn">批量添加</button>';
      html += '<button class="audit-btn audit-btn-sm cc-submit-btn">提交审核</button>';
      html += '<span style="margin-left:auto;color:#9ca3af;">共 ' + countAllCards() + ' 张字卡 / ' + cats.length + ' 个分类</span>';
      html += '</div>';
      html += '<div class="cc-audit-toolbar-row">';
      html += '<label style="font-size:12px;color:#6b7280;"><input type="checkbox" class="cc-check cc-select-all"> 全选</label>';
      html += '<button class="audit-btn audit-btn-sm cc-batch-del">批量删除</button>';
      html += '<select class="audit-select cc-move-sel"><option value="">转移到…</option>' + cats.map(function (c) {
        return '<option value="' + c.id + '">' + c.name + '</option>';
      }).join('') + '</select>';
      html += '<button class="audit-btn audit-btn-sm cc-move-btn">批量转移</button>';
      html += '<button class="audit-btn audit-btn-sm cc-dedupe-btn">一键去重</button>';
      html += '<input class="audit-input cc-newcat-input" style="width:130px;" placeholder="新分类名称">';
      html += '<button class="audit-btn audit-btn-primary audit-btn-sm cc-newcat-btn">+ 新建分类</button>';
      html += '</div>';
      html += '</div>';
      html += '<div class="cc-audit-list">';
      if (!cats.length) {
        html += '<div class="cc-audit-empty">暂无分类，先新建一个分类</div>';
      }
      cats.forEach(function (cat) {
        const cards = cat.cards || [];
        html += '<div class="cc-group" data-cat-id="' + cat.id + '">';
        html += '<div class="cc-group-head">';
        html += '<span class="cc-fold' + (cat.collapsed ? '' : ' open') + '">▶</span>';
        html += '<input type="checkbox" class="cc-check cc-cat-check" data-cat-id="' + cat.id + '">';
        html += '<span class="cc-group-title' + (cat.disabled ? ' disabled' : '') + '">' + cat.name + '</span>';
        html += '<span class="cc-group-count">(' + cards.length + ')</span>';
        if (cat.disabled) html += '<span class="cc-badge">分类已禁用</span>';
        html += '<span class="cc-group-ops">';
        html += '<button class="audit-btn audit-btn-sm cc-cat-op" data-op="up" data-cat-id="' + cat.id + '">↑</button>';
        html += '<button class="audit-btn audit-btn-sm cc-cat-op" data-op="down" data-cat-id="' + cat.id + '">↓</button>';
        html += '<button class="audit-btn audit-btn-sm cc-cat-op" data-op="rename" data-cat-id="' + cat.id + '">重命名</button>';
        html += '<button class="audit-btn audit-btn-sm cc-cat-op" data-op="toggle" data-cat-id="' + cat.id + '">' + (cat.disabled ? '启用' : '禁用') + '</button>';
        html += '<button class="audit-btn audit-btn-danger audit-btn-sm cc-cat-op" data-op="delete" data-cat-id="' + cat.id + '">删除</button>';
        html += '</span>';
        html += '</div>';
        html += '<div class="cc-group-body"' + (cat.collapsed ? ' hidden' : '') + '>';
        if (!cards.length) {
          html += '<div class="cc-audit-empty">该分类暂无字卡</div>';
        }
        cards.forEach(function (card) {
          html += '<div class="cc-card' + (card.disabled ? ' cc-card-disabled' : '') + '" data-card-id="' + card.id + '" data-cat-id="' + cat.id + '">';
          html += '<input type="checkbox" class="cc-check cc-card-check" data-card-id="' + card.id + '" data-cat-id="' + cat.id + '">';
          html += '<span class="cc-card-text' + (card.disabled ? ' disabled' : '') + '">' + escapeHTML(card.text) + '</span>';
          if (card.disabled) {
            html += '<span class="cc-badge' + (card.disabledType === 'both' ? ' both' : '') + '">' +
              (card.disabledType === 'both' ? '双方禁用' : '单方禁用') + '</span>';
          }
          html += '<span class="cc-card-ops">';
          html += '<button class="audit-btn audit-btn-sm cc-card-op" data-op="send" data-card-id="' + card.id + '" data-cat-id="' + cat.id + '">发送</button>';
          html += '<button class="audit-btn audit-btn-sm cc-card-op" data-op="edit" data-card-id="' + card.id + '" data-cat-id="' + cat.id + '">编辑</button>';
          if (card.disabled) {
            html += '<button class="audit-btn audit-btn-sm cc-card-op" data-op="restore" data-card-id="' + card.id + '" data-cat-id="' + cat.id + '">恢复</button>';
          } else {
            html += '<button class="audit-btn audit-btn-sm cc-card-op" data-op="disable" data-card-id="' + card.id + '" data-cat-id="' + cat.id + '">禁用</button>';
          }
          html += '<button class="audit-btn audit-btn-danger audit-btn-sm cc-card-op" data-op="delete" data-card-id="' + card.id + '" data-cat-id="' + cat.id + '">删除</button>';
          html += '</span>';
          html += '</div>';
        });
        html += '</div>';
        html += '</div>';
      });
      html += '</div>';
      return html;
    }
    function escapeHTML(str) {
      return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
    function countAllCards() {
      try {
        return window.__MY_AUDIT__.data.categories.reduce(function (sum, c) {
          return sum + (c.cards ? c.cards.length : 0);
        }, 0);
      } catch (e) { return 0; }
    }
    function findCat(id) {
      return window.__MY_AUDIT__.data.categories.find(function (c) { return c.id === id; });
    }
    function renderCardLibrary(host) {
      try {
        if (!host) return;
        host.innerHTML = buildHTML();
        bindHostEvents(host);
        if (hosts.indexOf(host) < 0) hosts.push(host);
      } catch (e) {
        console.warn('[Audit] 字卡库渲染失败', e);
      }
    }
    function refresh() {
      try {
        hosts.forEach(function (h) {
          if (document.body.contains(h)) renderCardLibrary(h);
        });
        const pane = document.getElementById(PANE_ID);
        if (pane && !pane.hidden && hosts.indexOf(pane) < 0) renderCardLibrary(pane);
        markTabActive(document.querySelector(TAB_SELECTOR)?.classList.contains('cc-tab-active'));
      } catch (e) {}
    }
    function selectedIds(host) {
      return Array.from(host.querySelectorAll('.cc-card-check:checked')).map(function (cb) {
        return { cardId: cb.dataset.cardId, catId: cb.dataset.catId };
      });
    }
    function bindHostEvents(host) {
      try {
        const q = function (sel) { return host.querySelector(sel); };
        const addBtn = q('.cc-add-btn');
        if (addBtn) addBtn.onclick = function () {
          try {
            const ta = q('.cc-batch-input');
            const sel = q('.cc-target-sel');
            const text = ta ? ta.value.trim() : '';
            if (!text) return toast('请输入字卡内容', '#b91c1c');
            const cat = findCat(sel ? sel.value : '');
            if (!cat) return toast('请选择分类', '#b91c1c');
            const lines = text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
            if (!lines.length) return;
            lines.forEach(function (line) {
              if (!cat.cards.some(function (c) { return c.text === line; })) {
                cat.cards.push({
                  id: genId(), text: line, disabled: false, disabledType: 'single', createTime: Date.now()
                });
              }
            });
            window.__MY_AUDIT__.save();
            ta.value = '';
            refresh();
            toast('已添加 ' + lines.length + ' 条字卡');
          } catch (e) {
            console.warn('[Audit] 批量添加失败', e);
          }
        };
        const submitBtn = q('.cc-submit-btn');
        if (submitBtn) submitBtn.onclick = function () {
          try {
            const ta = q('.cc-batch-input');
            const sel = q('.cc-target-sel');
            const text = ta ? ta.value.trim() : '';
            if (!text) return toast('请输入字卡内容', '#b91c1c');
            const cat = findCat(sel ? sel.value : '');
            if (!cat) return toast('请选择分类', '#b91c1c');
            const lines = text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
            if (!lines.length) return;
            lines.forEach(function (line) {
              window.__MY_AUDIT__.data.pending.push({
                id: genId(),
                action: 'add',
                sender: '我',
                time: Date.now(),
                targetText: line,
                targetCategory: cat.id,
                targetCatName: cat.name,
                sourceCatId: null,
                sourceCatName: null,
                cardId: null
              });
            });
            window.__MY_AUDIT__.save();
            ta.value = '';
            toast('已提交 ' + lines.length + ' 条待审核');
          } catch (e) {
            console.warn('[Audit] 提交审核失败', e);
          }
        };
        const allCheck = q('.cc-select-all');
        if (allCheck) allCheck.onchange = function () {
          host.querySelectorAll('.cc-card-check').forEach(function (cb) { cb.checked = allCheck.checked; });
          host.querySelectorAll('.cc-cat-check').forEach(function (cb) { cb.checked = allCheck.checked; });
        };
        const batchDel = q('.cc-batch-del');
        if (batchDel) batchDel.onclick = function () {
          try {
            const ids = selectedIds(host);
            if (!ids.length) return toast('请先勾选字卡', '#b45309');
            if (!confirm('确认删除选中的 ' + ids.length + ' 张字卡？')) return;
            ids.forEach(function (it) {
              const cat = findCat(it.catId);
              if (cat) cat.cards = cat.cards.filter(function (c) { return c.id !== it.cardId; });
            });
            window.__MY_AUDIT__.save();
            refresh();
            toast('已删除 ' + ids.length + ' 张字卡');
          } catch (e) {
            console.warn('[Audit] 批量删除失败', e);
          }
        };
        const moveBtn = q('.cc-move-btn');
        if (moveBtn) moveBtn.onclick = function () {
          try {
            const ids = selectedIds(host);
            const sel = q('.cc-move-sel');
            const dst = findCat(sel ? sel.value : '');
            if (!ids.length) return toast('请先勾选字卡', '#b45309');
            if (!dst) return toast('请选择目标分类', '#b45309');
            let count = 0;
            ids.forEach(function (it) {
              const src = findCat(it.catId);
              if (!src || src.id === dst.id) return;
              const idx = src.cards.findIndex(function (c) { return c.id === it.cardId; });
              if (idx < 0) return;
              const card = src.cards.splice(idx, 1)[0];
              dst.cards.push(card);
              count++;
            });
            window.__MY_AUDIT__.save();
            refresh();
            toast(count ? ('已转移 ' + count + ' 张') : '没有可转移的字卡', count ? '' : '#b45309');
          } catch (e) {
            console.warn('[Audit] 批量转移失败', e);
          }
        };
        const dedupe = q('.cc-dedupe-btn');
        if (dedupe) dedupe.onclick = function () {
          try {
            let removed = 0;
            window.__MY_AUDIT__.data.categories.forEach(function (cat) {
              const seen = new Set();
              cat.cards = cat.cards.filter(function (card) {
                const key = card.text;
                if (seen.has(key)) { removed++; return false; }
                seen.add(key);
                return true;
              });
            });
            window.__MY_AUDIT__.save();
            refresh();
            toast('去重完成，移除 ' + removed + ' 张重复字卡');
          } catch (e) {
            console.warn('[Audit] 去重失败', e);
          }
        };
        const newCatBtn = q('.cc-newcat-btn');
        if (newCatBtn) newCatBtn.onclick = function () {
          try {
            const input = q('.cc-newcat-input');
            const name = input ? input.value.trim() : '';
            if (!name) return toast('请输入分类名称', '#b91c1c');
            if (window.__MY_AUDIT__.data.categories.some(function (c) { return c.name === name; })) {
              return toast('分类已存在', '#b45309');
            }
            window.__MY_AUDIT__.data.categories.push({
              id: genId(), name: name, disabled: false, collapsed: false,
              order: window.__MY_AUDIT__.data.categories.length, cards: []
            });
            window.__MY_AUDIT__.save();
            if (input) input.value = '';
            refresh();
          } catch (e) {
            console.warn('[Audit] 新建分类失败', e);
          }
        };
        host.onclick = function (e) {
          try {
            const catCheck = e.target.classList && e.target.classList.contains('cc-cat-check') ? e.target : null;
            const fold = e.target.closest('.cc-fold');
            if (fold) {
              const group = fold.closest('.cc-group');
              const catId = group.dataset.catId;
              const cat = findCat(catId);
              if (!cat) return;
              cat.collapsed = !cat.collapsed;
              window.__MY_AUDIT__.save();
              const body = group.querySelector('.cc-group-body');
              if (body) body.hidden = cat.collapsed;
              fold.classList.toggle('open', !cat.collapsed);
              return;
            }
            const catOpBtn = e.target.closest('.cc-cat-op');
            if (catOpBtn) {
              const catId = catOpBtn.dataset.catId;
              const op = catOpBtn.dataset.op;
              const cats = window.__MY_AUDIT__.data.categories;
              const idx = cats.findIndex(function (c) { return c.id === catId; });
              if (idx < 0) return;
              const cat = cats[idx];
              if (op === 'up' && idx > 0) {
                const t = cats[idx - 1];
                cats[idx - 1] = cat;
                cats[idx] = t;
                window.__MY_AUDIT__.save();
                refresh();
              } else if (op === 'down' && idx < cats.length - 1) {
                const t = cats[idx + 1];
                cats[idx + 1] = cat;
                cats[idx] = t;
                window.__MY_AUDIT__.save();
                refresh();
              } else if (op === 'rename') {
                const name = prompt('输入新的分类名称：', cat.name);
                if (!name || !name.trim()) return;
                cat.name = name.trim();
                window.__MY_AUDIT__.save();
                refresh();
              } else if (op === 'toggle') {
                cat.disabled = !cat.disabled;
                window.__MY_AUDIT__.save();
                refresh();
                toast(cat.disabled ? '分类已禁用' : '分类已启用');
              } else if (op === 'delete') {
                if (cat.cards.length > 0) {
                  const others = cats.filter(function (c) { return c.id !== cat.id; });
                  if (!others.length) {
                    alert('这是唯一分类，请先新建其他分类再删除');
                    return;
                  }
                  const names = others.map(function (c) { return c.name; }).join('、');
                  const targetName = prompt('该分类有 ' + cat.cards.length + ' 张卡片，必须转移后才能删除。\n请输入目标分类名称：\n' + names);
                  if (!targetName) return;
                  const dst = others.find(function (c) { return c.name === targetName.trim(); });
                  if (!dst) {
                    alert('未找到该分类，删除已取消');
                    return;
                  }
                  dst.cards = dst.cards.concat(cat.cards);
                  cat.cards = [];
                }
                if (!confirm('确认删除分类「' + cat.name + '」？')) return;
                window.__MY_AUDIT__.data.categories.splice(idx, 1);
                window.__MY_AUDIT__.save();
                refresh();
              }
              return;
            }
            const cardOpBtn = e.target.closest('.cc-card-op');
            if (cardOpBtn) {
              const catId = cardOpBtn.dataset.catId;
              const cardId = cardOpBtn.dataset.cardId;
              const op = cardOpBtn.dataset.op;
              const cat = findCat(catId);
              if (!cat) return;
              const card = cat.cards.find(function (c) { return c.id === cardId; });
              if (!card) return;
              if (op === 'send') {
                const fn = window.sendAuditCard;
                if (typeof fn === 'function') {
                  fn(card.text, 'in');
                  toast('已发送到聊天');
                } else {
                  toast('发送能力未就绪', '#b45309');
                }
              } else if (op === 'edit') {
                const text = prompt('编辑字卡内容：', card.text);
                if (text == null) return;
                if (!text.trim()) return toast('内容不能为空', '#b91c1c');
                card.text = text.trim();
                window.__MY_AUDIT__.save();
                refresh();
              } else if (op === 'disable') {
                card.disabled = true;
                card.disabledType = 'single';
                window.__MY_AUDIT__.save();
                refresh();
              } else if (op === 'restore' || op === 'enable') {
                card.disabled = false;
                window.__MY_AUDIT__.save();
                refresh();
                toast('已恢复启用');
              } else if (op === 'delete') {
                if (!confirm('确认删除该字卡？')) return;
                cat.cards = cat.cards.filter(function (c) { return c.id !== cardId; });
                window.__MY_AUDIT__.save();
                refresh();
              }
              return;
            }
            if (catCheck) {
              const group = catCheck.closest('.cc-group');
              if (group) {
                group.querySelectorAll('.cc-card-check').forEach(function (cb) {
                  cb.checked = catCheck.checked;
                });
              }
            }
          } catch (err) {
            console.warn('[Audit] 字卡库事件处理失败', err);
          }
        };
      } catch (e) {
        console.warn('[Audit] 字卡库事件绑定失败', e);
      }
    }

    /* ---------------- 字卡合并对接（保留原有） ---------------- */
    function getMyAuditCardsRaw() {
      try {
        const out = [];
        window.__MY_AUDIT__.data.categories.forEach(function (cat) {
          (cat.cards || []).forEach(function (card) {
            out.push({
              id: card.id,
              text: card.text,
              groupId: cat.id,
              groupName: cat.name,
              disabled: !!card.disabled,
              disabledType: card.disabledType || 'single',
              createTime: card.createTime || 0
            });
          });
        });
        return deepClone(out);
      } catch (e) { return []; }
    }
    function myAuditCardsToGroups() {
      try {
        return window.__MY_AUDIT__.data.categories
          .filter(function (c) { return !c.disabled; })
          .map(function (c) {
            return {
              id: c.id,
              name: c.name,
              disabled: c.disabled,
              cards: (c.cards || [])
                .filter(function (card) { return !card.disabled && card.text; })
                .map(function (card) { return card.text; })
            };
          });
      } catch (e) { return []; }
    }
    function mergeMyAuditGroups(original) {
      try {
        const src = Array.isArray(original) ? deepClone(original) : [];
        const mine = myAuditCardsToGroups();
        mine.forEach(function (g) {
          const exist = src.find(function (x) { return x && x.name === g.name; });
          if (exist) {
            const set = new Set((exist.cards || []).concat(g.cards));
            exist.cards = Array.from(set);
          } else {
            src.push(g);
          }
        });
        return src;
      } catch (e) {
        return Array.isArray(original) ? original : [];
      }
    }
    /**
 * 获取合并后的完整字卡池：原生字卡 + 审核字卡
 * @param {string} cid 对话id
 * @returns {Object}
 */
function getMergeCardPool(cid) {
  // 1.读取这个cid对应的原生字卡
  const storeKey = `xy-home-v2:${cid}`;
  const rawStr = localStorage.getItem(storeKey);
  let nativeGroups = {};
  if(rawStr){
    try{
      const storeData = JSON.parse(rawStr);
      nativeGroups = storeData['cc-groups'] || {};
    }catch(e){
      nativeGroups = {};
    }
  }
  // 2.读取你的审核字卡
  const auditGroups = myAuditCardsToGroups();
  // 3.合并：同分组合并数组，不同分组保留
  const result = JSON.parse(JSON.stringify(nativeGroups));
  for(const groupName in auditGroups){
    if(!Array.isArray(result[groupName])){
      result[groupName] = [];
    }
    result[groupName] = [...result[groupName], ...auditGroups[groupName]];
  }
  return result;
}
// 调试用，挂载全局，控制台可以测试
window.getMergeCardPool = getMergeCardPool;

    /* ---------------- 初始化 ---------------- */
    function init() {
      try {
        bindTabSwitch();
        ensurePane();
        if (document.querySelector(TAB_SELECTOR)) ensurePane();
        window.addEventListener('my-audit-data-updated', function () {
          refresh();
        });
        let initTimer = null;
        const ob = new MutationObserver(function () {
          if (initTimer) return;
          initTimer = setTimeout(function () {
            initTimer = null;
            try {
              if (document.querySelector(TAB_SELECTOR) && !document.getElementById(PANE_ID)) ensurePane();
            } catch (e) {}
          }, 500);
        });
        ob.observe(document.body, { childList: true, subtree: true });
        let tries = 0;
        const timer = setInterval(function () {
          tries++;
          try {
            if (document.querySelector(TAB_SELECTOR) && !document.getElementById(PANE_ID)) ensurePane();
          } catch (e) {}
          if (tries > 30) clearInterval(timer);
        }, 2000);
        markTabActive(false);
      } catch (e) {
        console.warn('[Audit] 模块二初始化失败', e);
      }
    }
    window.getMyAuditCardsRaw = getMyAuditCardsRaw;
    window.myAuditCardsToGroups = myAuditCardsToGroups;
    window.mergeMyAuditGroups = mergeMyAuditGroups;
    window.__MY_AUDIT_CARD_UI__ = { render: renderCardLibrary, refresh: refresh };
    window.MY_AUDIT = {
      raw: getMyAuditCardsRaw,
      toGroups: myAuditCardsToGroups,
      merge: mergeMyAuditGroups,
      reload: function () {
        window.__MY_AUDIT__.reload();
        refresh();
      }
    };
    if (document.readyState === 'interactive' || document.readyState === 'complete') {
      setTimeout(init, 1200);
    } else {
      window.addEventListener('DOMContentLoaded', function () { setTimeout(init, 1200); });
    }
  })();
})();
