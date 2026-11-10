/* =========================================================================
 * my-new-feature.js
 * 赛博伴侣（梦角）自动字卡系统
 *
 * 存储键：localStorage['my-audit-cards']
 * 数据格式：
 * {
 *   categories: { '主谓宾': [ {id, text, user, createdAt, approvedAt} ], ... },
 *   pending:    [ {id, text, user, category, createdAt} ]
 * }
 * ========================================================================= */
(function () {
  'use strict';

  // 防重复注入
  if (window.__CARD_AUDIT_UI__) return;
  window.__CARD_AUDIT_UI__ = true;

  /* =====================================================================
   * 0. 配置
   * =================================================================== */
  const STORAGE_KEY   = 'my-audit-cards';
  const CHAT_MSGS_KEY = 'xy-home-v2:default:chat-msgs';
  const DEFAULT_CATS  = ['主谓宾', '标点', '量词', '形容词', '虚词', '未分类'];
  const FALLBACK_CAT  = '未分类';

  const TICK_MS       = 10 * 60 * 1000; // 10 分钟
  const GRAB_PROB     = 0.1;            // 10%
  const MAX_PENDING   = 5;              // 待审核最多 5 条
  const RECENT_MS     = 10 * 60 * 1000; // 最近 10 分钟
  const MIN_LEN       = 5;
  const MAX_LEN       = 30;

  /* =====================================================================
   * 1. 工具函数
   * =================================================================== */
  function uid() {
    return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function fmtTime(ts) {
    if (typeof ts !== 'number' || !isFinite(ts)) return '';
    const d = new Date(ts);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function countChars(s) {
    return Array.from(String(s)).length;
  }

  /* =====================================================================
   * 2. 存储层
   * =================================================================== */
  function makeEmptyStore() {
    const categories = {};
    DEFAULT_CATS.forEach(function (c) { categories[c] = []; });
    return { categories: categories, pending: [] };
  }

  function normalizeStore(raw) {
    const out = makeEmptyStore();
    if (!raw || typeof raw !== 'object') return out;

    // 分类
    if (raw.categories && typeof raw.categories === 'object') {
      Object.keys(raw.categories).forEach(function (name) {
        if (!name || typeof name !== 'string') return;
        const arr = raw.categories[name];
        if (!Array.isArray(arr)) { out.categories[name] = []; return; }
        out.categories[name] = arr
          .filter(function (x) {
            return x && typeof x.text === 'string' && x.text.trim();
          })
          .map(function (x) {
            return {
              id: typeof x.id === 'string' ? x.id : uid(),
              text: String(x.text),
              user: typeof x.user === 'string' ? x.user : '我',
              createdAt: typeof x.createdAt === 'number' ? x.createdAt : Date.now(),
              approvedAt: typeof x.approvedAt === 'number' ? x.approvedAt : Date.now()
            };
          });
      });
    }
    // 补齐默认分类
    DEFAULT_CATS.forEach(function (c) {
      if (!Array.isArray(out.categories[c])) out.categories[c] = [];
    });

    // 待审核
    if (Array.isArray(raw.pending)) {
      out.pending = raw.pending
        .filter(function (x) {
          return x && typeof x.text === 'string' && x.text.trim();
        })
        .map(function (x) {
          let cat = typeof x.category === 'string' ? x.category : FALLBACK_CAT;
          if (!out.categories[cat]) cat = FALLBACK_CAT;
          return {
            id: typeof x.id === 'string' ? x.id : uid(),
            text: String(x.text),
            user: typeof x.user === 'string' ? x.user : '我',
            category: cat,
            createdAt: typeof x.createdAt === 'number' ? x.createdAt : Date.now()
          };
        })
        .slice(0, MAX_PENDING);
    }

    return out;
  }

  function readStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw == null) return null;
      return normalizeStore(JSON.parse(raw));
    } catch (e) {
      console.warn('[字卡系统] 读取 localStorage 失败：', e);
      return null;
    }
  }

  function writeStore(s) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch (e) {
      console.warn('[字卡系统] 写入 localStorage 失败：', e);
    }
  }

  // 内存中的库
  let store = makeEmptyStore();

  function loadStore() {
    const loaded = readStore();
    if (loaded === null) {
      store = makeEmptyStore();
      writeStore(store);
    } else {
      store = loaded;
    }
    return store;
  }

  /** 判断文本是否已在任意分类或待审核中 */
  function existsText(text) {
    const t = String(text).trim();
    if (!t) return true;

    const names = Object.keys(store.categories);
    for (let i = 0; i < names.length; i++) {
      const arr = store.categories[names[i]];
      for (let j = 0; j < arr.length; j++) {
        if (arr[j].text.trim() === t) return true;
      }
    }
    for (let i = 0; i < store.pending.length; i++) {
      if (store.pending[i].text.trim() === t) return true;
    }
    return false;
  }

  /* =====================================================================
   * 3. 样式
   * =================================================================== */
  const CSS = `
  /* ---------- 右下角悬浮按钮 ---------- */
  .ca-fab {
    position: fixed;
    right: 24px;
    bottom: 24px;
    width: 64px;
    height: 64px;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    color: #fff;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 1px;
    font-family: inherit;
    background: linear-gradient(135deg, #4f8cff 0%, #2f6bff 100%);
    box-shadow: 0 8px 24px rgba(47, 107, 255, 0.45);
    z-index: 99998;
    transition: transform .18s ease, box-shadow .18s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .ca-fab:hover {
    transform: translateY(-2px) scale(1.05);
    box-shadow: 0 12px 30px rgba(47, 107, 255, 0.55);
  }
  .ca-fab:active { transform: scale(0.95); }

  .ca-fab-badge {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    box-sizing: border-box;
    display: none;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    background: #ff3b3b;
    color: #fff;
    font-size: 12px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    border: 2px solid #fff;
    box-shadow: 0 2px 8px rgba(255, 59, 59, 0.5);
    pointer-events: none;
  }

  /* ---------- 遮罩层 ---------- */
  .ca-overlay {
    position: fixed;
    inset: 0;
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    box-sizing: border-box;
    background: rgba(0, 0, 0, 0.55);
    -webkit-backdrop-filter: blur(3px);
    backdrop-filter: blur(3px);
    opacity: 0;
    visibility: hidden;
    transition: opacity .22s ease, visibility .22s ease;
  }
  .ca-overlay.is-open { opacity: 1; visibility: visible; }

  /* ---------- 弹窗面板 ---------- */
  .ca-modal {
    width: min(720px, 100%);
    max-height: min(88vh, 820px);
    display: flex;
    flex-direction: column;
    background: #fff;
    border-radius: 18px;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.35);
    overflow: hidden;
    color: #1f2430;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
                 "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    transform: translateY(14px) scale(0.96);
    opacity: 0;
    transition: transform .26s cubic-bezier(.2, .8, .3, 1), opacity .26s ease;
  }
  .ca-overlay.is-open .ca-modal { transform: none; opacity: 1; }

  /* ---------- 头部 ---------- */
  .ca-header {
    flex: none;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 20px 24px 16px;
    border-bottom: 1px solid #eef0f4;
  }
  .ca-title {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: .5px;
  }
  .ca-subtitle {
    margin: 5px 0 0;
    font-size: 12px;
    color: #8a90a2;
  }
  .ca-close {
    flex: none;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: #f2f4f8;
    color: #6b7280;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    font-family: inherit;
    transition: background .15s ease, color .15s ease;
  }
  .ca-close:hover { background: #e6e9f0; color: #1f2430; }

  /* ---------- 内容区 ---------- */
  .ca-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 18px 24px 24px;
    -webkit-overflow-scrolling: touch;
  }
  .ca-body::-webkit-scrollbar { width: 8px; }
  .ca-body::-webkit-scrollbar-thumb { background: #dfe3ec; border-radius: 4px; }
  .ca-body::-webkit-scrollbar-thumb:hover { background: #c9cfdc; }

  /* ---------- 区块 ---------- */
  .ca-section + .ca-section {
    margin-top: 22px;
    padding-top: 20px;
    border-top: 1px dashed #e8ebf1;
  }
  .ca-section-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }
  .ca-h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: #3b4252;
  }
  .ca-badge {
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    background: #ff5a5f;
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .ca-hint {
    margin-left: auto;
    font-size: 12px;
    color: #a0a6b5;
  }

  /* ---------- 发起申请表单 ---------- */
  .ca-form {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .ca-input {
    flex: 1 1 220px;
    min-width: 0;
    padding: 9px 12px;
    border: 1px solid #dfe3ec;
    border-radius: 8px;
    font-size: 13px;
    font-family: inherit;
    color: #1f2430;
    background: #fff;
    outline: none;
    transition: border-color .16s ease, box-shadow .16s ease;
  }
  .ca-input:focus {
    border-color: #2f6bff;
    box-shadow: 0 0 0 3px rgba(47, 107, 255, .15);
  }
  .ca-select,
  .ca-select-sm {
    padding: 9px 12px;
    border: 1px solid #dfe3ec;
    border-radius: 8px;
    font-size: 13px;
    font-family: inherit;
    color: #1f2430;
    background: #fff;
    outline: none;
    cursor: pointer;
    transition: border-color .16s ease, box-shadow .16s ease;
  }
  .ca-select:focus,
  .ca-select-sm:focus {
    border-color: #2f6bff;
    box-shadow: 0 0 0 3px rgba(47, 107, 255, .15);
  }
  .ca-select-sm { padding: 5px 8px; font-size: 12px; }

  .ca-btn-primary {
    padding: 9px 18px;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    color: #fff;
    cursor: pointer;
    background: linear-gradient(135deg, #4f8cff, #2f6bff);
    transition: filter .16s ease, transform .16s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .ca-btn-primary:hover { filter: brightness(1.05); }
  .ca-btn-primary:active { transform: scale(.97); }

  /* ---------- 待审核列表 ---------- */
  .ca-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .ca-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border: 1px solid #eceff5;
    border-radius: 12px;
    background: #fafbfd;
    transition: background .18s ease, border-color .18s ease;
  }
  .ca-item:hover { background: #f6f9ff; border-color: #d7e0f5; }
  .ca-item-main { flex: 1; min-width: 0; }
  .ca-item-title {
    font-size: 14px;
    line-height: 1.5;
    word-break: break-word;
  }
  .ca-card-text { color: #2f6bff; font-weight: 600; }
  .ca-item-meta {
    margin-top: 4px;
    font-size: 12px;
    color: #8a90a2;
  }
  .ca-item-cat {
    margin-top: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .ca-cat-label {
    font-size: 12px;
    color: #8a90a2;
  }
  .ca-actions {
    flex: none;
    display: flex;
    gap: 8px;
  }
  .ca-btn {
    padding: 7px 14px;
    border: 1px solid transparent;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: background .16s ease, color .16s ease, border-color .16s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .ca-btn-ok { background: #2f6bff; color: #fff; }
  .ca-btn-ok:hover { background: #1f56e0; }
  .ca-btn-no {
    background: #fff;
    color: #6b7280;
    border-color: #dfe3ec;
  }
  .ca-btn-no:hover {
    background: #fff1f1;
    border-color: #ffc9c9;
    color: #e5484d;
  }

  /* ---------- 空状态 ---------- */
  .ca-empty {
    padding: 22px 12px;
    text-align: center;
    font-size: 13px;
    color: #a0a6b5;
    border: 1px dashed #e2e7f0;
    border-radius: 12px;
    background: #fbfcfe;
    list-style: none;
  }

  /* ---------- 分类列表 ---------- */
  .ca-cats {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .ca-cat-row {
    border: 1px solid #eceff5;
    border-radius: 12px;
    background: #fff;
    overflow: hidden;
    transition: border-color .16s ease, box-shadow .16s ease;
  }
  .ca-cat-row:hover { border-color: #d7e0f5; }
  .ca-cat {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 14px;
    border: none;
    background: transparent;
    font-size: 13px;
    font-family: inherit;
    color: #3b4252;
    cursor: pointer;
    text-align: left;
    transition: background .16s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .ca-cat:hover { background: #f5f9ff; }
  .ca-cat-arrow {
    width: 12px;
    flex: none;
    color: #9aa1b2;
    font-size: 11px;
  }
  .ca-cat-name {
    flex: 1;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ca-cat-count {
    flex: none;
    padding: 1px 8px;
    border-radius: 10px;
    background: #eef1f7;
    font-size: 12px;
    color: #6b7280;
    font-variant-numeric: tabular-nums;
  }
  .ca-cat-row.is-active { border-color: #c7d7ff; box-shadow: 0 0 0 3px rgba(47, 107, 255, .08); }
  .ca-cat-row.is-active .ca-cat-name { color: #2f6bff; }
  .ca-cat-row.is-active .ca-cat-arrow { color: #2f6bff; }

  .ca-cards-box {
    padding: 4px 14px 12px;
    border-top: 1px dashed #edf0f6;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ca-cards-empty {
    padding: 10px 0;
    font-size: 12px;
    color: #a0a6b5;
    text-align: center;
  }
  .ca-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 8px;
    background: #fafbfd;
    border: 1px solid #f0f2f7;
  }
  .ca-card-txt {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    color: #2b3140;
    word-break: break-word;
  }
  .ca-card-ops {
    flex: none;
    display: flex;
    gap: 6px;
  }
  .ca-mini-btn {
    padding: 4px 10px;
    border: 1px solid #dfe3ec;
    border-radius: 6px;
    background: #fff;
    font-size: 12px;
    font-family: inherit;
    color: #4a5060;
    cursor: pointer;
    transition: background .15s ease, border-color .15s ease, color .15s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .ca-mini-btn:hover {
    background: #f0f5ff;
    border-color: #c7d7ff;
    color: #2f6bff;
  }
  .ca-mini-danger:hover {
    background: #fff1f1;
    border-color: #ffc9c9;
    color: #e5484d;
  }

  /* ---------- 小屏适配 ---------- */
  @media (max-width: 520px) {
    .ca-fab {
      right: 16px;
      bottom: 16px;
      width: 56px;
      height: 56px;
      font-size: 14px;
    }
    .ca-overlay { padding: 12px; }
    .ca-modal { max-height: 90vh; border-radius: 14px; }
    .ca-header { padding: 16px 16px 12px; }
    .ca-body { padding: 14px 16px 18px; }
    .ca-item { flex-direction: column; align-items: stretch; }
    .ca-actions { justify-content: flex-end; }
  }
  `;

  const styleEl = document.createElement('style');
  styleEl.id = 'card-audit-style';
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);

  /* =====================================================================
   * 4. 创建 DOM
   * =================================================================== */
  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'ca-fab';
  fab.title = '字卡审核与管理';
  fab.innerHTML = '<span class="ca-fab-label">审核</span>' +
                  '<span class="ca-fab-badge"></span>';
  const fabBadge = fab.querySelector('.ca-fab-badge');

  const overlay = document.createElement('div');
  overlay.className = 'ca-overlay';
  overlay.innerHTML = `
    <div class="ca-modal" role="dialog" aria-modal="true" aria-labelledby="ca-title">
      <div class="ca-header">
        <div>
          <h2 class="ca-title" id="ca-title">字卡审核与管理</h2>
          <p class="ca-subtitle">赛博伴侣 · 自动字卡系统</p>
        </div>
        <button type="button" class="ca-close" aria-label="关闭">×</button>
      </div>
      <div class="ca-body">
        <section class="ca-section">
          <div class="ca-section-head">
            <h3 class="ca-h3">发起申请</h3>
            <span class="ca-hint">手动添加一条待审核字卡</span>
          </div>
          <div class="ca-form">
            <input class="ca-input" type="text" placeholder="输入字卡内容，如：你好" maxlength="50" />
            <select class="ca-select"></select>
            <button type="button" class="ca-btn-primary">发起申请</button>
          </div>
        </section>

        <section class="ca-section">
          <div class="ca-section-head">
            <h3 class="ca-h3">待审核申请列表</h3>
            <span class="ca-badge">0</span>
          </div>
          <ul class="ca-list"></ul>
        </section>

        <section class="ca-section">
          <div class="ca-section-head">
            <h3 class="ca-h3">字卡库分类</h3>
            <span class="ca-hint ca-total">共 0 张</span>
          </div>
          <div class="ca-cats"></div>
        </section>
      </div>
    </div>
  `;

  const closeBtn    = overlay.querySelector('.ca-close');
  const inputEl     = overlay.querySelector('.ca-input');
  const selectEl    = overlay.querySelector('.ca-select');
  const submitBtn   = overlay.querySelector('.ca-btn-primary');
  const listEl      = overlay.querySelector('.ca-list');
  const badgeEl     = overlay.querySelector('.ca-badge');
  const catsEl      = overlay.querySelector('.ca-cats');
  const totalHintEl = overlay.querySelector('.ca-total');

  /* =====================================================================
   * 5. 渲染层
   * =================================================================== */
  let expandedCat = null; // 当前展开的分类名

  /** 刷新发起申请表单的分类下拉 */
  function refreshFormSelect() {
    const current = selectEl.value;
    selectEl.innerHTML = '';
    Object.keys(store.categories).forEach(function (name) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      selectEl.appendChild(opt);
    });
    if (current && store.categories[current]) {
      selectEl.value = current;
    }
  }

  /** 渲染待审核列表 */
  function renderPending() {
    listEl.innerHTML = '';

    if (store.pending.length === 0) {
      const li = document.createElement('li');
      li.className = 'ca-empty';
      li.textContent = '暂无待审核申请';
      listEl.appendChild(li);
    } else {
      store.pending.forEach(function (item) {
        listEl.appendChild(buildPendingItem(item));
      });
    }

    badgeEl.textContent = String(store.pending.length);
  }

  function buildPendingItem(item) {
    const li = document.createElement('li');
    li.className = 'ca-item';

    const main = document.createElement('div');
    main.className = 'ca-item-main';

    const title = document.createElement('div');
    title.className = 'ca-item-title';
    title.appendChild(document.createTextNode('「'));
    const span = document.createElement('span');
    span.className = 'ca-card-text';
    span.textContent = item.text;
    title.appendChild(span);
    title.appendChild(document.createTextNode('」'));
    main.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'ca-item-meta';
    meta.textContent = item.user + ' · ' + fmtTime(item.createdAt);
    main.appendChild(meta);

    // 分类下拉
    const catRow = document.createElement('div');
    catRow.className = 'ca-item-cat';

    const label = document.createElement('span');
    label.className = 'ca-cat-label';
    label.textContent = '归入分类：';

    const sel = document.createElement('select');
    sel.className = 'ca-select-sm';
    Object.keys(store.categories).forEach(function (name) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === item.category) opt.selected = true;
      sel.appendChild(opt);
    });

    catRow.appendChild(label);
    catRow.appendChild(sel);
    main.appendChild(catRow);

    // 操作按钮
    const actions = document.createElement('div');
    actions.className = 'ca-actions';

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'ca-btn ca-btn-ok';
    okBtn.textContent = '同意';
    okBtn.addEventListener('click', function () {
      approve(item.id, sel.value);
    });

    const noBtn = document.createElement('button');
    noBtn.type = 'button';
    noBtn.className = 'ca-btn ca-btn-no';
    noBtn.textContent = '拒绝';
    noBtn.addEventListener('click', function () {
      reject(item.id);
    });

    actions.appendChild(okBtn);
    actions.appendChild(noBtn);

    li.appendChild(main);
    li.appendChild(actions);
    return li;
  }

  /** 渲染字卡库分类（可展开） */
  function renderCategories() {
    catsEl.innerHTML = '';

    let total = 0;
    const names = Object.keys(store.categories);

    names.forEach(function (name) {
      const arr = store.categories[name];
      total += arr.length;

      const row = document.createElement('div');
      row.className = 'ca-cat-row' + (expandedCat === name ? ' is-active' : '');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ca-cat';

      const arrow = document.createElement('span');
      arrow.className = 'ca-cat-arrow';
      arrow.textContent = expandedCat === name ? '▾' : '▸';

      const nameEl = document.createElement('span');
      nameEl.className = 'ca-cat-name';
      nameEl.textContent = name;

      const countEl = document.createElement('span');
      countEl.className = 'ca-cat-count';
      countEl.textContent = String(arr.length);

      btn.appendChild(arrow);
      btn.appendChild(nameEl);
      btn.appendChild(countEl);

      btn.addEventListener('click', function () {
        expandedCat = (expandedCat === name) ? null : name;
        renderCategories();
      });

      row.appendChild(btn);

      if (expandedCat === name) {
        const box = document.createElement('div');
        box.className = 'ca-cards-box';

        if (arr.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'ca-cards-empty';
          empty.textContent = '该分类暂无字卡';
          box.appendChild(empty);
        } else {
          arr.forEach(function (card) {
            box.appendChild(buildCardItem(name, card));
          });
        }

        row.appendChild(box);
      }

      catsEl.appendChild(row);
    });

    totalHintEl.textContent = '共 ' + total + ' 张';
  }

  function buildCardItem(catName, card) {
    const wrap = document.createElement('div');
    wrap.className = 'ca-card';

    const textEl = document.createElement('span');
    textEl.className = 'ca-card-txt';
    textEl.textContent = card.text;

    const ops = document.createElement('div');
    ops.className = 'ca-card-ops';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'ca-mini-btn';
    editBtn.textContent = '编辑';
    editBtn.addEventListener('click', function () {
      editCard(catName, card.id);
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'ca-mini-btn ca-mini-danger';
    delBtn.textContent = '删除';
    delBtn.addEventListener('click', function () {
      deleteCard(catName, card.id);
    });

    ops.appendChild(editBtn);
    ops.appendChild(delBtn);

    wrap.appendChild(textEl);
    wrap.appendChild(ops);
    return wrap;
  }

  function renderAll() {
    refreshFormSelect();
    renderPending();
    renderCategories();
  }

  /* =====================================================================
   * 6. 业务操作
   * =================================================================== */

  /** 手动发起申请 */
  function submitApplication() {
    const text = (inputEl.value || '').trim();
    if (!text) {
      inputEl.focus();
      return;
    }
    if (store.pending.length >= MAX_PENDING) {
      return;
    }
    if (existsText(text)) {
      inputEl.value = '';
      return;
    }

    let cat = selectEl.value || FALLBACK_CAT;
    if (!store.categories[cat]) cat = FALLBACK_CAT;

    store.pending.push({
      id: uid(),
      text: text,
      user: '我',
      category: cat,
      createdAt: Date.now()
    });
    writeStore(store);
    inputEl.value = '';
    renderPending();
    inputEl.focus();
  }

  /** 同意：写入分类 */
  function approve(id, catName) {
    const idx = store.pending.findIndex(function (x) { return x.id === id; });
    if (idx === -1) return;

    const item = store.pending[idx];
    store.pending.splice(idx, 1);

    let cat = catName && store.categories[catName] ? catName : FALLBACK_CAT;
    if (!store.categories[cat]) store.categories[cat] = [];

    store.categories[cat].push({
      id: item.id,
      text: item.text,
      user: item.user,
      createdAt: item.createdAt,
      approvedAt: Date.now()
    });

    writeStore(store);
    renderPending();
    renderCategories();
  }

  /** 拒绝：仅移除 */
  function reject(id) {
    const idx = store.pending.findIndex(function (x) { return x.id === id; });
    if (idx === -1) return;
    store.pending.splice(idx, 1);
    writeStore(store);
    renderPending();
  }

  /** 编辑字卡 */
  function editCard(catName, cardId) {
    const arr = store.categories[catName];
    if (!arr) return;
    const idx = arr.findIndex(function (x) { return x.id === cardId; });
    if (idx === -1) return;

    const cur = arr[idx].text;
    let next = null;
    try {
      next = window.prompt('编辑字卡内容：', cur);
    } catch (e) {
      return;
    }
    if (next == null) return;

    next = String(next).trim();
    if (!next || next === cur) return;

    arr[idx].text = next;
    writeStore(store);
    renderCategories();
  }

  /** 删除字卡 */
  function deleteCard(catName, cardId) {
    const arr = store.categories[catName];
    if (!arr) return;
    const idx = arr.findIndex(function (x) { return x.id === cardId; });
    if (idx === -1) return;

    let ok = true;
    try {
      ok = window.confirm('确定删除该字卡？\n「' + arr[idx].text + '」');
    } catch (e) {}
    if (!ok) return;

    arr.splice(idx, 1);
    writeStore(store);
    renderCategories();
  }

  /* =====================================================================
   * 7. 未读角标
   * =================================================================== */
  let unread = 0;

  function updateFabBadge() {
    if (unread > 0) {
      fabBadge.textContent = unread > 99 ? '99+' : String(unread);
      fabBadge.style.display = 'flex';
    } else {
      fabBadge.textContent = '';
      fabBadge.style.display = 'none';
    }
  }

  /* =====================================================================
   * 8. 模块一：自动抓取
   * =================================================================== */
  function getMsgText(m) {
    if (!m || typeof m !== 'object') return '';
    const cand = [m.text, m.content, m.message, m.msg, m.body];
    for (let i = 0; i < cand.length; i++) {
      if (typeof cand[i] === 'string' && cand[i].trim()) return cand[i].trim();
    }
    return '';
  }

  function getMsgTime(m) {
    if (!m || typeof m !== 'object') return null;
    const cand = [m.ts, m.timestamp, m.createdAt, m.time, m.date, m.sendTime];
    for (let i = 0; i < cand.length; i++) {
      const v = cand[i];
      if (v == null) continue;

      if (typeof v === 'number' && isFinite(v)) {
        return v < 1e12 ? v * 1000 : v;
      }
      if (typeof v === 'string') {
        const n = Number(v);
        if (!isNaN(n) && isFinite(n) && n > 0) {
          return n < 1e12 ? n * 1000 : n;
        }
        const p = Date.parse(v);
        if (!isNaN(p)) return p;
      }
    }
    return null;
  }

  /** 从聊天记录中抓取候选句子，返回新增条数 */
  function grabFromChat() {
    // 保证使用最新库
    loadStore();

    // 已满 5 条则暂停
    if (store.pending.length >= MAX_PENDING) return 0;

    let raw = null;
    try {
      raw = localStorage.getItem(CHAT_MSGS_KEY);
    } catch (e) {
      return 0;
    }
    if (!raw) return 0;

    let msgs = null;
    try {
      msgs = JSON.parse(raw);
    } catch (e) {
      console.warn('[字卡系统] 聊天记录解析失败：', e);
      return 0;
    }
    if (!Array.isArray(msgs) || msgs.length === 0) return 0;

    const now = Date.now();
    const candidates = [];

    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (!m || typeof m !== 'object') continue;

      // 只取用户发出
      if (m.side !== 'out') continue;

      // 最近 10 分钟
      const ts = getMsgTime(m);
      if (ts == null) continue;
      if (now - ts > RECENT_MS) continue;

      // 文本
      const text = getMsgText(m);
      if (!text) continue;

      // 字数 5 ~ 30
      const len = countChars(text);
      if (len < MIN_LEN || len > MAX_LEN) continue;

      // 去重：库或待审核
      if (existsText(text)) continue;

      // 本批次内去重
      let dup = false;
      for (let k = 0; k < candidates.length; k++) {
        if (candidates[k].text === text) { dup = true; break; }
      }
      if (dup) continue;

      candidates.push({ text: text, ts: ts });
    }

    if (candidates.length === 0) return 0;

    // 按时间升序，优先较早的
    candidates.sort(function (a, b) { return a.ts - b.ts; });

    let added = 0;
    for (let i = 0; i < candidates.length; i++) {
      if (store.pending.length >= MAX_PENDING) break;

      store.pending.push({
        id: uid(),
        text: candidates[i].text,
        user: '自动抓取',
        category: FALLBACK_CAT,
        createdAt: Date.now()
      });
      added++;
    }

    if (added > 0) {
      writeStore(store);
    }
    return added;
  }

  /** 定时器回调 */
  function tick() {
    // 先按概率决定是否抓取
    if (Math.random() >= GRAB_PROB) return;

    const added = grabFromChat();
    if (added <= 0) return;

    // 更新未读角标
    unread += added;
    updateFabBadge();

    // 若面板正开着，实时刷新列表
    if (overlay.classList.contains('is-open')) {
      renderPending();
      renderCategories();
    }
  }

  /* =====================================================================
   * 9. 打开 / 关闭
   * =================================================================== */
  let prevBodyOverflow = '';

  function openModal() {
    loadStore();

    // 打开即清除未读
    unread = 0;
    updateFabBadge();

    renderAll();

    prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    overlay.classList.add('is-open');

    setTimeout(function () {
      try { inputEl.focus(); } catch (e) {}
    }, 80);
  }

  function closeModal() {
    overlay.classList.remove('is-open');
    document.body.style.overflow = prevBodyOverflow || '';
    try { fab.focus(); } catch (e) {}
  }

  /* =====================================================================
   * 10. 事件绑定
   * =================================================================== */
  fab.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);

  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeModal();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay.classList.contains('is-open')) {
      closeModal();
    }
  });

  submitBtn.addEventListener('click', submitApplication);
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitApplication();
    }
  });

  /* =====================================================================
   * 11. 挂载 + 启动定时器
   * =================================================================== */
  function mount() {
    // 先确保库存在（页面打开时若不存在则初始化）
    loadStore();

    document.body.appendChild(fab);
    document.body.appendChild(overlay);

    updateFabBadge();

    // 启动低频定时器：每 10 分钟尝试一次
    try {
      setInterval(tick, TICK_MS);
    } catch (e) {
      console.warn('[字卡系统] 定时器启动失败：', e);
    }
  }

  if (document.body) {
    mount();
  } else {
    document.addEventListener('DOMContentLoaded', mount);
  }

  /* =====================================================================
   * 12. 调试接口（可选）
   * =================================================================== */
  window.CardAudit = {
    open: openModal,
    close: closeModal,
    /** 手动立即尝试一次抓取（便于测试，不受 10% 概率限制） */
    grabNow: function () {
      loadStore();
      const added = grabFromChat();
      if (added > 0) {
        unread += added;
        updateFabBadge();
        if (overlay.classList.contains('is-open')) {
          renderPending();
          renderCategories();
        }
      }
      return added;
    },
    /** 查看当前存储 */
    getStore: function () {
      loadStore();
      return JSON.parse(JSON.stringify(store));
    },
    /** 重置为空库 */
    reset: function () {
      store = makeEmptyStore();
      writeStore(store);
      unread = 0;
      expandedCat = null;
      updateFabBadge();
      renderAll();
    }
  };
})();
