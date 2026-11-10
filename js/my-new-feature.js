/* =========================================================================
 * my-new-feature.js
 * 功能：字卡库拆分与审核（独立 localStorage 版）
 *
 * 存储键：localStorage['my-audit-cards']
 * 数据结构：
 * {
 *   version: 1,
 *   categories: {
 *     "主谓宾": [ { id, text, user, createdAt, approvedAt } ],
 *     "标点":   [ ... ]
 *   },
 *   pending: [ { id, text, user, category, createdAt } ]
 * }
 * ========================================================================= */
(function () {
  'use strict';

  // 防止脚本被重复引入导致 UI 重复注入
  if (window.__CARD_AUDIT_UI__) return;
  window.__CARD_AUDIT_UI__ = true;

  /* =======================================================================
   * 0. 配置
   * ===================================================================== */
  const STORAGE_KEY = 'my-audit-cards';
  const DEFAULT_CATS = ['主谓宾', '标点', '量词', '形容词', '虚词', '未分类'];
  const FALLBACK_CAT = '未分类';

  /* =======================================================================
   * 1. 工具函数
   * ===================================================================== */
  function uid() {
    return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
           ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /* =======================================================================
   * 2. 存储层
   * ===================================================================== */
  function makeEmptyStore() {
    const categories = {};
    DEFAULT_CATS.forEach(function (c) { categories[c] = []; });
    return { version: 1, categories: categories, pending: [] };
  }

  function normalizeStore(raw) {
    if (!raw || typeof raw !== 'object') return makeEmptyStore();

    const store = { version: 1, categories: {}, pending: [] };

    // 分类
    if (raw.categories && typeof raw.categories === 'object') {
      Object.keys(raw.categories).forEach(function (name) {
        const arr = raw.categories[name];
        store.categories[name] = Array.isArray(arr)
          ? arr.filter(function (x) { return x && typeof x.text === 'string'; })
          : [];
      });
    }
    // 补齐默认分类（避免旧数据缺分类）
    DEFAULT_CATS.forEach(function (c) {
      if (!store.categories[c]) store.categories[c] = [];
    });

    // 待审核
    if (Array.isArray(raw.pending)) {
      store.pending = raw.pending
        .filter(function (x) { return x && typeof x.text === 'string'; })
        .map(function (x) {
          return {
            id: typeof x.id === 'string' ? x.id : uid(),
            text: x.text,
            user: typeof x.user === 'string' ? x.user : '我',
            category: store.categories[x.category] ? x.category : FALLBACK_CAT,
            createdAt: typeof x.createdAt === 'number' ? x.createdAt : Date.now()
          };
        });
    }

    return store;
  }

  /** 读取存储；不存在或解析失败返回 null */
  function readStore() {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (s == null) return null;
      return normalizeStore(JSON.parse(s));
    } catch (e) {
      console.warn('[字卡审核] 读取 localStorage 失败：', e);
      return null;
    }
  }

  function writeStore(s) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch (e) {
      console.warn('[字卡审核] 写入 localStorage 失败：', e);
    }
  }

  /** 当前内存中的库（初始为空壳，打开弹窗时加载） */
  let store = makeEmptyStore();

  /** 弹窗打开时调用：没有 my-audit-cards 就初始化空库 */
  function ensureStore() {
    const loaded = readStore();
    if (loaded === null) {
      store = makeEmptyStore();
      writeStore(store);
    } else {
      store = loaded;
    }
    return store;
  }

  /* =======================================================================
   * 3. 样式（全部 ca- 前缀，避免污染原站样式）
   * ===================================================================== */
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
    width: min(700px, 100%);
    max-height: min(86vh, 780px);
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
    flex: 1 1 200px;
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
  .ca-select {
    flex: 0 0 auto;
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
  .ca-select:focus {
    border-color: #2f6bff;
    box-shadow: 0 0 0 3px rgba(47, 107, 255, .15);
  }
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

  /* ---------- 分类网格 ---------- */
  .ca-cats {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 10px;
  }
  .ca-cat {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid #eceff5;
    border-radius: 10px;
    background: #fff;
    color: #3b4252;
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    transition: background .16s ease, border-color .16s ease,
                color .16s ease, box-shadow .16s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .ca-cat:hover { background: #f5f9ff; border-color: #c7d7ff; }
  .ca-cat.is-active {
    background: #eef4ff;
    border-color: #2f6bff;
    color: #2f6bff;
    box-shadow: 0 0 0 3px rgba(47, 107, 255, .12);
  }
  .ca-cat-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ca-cat-count {
    font-size: 12px;
    color: #9aa1b2;
    font-variant-numeric: tabular-nums;
  }
  .ca-cat.is-active .ca-cat-count { color: #2f6bff; }

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
    .ca-modal { max-height: 88vh; border-radius: 14px; }
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

  /* =======================================================================
   * 4. 创建 DOM
   * ===================================================================== */
  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'ca-fab';
  fab.textContent = '审核';
  fab.title = '字卡库拆分与审核';

  const overlay = document.createElement('div');
  overlay.className = 'ca-overlay';
  overlay.innerHTML = `
    <div class="ca-modal" role="dialog" aria-modal="true" aria-labelledby="ca-title">
      <div class="ca-header">
        <div>
          <h2 class="ca-title" id="ca-title">字卡库拆分与审核</h2>
          <p class="ca-subtitle">独立字卡库 · 本地存储 my-audit-cards</p>
        </div>
        <button type="button" class="ca-close" aria-label="关闭">×</button>
      </div>
      <div class="ca-body">
        <section class="ca-section">
          <div class="ca-section-head">
            <h3 class="ca-h3">发起申请</h3>
            <span class="ca-hint">提交后进入待审核列表</span>
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

  const closeBtn   = overlay.querySelector('.ca-close');
  const inputEl    = overlay.querySelector('.ca-input');
  const selectEl   = overlay.querySelector('.ca-select');
  const submitBtn  = overlay.querySelector('.ca-btn-primary');
  const listEl     = overlay.querySelector('.ca-list');
  const badgeEl    = overlay.querySelector('.ca-badge');
  const catsEl     = overlay.querySelector('.ca-cats');
  const totalHintEl = overlay.querySelector('.ca-total');

  /* =======================================================================
   * 5. 渲染
   * ===================================================================== */

  /** 刷新分类下拉选项 */
  function refreshSelect() {
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
      li.textContent = '暂无待审核申请，去上方发起一个吧～';
      listEl.appendChild(li);
    } else {
      store.pending.forEach(function (item) {
        listEl.appendChild(buildPendingItem(item));
      });
    }

    badgeEl.textContent = String(store.pending.length);
  }

  /** 构建一条待审核项 */
  function buildPendingItem(item) {
    const li = document.createElement('li');
    li.className = 'ca-item';
    li.dataset.id = item.id;

    const main = document.createElement('div');
    main.className = 'ca-item-main';

    const title = document.createElement('div');
    title.className = 'ca-item-title';
    title.appendChild(document.createTextNode(item.user + ' 申请新增字卡：'));

    const cardText = document.createElement('span');
    cardText.className = 'ca-card-text';
    cardText.textContent = item.text;
    title.appendChild(cardText);

    const meta = document.createElement('div');
    meta.className = 'ca-item-meta';
    meta.textContent = '分类建议：' + item.category + ' · ' + fmtTime(item.createdAt);

    main.appendChild(title);
    main.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'ca-actions';

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'ca-btn ca-btn-ok';
    okBtn.textContent = '同意';
    okBtn.addEventListener('click', function () { approve(item.id); });

    const noBtn = document.createElement('button');
    noBtn.type = 'button';
    noBtn.className = 'ca-btn ca-btn-no';
    noBtn.textContent = '拒绝';
    noBtn.addEventListener('click', function () { reject(item.id); });

    actions.appendChild(okBtn);
    actions.appendChild(noBtn);

    li.appendChild(main);
    li.appendChild(actions);
    return li;
  }

  /** 渲染字卡库分类（含数量） */
  function renderCategories() {
    catsEl.innerHTML = '';

    let total = 0;
    Object.keys(store.categories).forEach(function (name) {
      const count = store.categories[name].length;
      total += count;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ca-cat';

      const nameEl = document.createElement('span');
      nameEl.className = 'ca-cat-name';
      nameEl.textContent = name;

      const countEl = document.createElement('span');
      countEl.className = 'ca-cat-count';
      countEl.textContent = String(count);

      btn.appendChild(nameEl);
      btn.appendChild(countEl);

      // 仅做视觉高亮，原型阶段不参与过滤
      btn.addEventListener('click', function () {
        btn.classList.toggle('is-active');
      });

      catsEl.appendChild(btn);
    });

    totalHintEl.textContent = '共 ' + total + ' 张';
  }

  /** 全量渲染 */
  function renderAll() {
    refreshSelect();
    renderPending();
    renderCategories();
  }

  /* =======================================================================
   * 6. 业务操作
   * ===================================================================== */

  /** 发起申请：写入 pending */
  function submitApplication() {
    const text = (inputEl.value || '').trim();
    if (!text) {
      inputEl.focus();
      return;
    }

    const category = selectEl.value || FALLBACK_CAT;

    store.pending.push({
      id: uid(),
      text: text,
      user: '我',
      category: store.categories[category] ? category : FALLBACK_CAT,
      createdAt: Date.now()
    });

    writeStore(store);
    inputEl.value = '';
    renderPending();
    inputEl.focus();
  }

  /** 同意：从 pending 移除并真正写入对应分类 */
  function approve(id) {
    const idx = store.pending.findIndex(function (x) { return x.id === id; });
    if (idx === -1) return;

    const item = store.pending[idx];
    store.pending.splice(idx, 1);

    const cat = store.categories[item.category] ? item.category : FALLBACK_CAT;
    if (!store.categories[cat]) store.categories[cat] = [];

    store.categories[cat].push({
      id: item.id,
      text: item.text,
      user: item.user,
      createdAt: item.createdAt,
      approvedAt: Date.now()
    });

    writeStore(store);

    // 数量在分类网格中实时刷新
    renderPending();
    renderCategories();
  }

  /** 拒绝：仅从 pending 移除 */
  function reject(id) {
    const idx = store.pending.findIndex(function (x) { return x.id === id; });
    if (idx === -1) return;

    store.pending.splice(idx, 1);
    writeStore(store);
    renderPending();
  }

  /* =======================================================================
   * 7. 打开 / 关闭
   * ===================================================================== */
  let prevBodyOverflow = '';

  function openModal() {
    ensureStore();               // 没库就初始化空库
    renderAll();                 // 用最新数据渲染
    prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    overlay.classList.add('is-open');
    setTimeout(function () { inputEl.focus(); }, 80);
  }

  function closeModal() {
    overlay.classList.remove('is-open');
    document.body.style.overflow = prevBodyOverflow;
    fab.focus();
  }

  fab.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);

  // 点遮罩空白处关闭
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeModal();
  });

  // ESC 关闭
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay.classList.contains('is-open')) closeModal();
  });

  // 表单事件
  submitBtn.addEventListener('click', submitApplication);
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitApplication();
    }
  });

  /* =======================================================================
   * 8. 挂载
   * ===================================================================== */
  function mount() {
    document.body.appendChild(fab);
    document.body.appendChild(overlay);
  }

  if (document.body) {
    mount();
  } else {
    document.addEventListener('DOMContentLoaded', mount);
  }

  /* =======================================================================
   * 9. 暴露调试接口（可选，方便控制台查看 / 重置）
   * ===================================================================== */
  window.CardAudit = {
    open: openModal,
    close: closeModal,
    getStore: function () {
      return JSON.parse(JSON.stringify(store));
    },
    reset: function () {
      store = makeEmptyStore();
      writeStore(store);
      renderAll();
    }
  };
})();
