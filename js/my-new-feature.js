/* =========================================================================
 * my-new-feature.js
 * 功能：字卡库拆分与审核（界面原型）
 * 纯原生 JS + CSS，动态创建 DOM，无需修改 index.html
 * ========================================================================= */
(function () {
  'use strict';

  // 防止重复注入（脚本被多次引入时只执行一次）
  if (window.__CARD_AUDIT_UI__) return;
  window.__CARD_AUDIT_UI__ = true;

  /* =======================================================================
   * 1. 数据区（以后接后端时，把这些常量换成接口返回的数据即可）
   * ===================================================================== */
  const PENDING_APPLICATIONS = [
    { id: 'p1', user: 'MJ',   text: '你好',   cat: '主谓宾', time: '2 分钟前'  },
    { id: 'p2', user: '小林', text: '，',     cat: '标点',   time: '15 分钟前' },
    { id: 'p3', user: 'Ava',  text: '跑得快', cat: '主谓宾', time: '1 小时前'  },
  ];

  const CATEGORIES = [
    { name: '主谓宾', count: 128 },
    { name: '标点',   count: 46  },
    { name: '量词',   count: 33  },
    { name: '形容词', count: 72  },
    { name: '虚词',   count: 18  },
    { name: '未分类', count: 9   },
  ];

  /* =======================================================================
   * 2. 样式（全部加了 ca- 前缀，避免和原页面样式冲突）
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
  .ca-overlay.is-open {
    opacity: 1;
    visibility: visible;
  }

  /* ---------- 弹窗面板 ---------- */
  .ca-modal {
    width: min(680px, 100%);
    max-height: min(84vh, 760px);
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
  .ca-overlay.is-open .ca-modal {
    transform: none;
    opacity: 1;
  }

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
  .ca-body::-webkit-scrollbar-thumb {
    background: #dfe3ec;
    border-radius: 4px;
  }
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
    transition: background .18s ease, border-color .18s ease, opacity .18s ease;
  }
  .ca-item:hover {
    background: #f6f9ff;
    border-color: #d7e0f5;
  }
  .ca-item.is-done {
    opacity: .55;
    background: #fafbfd;
  }
  .ca-item-main { flex: 1; min-width: 0; }
  .ca-item-title {
    font-size: 14px;
    line-height: 1.5;
    word-break: break-word;
  }
  .ca-card-text {
    color: #2f6bff;
    font-weight: 600;
  }
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

  /* ---------- 按钮 ---------- */
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
  .ca-btn-ok {
    background: #2f6bff;
    color: #fff;
  }
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

  /* ---------- 处理后的状态标签 ---------- */
  .ca-tag {
    padding: 5px 10px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
  }
  .ca-tag-ok { background: #e8f7ee; color: #1a9c5b; }
  .ca-tag-no { background: #fdecec; color: #e5484d; }

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
  .ca-cat:hover {
    background: #f5f9ff;
    border-color: #c7d7ff;
  }
  .ca-cat.is-active {
    background: #eef4ff;
    border-color: #2f6bff;
    color: #2f6bff;
    box-shadow: 0 0 0 3px rgba(47, 107, 255, .12);
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
    .ca-modal {
      max-height: 88vh;
      border-radius: 14px;
    }
    .ca-header { padding: 16px 16px 12px; }
    .ca-body { padding: 14px 16px 18px; }
    .ca-item {
      flex-direction: column;
      align-items: stretch;
    }
    .ca-actions { justify-content: flex-end; }
  }
  `;

  const styleEl = document.createElement('style');
  styleEl.id = 'card-audit-style';
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);

  /* =======================================================================
   * 3. 创建 DOM 元素
   * ===================================================================== */

  // ---- 右下角悬浮按钮 ----
  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'ca-fab';
  fab.textContent = '审核';
  fab.title = '字卡库拆分与审核';

  // ---- 遮罩 + 弹窗骨架 ----
  const overlay = document.createElement('div');
  overlay.className = 'ca-overlay';
  overlay.innerHTML = `
    <div class="ca-modal" role="dialog" aria-modal="true" aria-labelledby="ca-title">
      <div class="ca-header">
        <div>
          <h2 class="ca-title" id="ca-title">字卡库拆分与审核</h2>
          <p class="ca-subtitle">拆分结果确认 · 分类归档</p>
        </div>
        <button type="button" class="ca-close" aria-label="关闭">×</button>
      </div>
      <div class="ca-body">
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
            <span class="ca-hint">点击可筛选</span>
          </div>
          <div class="ca-cats"></div>
        </section>
      </div>
    </div>
  `;

  const closeBtn = overlay.querySelector('.ca-close');
  const listEl   = overlay.querySelector('.ca-list');
  const catsEl   = overlay.querySelector('.ca-cats');
  const badgeEl  = overlay.querySelector('.ca-badge');

  /* ---------- 3.1 渲染待审核列表 ---------- */
  const handled = new Set(); // 已处理的申请 id

  PENDING_APPLICATIONS.forEach(function (item) {
    const li = document.createElement('li');
    li.className = 'ca-item';
    li.dataset.id = item.id;

    // 左：标题 + 元信息
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
    meta.textContent = '分类建议：' + item.cat + ' · ' + item.time;

    main.appendChild(title);
    main.appendChild(meta);

    // 右：操作按钮
    const actions = document.createElement('div');
    actions.className = 'ca-actions';

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'ca-btn ca-btn-ok';
    okBtn.textContent = '同意';

    const noBtn = document.createElement('button');
    noBtn.type = 'button';
    noBtn.className = 'ca-btn ca-btn-no';
    noBtn.textContent = '拒绝';

    okBtn.addEventListener('click', function () {
      handleDecision(item.id, 'approved', li, actions);
    });
    noBtn.addEventListener('click', function () {
      handleDecision(item.id, 'rejected', li, actions);
    });

    actions.appendChild(okBtn);
    actions.appendChild(noBtn);

    li.appendChild(main);
    li.appendChild(actions);
    listEl.appendChild(li);
  });

  /**
   * 处理一条申请（同意 / 拒绝）
   * 目前只做 UI 反馈，后续可在这里调用后端接口
   */
  function handleDecision(id, decision, li, actionsEl) {
    if (handled.has(id)) return;
    handled.add(id);

    actionsEl.innerHTML = '';
    const tag = document.createElement('span');
    tag.className = 'ca-tag ' + (decision === 'approved' ? 'ca-tag-ok' : 'ca-tag-no');
    tag.textContent = decision === 'approved' ? '已同意' : '已拒绝';
    actionsEl.appendChild(tag);

    li.classList.add('is-done');
    updateBadge();

    // TODO: 这里换成真实请求，例如
    // fetch('/api/card-applications/' + id, { method: 'PATCH', body: ... })
  }

  function updateBadge() {
    const left = PENDING_APPLICATIONS.length - handled.size;
    badgeEl.textContent = String(left);
  }

  /* ---------- 3.2 渲染字卡库分类 ---------- */
  CATEGORIES.forEach(function (cat) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ca-cat';

    const nameEl = document.createElement('span');
    nameEl.className = 'ca-cat-name';
    nameEl.textContent = cat.name;

    const countEl = document.createElement('span');
    countEl.className = 'ca-cat-count';
    countEl.textContent = String(cat.count);

    btn.appendChild(nameEl);
    btn.appendChild(countEl);

    // 点击切换选中态（原型阶段仅做视觉反馈）
    btn.addEventListener('click', function () {
      btn.classList.toggle('is-active');
    });

    catsEl.appendChild(btn);
  });

  updateBadge();

  /* =======================================================================
   * 4. 打开 / 关闭逻辑
   * ===================================================================== */
  let prevBodyOverflow = '';

  function openModal() {
    prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // 锁定背景滚动
    overlay.classList.add('is-open');
    closeBtn.focus();
  }

  function closeModal() {
    overlay.classList.remove('is-open');
    document.body.style.overflow = prevBodyOverflow;
    fab.focus();
  }

  fab.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);

  // 点击遮罩空白处关闭（点击弹窗内部不关闭）
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeModal();
  });

  // ESC 关闭
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay.classList.contains('is-open')) {
      closeModal();
    }
  });

  /* =======================================================================
   * 5. 挂载到页面
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

  // 方便在控制台调试 / 后续由其它逻辑触发
  window.CardAudit = {
    open: openModal,
    close: closeModal
  };
})();
