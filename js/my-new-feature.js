/* =========================================================================
 * my-new-feature.js
 * 赛博伴侣（梦角）字卡审核与管理系统 —— 终极完整版
 * (包含：自动抓取、AI捣乱、自动抽卡发送、一键发送、无刷新兜底)
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__MY_NEW_FEATURE_LOADED__) return;
  window.__MY_NEW_FEATURE_LOADED__ = true;

  /* =======================================================================
   * 0. 常量与配置
   * ===================================================================== */
  var LS_KEY = 'my-audit-cards';
  var CHAT_KEY = 'xy-home-v2:default:chat-msgs';
  var MAX_PENDING = 5;
  var FETCH_INTERVAL = 30 * 60 * 1000; // 30分钟抓取一次
  var DEFAULT_CATEGORY = '未分类';

  var DEFAULT_SETTINGS = {
    ballColor: '#6c8cff',
    ballSize: 56,
    ballImage: '',
    position: null,
    isHidden: false,
    appIconColor: '#f4f4f5',
    appIconImage: '',
    iconPage: 0,
    iconIndex: 0
  };

  // 救命后门：?show_audit=true
  var isForceShow = false;
  try {
    var searchParams = new URLSearchParams(window.location.search);
    isForceShow = searchParams.get('show_audit') === 'true';
  } catch (e) {
    isForceShow = /(?:\?|&)show_audit=true(?:&|$)/.test(window.location.search);
  }

  /* =======================================================================
   * 1. 基础工具函数
   * ===================================================================== */
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var escAttr = esc;
  function normalizeHex(v) {
    return /^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v) : '#6c8cff';
  }
  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  /* =======================================================================
   * 2. 数据层处理
   * ===================================================================== */
  function normalizeCard(item) {
    if (!item) return null;
    if (typeof item === 'string') {
      var t = item.trim();
      return t ? { id: uid(), text: t, isDisabled: false } : null;
    }
    if (typeof item === 'object') {
      var text = String(item.text != null ? item.text : (item.content || '')).trim();
      if (!text) return null;
      return { 
        id: String(item.id || uid()), 
        text: text, 
        isDisabled: !!item.isDisabled 
      };
    }
    return null;
  }

  function normalizePending(item) {
    if (typeof item === 'string') {
      var t0 = item.trim();
      return t0 ? { id: uid(), action: 'add', text: t0, category: DEFAULT_CATEGORY, targetCategory: '', sender: '我' } : null;
    }
    if (!item || typeof item !== 'object') return null;
    var text = String(item.text || '').trim();
    if (!text) return null;
    var action = ['add', 'delete', 'disable', 'move'].indexOf(item.action) !== -1 ? item.action : 'add';
    return {
      id: String(item.id || uid()),
      action: action,
      text: text,
      category: String(item.category || DEFAULT_CATEGORY),
      targetCategory: String(item.targetCategory || ''),
      sender: item.sender === '梦角' ? '梦角' : '我'
    };
  }

  function normalizeData(parsed) {
    var d = { categories: {}, categoryOrder: [], pending: [], settings: Object.assign({}, DEFAULT_SETTINGS) };
    if (!parsed || typeof parsed !== 'object') return d;

    if (parsed.categories && typeof parsed.categories === 'object' && !Array.isArray(parsed.categories)) {
      Object.keys(parsed.categories).forEach(function (name) {
        var list = parsed.categories[name];
        if (!Array.isArray(list)) return;
        d.categories[name] = list.map(normalizeCard).filter(Boolean);
      });
    }
    if (Array.isArray(parsed.pending)) {
      d.pending = parsed.pending.map(normalizePending).filter(Boolean);
    }
    if (Array.isArray(parsed.categoryOrder)) {
      parsed.categoryOrder.forEach(function (n) {
        if (typeof n === 'string' && d.categories[n] && d.categoryOrder.indexOf(n) === -1) d.categoryOrder.push(n);
      });
    }
    Object.keys(d.categories).forEach(function (n) {
      if (d.categoryOrder.indexOf(n) === -1) d.categoryOrder.push(n);
    });

    if (parsed.settings && typeof parsed.settings === 'object') {
      var s = parsed.settings;
      var ballColor = s.ballColor !== undefined ? s.ballColor : (s.color || DEFAULT_SETTINGS.ballColor);
      var ballSize = s.ballSize !== undefined ? s.ballSize : (s.size || DEFAULT_SETTINGS.ballSize);
      var ballImage = s.ballImage !== undefined ? s.ballImage : (s.image || '');
      d.settings = {
        ballColor: typeof ballColor === 'string' ? ballColor : DEFAULT_SETTINGS.ballColor,
        ballSize: typeof ballSize === 'number' ? clamp(ballSize, 36, 96) : DEFAULT_SETTINGS.ballSize,
        ballImage: typeof ballImage === 'string' ? ballImage : '',
        position: (s.position && typeof s.position.x === 'number' && typeof s.position.y === 'number') ? { x: s.position.x, y: s.position.y } : null,
        isHidden: !!s.isHidden,
        appIconColor: typeof s.appIconColor === 'string' ? s.appIconColor : DEFAULT_SETTINGS.appIconColor,
        appIconImage: typeof s.appIconImage === 'string' ? s.appIconImage : '',
        iconPage: typeof s.iconPage === 'number' ? s.iconPage : DEFAULT_SETTINGS.iconPage,
        iconIndex: typeof s.iconIndex === 'number' ? s.iconIndex : DEFAULT_SETTINGS.iconIndex
      };
    }
    return d;
  }

  var Store = {
    data: null,
    load: function () {
      var raw = null;
      try { raw = localStorage.getItem(LS_KEY); } catch (e) { raw = null; }
      var parsed = null;
      if (raw) { try { parsed = JSON.parse(raw); } catch (e) { parsed = null; } }
      this.data = normalizeData(parsed);
      return this.data;
    },
    save: function () {
      try { localStorage.setItem(LS_KEY, JSON.stringify(this.data)); } catch (e) {
        console.warn('[梦角字卡] 保存失败：', e);
        toast('本地存储写入失败，可能超出容量');
      }
    },
    ensureDefaults: function () {
      var d = this.data;
      if (!d.categoryOrder.length) {
        ['主谓宾', '定状补', '场景描写'].forEach(function (n) { d.categories[n] = d.categories[n] || []; d.categoryOrder.push(n); });
        this.save();
      }
    }
  };

  /* =======================================================================
   * 3. 样式注入
   * ===================================================================== */
  var CSS = [
    '.mac-float-ball{position:fixed;z-index:2147483000;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;-webkit-user-select:none;touch-action:none;box-shadow:none!important;border:none;outline:none;overflow:visible;background-size:cover;background-position:center;background-repeat:no-repeat;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#fff;}',
    '.mac-float-ball .mac-ball-text{font-weight:700;line-height:1;pointer-events:none;letter-spacing:1px;}',
    '.mac-badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#ff3b30;color:#fff;font-size:11px;line-height:18px;text-align:center;font-weight:700;display:none;align-items:center;justify-content:center;box-sizing:border-box;pointer-events:none;box-shadow:none!important;font-family:-apple-system,sans-serif;z-index:10;}',
    
    /* 九宫格图标样式 */
    '.mac-injected-app .app-ico { position: relative !important; }',
    '.mac-injected-app .mac-native-text { display: flex !important; align-items: center !important; justify-content: center !important; width: 100% !important; height: 100% !important; font-size: 24px !important; font-weight: bold !important; line-height: 1 !important; pointer-events: none !important; transition: opacity .2s; }',
    
    /* 主面板与Tabs */
    '.mac-overlay{position:fixed;inset:0;background:rgba(15,20,35,.45);z-index:2147483600;display:none;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;}',
    '.mac-overlay.is-open{display:flex;}',
    '.mac-panel{width:min(760px,100%);max-height:88vh;background:#fff;border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:none;border:1px solid rgba(0,0,0,.08);box-sizing:border-box;color:#1f2430;}',
    '.mac-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #eef0f5;background:#fafbff;flex:0 0 auto;}',
    '.mac-header-title{font-size:16px;font-weight:700;letter-spacing:.5px;}',
    '.mac-icon-btn{border:none;background:transparent;font-size:18px;line-height:1;cursor:pointer;color:#8a90a2;padding:4px 8px;border-radius:8px;}',
    '.mac-icon-btn:hover{background:#eef0f5;color:#3a4152;}',
    '.mac-tabs{display:flex;gap:8px;padding:10px 18px;border-bottom:1px solid #eef0f5;background:#fff;flex:0 0 auto;}',
    '.mac-tab{position:relative;border:none;background:#f2f4f8;color:#4a5163;padding:8px 16px;border-radius:10px;font-size:13px;cursor:pointer;font-weight:500;}',
    '.mac-tab.is-active{background:#6c8cff;color:#fff;}',
    '.mac-panes{flex:1 1 auto;overflow-y:auto;min-height:0;-webkit-overflow-scrolling:touch;}',
    '.mac-pane{display:none;padding:16px 18px 22px;}',
    '.mac-pane.is-active{display:block;}',

    /* 通用表单控件 */
    '.mac-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px;}',
    '.mac-input,.mac-textarea,.mac-select{border:1px solid #dde1ea;border-radius:10px;padding:8px 10px;font-size:13px;background:#fff;color:#1f2430;box-sizing:border-box;outline:none;font-family:inherit;}',
    '.mac-input:focus,.mac-textarea:focus,.mac-select:focus{border-color:#6c8cff;}',
    '.mac-textarea{width:100%;min-height:64px;resize:vertical;line-height:1.5;}',
    '.mac-input{flex:1 1 160px;min-width:0;}',
    '.mac-select-sm{padding:4px 8px;font-size:12px;border-radius:8px;}',
    '.mac-btn{border:1px solid #dde1ea;background:#fff;color:#3a4152;border-radius:10px;padding:8px 14px;font-size:13px;cursor:pointer;font-weight:500;white-space:nowrap;}',
    '.mac-btn:hover{background:#f5f7fb;}',
    '.mac-btn-primary{background:#6c8cff;border-color:#6c8cff;color:#fff;}',
    '.mac-btn-primary:hover{background:#5a7bf5;}',
    '.mac-btn-danger{background:#fff;border-color:#ffd0d0;color:#e5484d;}',
    '.mac-btn-danger:hover{background:#fff5f5;}',
    '.mac-mini{border:1px solid #e2e6ef;background:#fff;color:#4a5163;border-radius:8px;padding:4px 9px;font-size:12px;cursor:pointer;white-space:nowrap;}',
    '.mac-mini:hover{background:#f5f7fb;}',
    '.mac-mini:disabled{opacity:.4;cursor:not-allowed;}',
    '.mac-mini-primary{background:#6c8cff;border-color:#6c8cff;color:#fff;}',
    '.mac-mini-primary:hover{background:#5a7bf5;}',
    '.mac-mini-danger{color:#e5484d;border-color:#ffd0d0;}',
    '.mac-mini-danger:hover{background:#fff5f5;}',
    '.mac-empty{padding:24px 8px;text-align:center;color:#9aa1b2;font-size:13px;}',
    '.mac-tip{font-size:13px;color:#4a5163;line-height:1.6;}',
    '.mac-check{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#4a5163;cursor:pointer;}',

    /* 待审核区 */
    '.mac-addbox{background:#f8f9fd;border:1px solid #eef0f5;border-radius:12px;padding:12px;}',
    '.mac-list{margin-top:12px;display:flex;flex-direction:column;gap:10px;}',
    '.mac-pending-item{border:1px solid #eef0f5;border-radius:12px;padding:10px 12px;background:#fff;}',
    '.mac-pending-text{font-size:14px;line-height:1.6;color:#1f2430;word-break:break-word;}',
    '.mac-pending-meta{display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap;}',
    '.mac-sender{font-size:11px;padding:2px 8px;border-radius:999px;font-weight:600;}',
    '.mac-sender-meng{background:#eef0ff;color:#5a6bd8;}',
    '.mac-sender-me{background:#e9f7ef;color:#1f9d55;}',
    '.mac-action-tag{font-size:11px;padding:2px 6px;border-radius:4px;font-weight:700;}',
    '.mac-act-add{background:#e8f5e9;color:#2e7d32;}',
    '.mac-act-del{background:#ffebee;color:#c62828;}',
    '.mac-act-dis{background:#fff3e0;color:#ef6c00;}',
    '.mac-act-mov{background:#e3f2fd;color:#1565c0;}',

    /* 字卡库区 */
    '.mac-cat-list{margin-top:12px;display:flex;flex-direction:column;gap:10px;}',
    '.mac-cat{border:1px solid #eef0f5;border-radius:12px;overflow:hidden;background:#fff;}',
    '.mac-cat-head{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#f8f9fd;cursor:grab;flex-wrap:wrap;}',
    '.mac-cat-name{font-size:14px;font-weight:600;color:#1f2430;}',
    '.mac-cat-count{font-size:11px;background:#e8ebf3;color:#5a6274;border-radius:999px;padding:1px 8px;}',
    '.mac-cat-actions{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap;}',
    '.mac-cat-body{padding:10px 12px 14px;border-top:1px solid #eef0f5;}',
    '.mac-batchbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding-bottom:10px;border-bottom:1px dashed #eef0f5;margin-bottom:8px;}',
    '.mac-card-list{display:flex;flex-direction:column;gap:6px;}',
    '.mac-card{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;background:#fbfcfe;}',
    '.mac-card:hover{background:#f4f6fb;}',
    '.mac-card-text{flex:1 1 auto;font-size:13px;line-height:1.5;word-break:break-word;color:#2b3142;}',
    '.mac-card-disabled { color: #9aa1b2 !important; text-decoration: line-through !important; opacity: 0.7; }',

    /* 设置区 */
    '.mac-section{border:1px solid #eef0f5;border-radius:12px;padding:12px 14px;margin-bottom:12px;}',
    '.mac-section-title{font-size:13px;font-weight:700;color:#3a4152;margin-bottom:10px;}',
    '.mac-field{display:flex;align-items:center;gap:10px;font-size:13px;color:#4a5163;margin-bottom:10px;}',
    '.mac-field input[type="color"]{width:44px;height:28px;border:1px solid #dde1ea;border-radius:8px;background:#fff;padding:2px;cursor:pointer;}',
    '.mac-field input[type="range"]{flex:1 1 auto;min-width:100px;accent-color:#6c8cff;}',

    /* 模态框 */
    '.mac-modal-overlay{position:fixed;inset:0;background:rgba(15,20,35,.5);z-index:2147483700;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;}',
    '.mac-modal{width:min(380px,100%);background:#fff;border-radius:14px;padding:16px;box-sizing:border-box;box-shadow:none;border:1px solid rgba(0,0,0,.08);color:#1f2430;}',
    '.mac-modal-title{font-size:15px;font-weight:700;margin-bottom:12px;}',
    '.mac-modal-body{font-size:13px;color:#4a5163;line-height:1.6;}',
    '.mac-modal-footer{display:flex;justify-content:flex-end;gap:8px;margin-top:16px;}',
    
    /* 裁剪区 */
    '.mac-crop-stage{display:flex;align-items:center;justify-content:center;margin-bottom:12px;}',
    '.mac-crop-canvas{touch-action:none;cursor:grab;background:#f2f4f8;max-width:100%;}',
    '.mac-crop-zoom{width:100%;accent-color:#6c8cff;}',

    /* Toast */
    '.mac-toast{position:fixed;left:50%;bottom:64px;transform:translate(-50%,20px);background:rgba(30,36,52,.92);color:#fff;font-size:13px;padding:10px 18px;border-radius:10px;z-index:2147483800;opacity:0;pointer-events:none;transition:opacity .22s ease,transform .22s ease;max-width:80vw;text-align:center;box-shadow:none;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;}',
    '.mac-toast.is-show{opacity:1;transform:translate(-50%,0);}'
  ].join('');

  function injectCSS() {
    if (document.querySelector('style[data-mac-style]')) return;
    var style = document.createElement('style');
    style.setAttribute('data-mac-style', '1');
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  /* =======================================================================
   * 4. UI 辅助工具 (Toast / Modal / 图片处理)
   * ===================================================================== */
  var toastTimer = null;
  function toast(msg) {
    var t = document.querySelector('.mac-toast');
    if (!t) { t = document.createElement('div'); t.className = 'mac-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    void t.offsetWidth;
    t.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('is-show'); }, 2200);
  }

  function showModal(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'mac-modal-overlay';
      overlay.innerHTML = '<div class="mac-modal"><div class="mac-modal-title">' + esc(opts.title || '提示') + '</div><div class="mac-modal-body">' + (opts.html || '') + '</div><div class="mac-modal-footer"><button class="mac-btn" data-modal="cancel">取消</button><button class="mac-btn mac-btn-primary" data-modal="ok">' + esc(opts.okText || '确定') + '</button></div></div>';
      document.body.appendChild(overlay);
      function close(val) { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); resolve(val); }
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) { close(null); return; }
        var b = e.target.closest('[data-modal]');
        if (!b) return;
        if (b.dataset.modal === 'cancel') close(null);
        else {
          var val = true;
          if (typeof opts.onOk === 'function') { try { val = opts.onOk(overlay); } catch (err) { val = null; } }
          close(val === undefined ? true : val);
        }
      });
    });
  }

  function confirmModal(title, text, okText) {
    return showModal({ title: title, html: '<div class="mac-tip">' + esc(text) + '</div>', okText: okText || '确定' }).then(function (v) { return v === true; });
  }

  function compressImage(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function(e) {
        var img = new Image();
        img.onload = function() {
          var maxSize = 512; var w = img.width; var h = img.height;
          if (w <= maxSize && h <= maxSize) { resolve(e.target.result); return; }
          var ratio = Math.min(maxSize / w, maxSize / h);
          var canvas = document.createElement('canvas');
          canvas.width = Math.floor(w * ratio); canvas.height = Math.floor(h * ratio);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = function() { reject(new Error('Image parse error')); };
        img.src = e.target.result;
      };
      reader.onerror = function() { reject(new Error('File read error')); };
      reader.readAsDataURL(file);
    });
  }

  function openCropModal(dataUrl, isRound, cb) {
    var V = 280;
    var overlay = document.createElement('div');
    overlay.className = 'mac-modal-overlay';
    var canvasStyle = isRound ? 'border-radius: 50%;' : 'border-radius: 22%;';
    overlay.innerHTML = '<div class="mac-modal"><div class="mac-modal-title">调整图标图片</div><div class="mac-crop-stage"><canvas class="mac-crop-canvas" style="' + canvasStyle + '" width="' + V + '" height="' + V + '"></canvas></div><input class="mac-crop-zoom" type="range" min="1" max="3" step="0.01" value="1"><div class="mac-modal-footer"><button class="mac-btn" data-crop="cancel">取消</button><button class="mac-btn mac-btn-primary" data-crop="ok">确认</button></div></div>';
    document.body.appendChild(overlay);

    var canvas = overlay.querySelector('canvas');
    var ctx = canvas.getContext('2d');
    var zoomInput = overlay.querySelector('.mac-crop-zoom');
    var img = new Image();
    var baseScale = 1; var zoom = 1; var ox = 0; var oy = 0; var ready = false;

    img.onload = function () { baseScale = Math.max(V / img.width, V / img.height); ready = true; draw(); };
    img.onerror = function () { toast('图片加载失败'); if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
    img.src = dataUrl;

    function drawRoundedRect(c, x, y, width, height, radius) {
      c.beginPath(); c.moveTo(x + radius, y); c.lineTo(x + width - radius, y); c.quadraticCurveTo(x + width, y, x + width, y + radius); c.lineTo(x + width, y + height - radius); c.quadraticCurveTo(x + width, y + height, x + width - radius, y + height); c.lineTo(x + radius, y + height); c.quadraticCurveTo(x, y + height, x, y + height - radius); c.lineTo(x, y + radius); c.quadraticCurveTo(x, y, x + radius, y); c.closePath();
    }

    function draw() {
      ctx.clearRect(0, 0, V, V); ctx.save();
      if (isRound) { ctx.beginPath(); ctx.arc(V / 2, V / 2, V / 2 - 1, 0, Math.PI * 2); ctx.clip(); } else { drawRoundedRect(ctx, 1, 1, V - 2, V - 2, V * 0.22); ctx.clip(); }
      ctx.fillStyle = '#f2f4f8'; ctx.fillRect(0, 0, V, V);
      if (ready) { var s = baseScale * zoom; var w = img.width * s; var h = img.height * s; ctx.drawImage(img, V / 2 + ox - w / 2, V / 2 + oy - h / 2, w, h); }
      ctx.restore();
      ctx.beginPath();
      if (isRound) { ctx.arc(V / 2, V / 2, V / 2 - 1, 0, Math.PI * 2); } else { drawRoundedRect(ctx, 1, 1, V - 2, V - 2, V * 0.22); }
      ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 2; ctx.stroke();
    }

    var dragging = false, sx = 0, sy = 0, sox = 0, soy = 0;
    canvas.addEventListener('pointerdown', function (e) { if (!ready) return; dragging = true; sx = e.clientX; sy = e.clientY; sox = ox; soy = oy; try { canvas.setPointerCapture(e.pointerId); } catch (err) {} e.preventDefault(); });
    canvas.addEventListener('pointermove', function (e) { if (!dragging) return; ox = sox + (e.clientX - sx); oy = soy + (e.clientY - sy); draw(); });
    function endDrag(e) { if (!dragging) return; dragging = false; try { canvas.releasePointerCapture(e.pointerId); } catch (err) {} }
    canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
    zoomInput.addEventListener('input', function () { zoom = parseFloat(zoomInput.value) || 1; draw(); });

    overlay.addEventListener('click', function (e) {
      var b = e.target.closest('[data-crop]'); if (!b) return;
      if (b.dataset.crop === 'cancel') { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); return; }
      if (!ready) { toast('图片尚未加载完成'); return; }
      var OUT = 256; var out = document.createElement('canvas'); out.width = OUT; out.height = OUT; var octx = out.getContext('2d'); octx.clearRect(0, 0, OUT, OUT); octx.save();
      if (isRound) { octx.beginPath(); octx.arc(OUT / 2, OUT / 2, OUT / 2, 0, Math.PI * 2); octx.clip(); } else { drawRoundedRect(octx, 0, 0, OUT, OUT, OUT * 0.22); octx.clip(); }
      var k = OUT / V; var s = baseScale * zoom; var w = img.width * s * k; var h = img.height * s * k; octx.drawImage(img, OUT / 2 + ox * k - w / 2, OUT / 2 + oy * k - h / 2, w, h); octx.restore();
      var result = out.toDataURL('image/png'); if (overlay.parentNode) overlay.parentNode.removeChild(overlay); if (typeof cb === 'function') cb(result);
    });

    draw();
  }

  /* =======================================================================
   * 5. 核心：静默发送与防打断刷新
   * ===================================================================== */
  function injectFakeMessage(text, side, shouldReload) {
    side = side || 'out';
    shouldReload = shouldReload !== false;
    
    console.log('[梦角字卡] 🚀 触发静默发送...');
    
    var raw = null;
    try { raw = localStorage.getItem(CHAT_KEY); } catch (e) {}
    var msgs = [];
    if (raw) { try { msgs = JSON.parse(raw); } catch(e) {} }
    if (!Array.isArray(msgs)) msgs = [];
    
    // 精准组装消息格式
    var newMsg = {
        side: side,
        text: text,
        time: Date.now()
    };
    
    msgs.push(newMsg);
    try { localStorage.setItem(CHAT_KEY, JSON.stringify(msgs)); } catch(e) {}
    console.log('[梦角字卡] ✅ 消息已写入 LocalStorage:', newMsg);

    // 1. 尝试调用全局函数
    var rendered = false;
    var fnNames = ['loadMsgs', 'renderChat', 'renderWindow', 'loadChat', 'refreshChat', 'updateChat', 'fetchMsgs'];
    fnNames.forEach(function(fn) {
      if (typeof window[fn] === 'function') {
        try { window[fn](); rendered = true; } catch (e) {}
      }
    });

    // 2. 尝试派发事件
    if (!rendered) {
      try {
        window.dispatchEvent(new Event('storage'));
        window.dispatchEvent(new CustomEvent('newMessage', { detail: newMsg }));
      } catch(e){}
    }

    if (rendered) {
      toast('已通过原网页接口发送消息');
    } else {
      // 3. 兜底刷新（防打断机制）
      if (shouldReload) {
        var activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') && activeEl.value.trim() !== '') {
            toast('消息已发送！但检测到你正在输入，请发送完当前消息后手动刷新查看');
            return;
        }
        
        toast('发送成功，即将刷新页面以更新聊天...');
        setTimeout(function() { location.reload(); }, 800);
      } else {
        toast('已写入本地，请刷新页面查看消息');
      }
    }
  }

  window.MyAuditCards = window.MyAuditCards || {};
  window.MyAuditCards.sendMsg = injectFakeMessage;

  /* =======================================================================
   * 6. 自动抓取与 AI 自主意识 (含自动抽卡发送)
   * ===================================================================== */
  function pickTimestamp(m) {
    var keys = ['time', 'timestamp', 'ts', 'createdAt', 'created_at', 'date', 'sendTime'];
    for (var i = 0; i < keys.length; i++) {
      var c = m[keys[i]];
      if (typeof c === 'number' && isFinite(c)) return c < 1e12 ? c * 1000 : c;
      if (typeof c === 'string' && c) {
        if (/^\d+$/.test(c)) { var n = Number(c); if (isFinite(n)) return n < 1e12 ? n * 1000 : n; }
        var p = Date.parse(c); if (!isNaN(p)) return p;
      }
    }
    return null;
  }

  function pickText(m) {
    var keys = ['text', 'content', 'msg', 'message', 'value'];
    for (var i = 0; i < keys.length; i++) { var c = m[keys[i]]; if (typeof c === 'string' && c.trim()) return c.trim(); }
    return '';
  }

  // AI 自主捣乱（2%概率发起删改禁）
  function tryAIExtracurricular() {
    if (Math.random() > 0.02) return;
    var d = Store.data;
    if (d.pending.length >= MAX_PENDING) return;

    var allCards = [];
    d.categoryOrder.forEach(function(cat) {
      (d.categories[cat] || []).forEach(function(card) { if (!card.isDisabled) allCards.push({ cat: cat, card: card }); });
    });
    if (allCards.length === 0) return;

    var target = allCards[Math.floor(Math.random() * allCards.length)];
    var roll = Math.random();
    var action = 'delete'; var targetCategory = '';

    if (roll < 0.35) { action = 'delete'; }
    else if (roll < 0.7) { action = 'disable'; }
    else {
      action = 'move';
      var otherCats = d.categoryOrder.filter(function(n) { return n !== target.cat; });
      if (otherCats.length === 0) { action = 'disable'; }
      else { targetCategory = otherCats[Math.floor(Math.random() * otherCats.length)]; }
    }

    var exists = d.pending.some(function(p) { return p.text === target.card.text && p.category === target.cat && p.action === action; });
    if (!exists) {
      d.pending.push({ id: uid(), action: action, text: target.card.text, category: target.cat, targetCategory: targetCategory, sender: '梦角' });
      Store.save(); hideBadge = false; refreshUI();
      console.log('[梦角字卡] AI 自主意识触发:', action, target.card.text);
    }
  }

  // AI 自动主动发送字卡（10%概率直接发消息）
  function tryAISelfTalk() {
    if (Math.random() > 0.10) return; // 10% 概率

    var d = Store.data;
    var allCards = [];
    d.categoryOrder.forEach(function(cat) {
      (d.categories[cat] || []).forEach(function(card) {
        if (!card.isDisabled) allCards.push(card.text);
      });
    });

    if (allCards.length === 0) return;
    
    // 随机抽一张发送给用户 (side: 'in')
    var randomText = allCards[Math.floor(Math.random() * allCards.length)];
    console.log('[梦角字卡] 🌟 梦角主动发消息:', randomText);
    injectFakeMessage(randomText, 'in', true);
  }

  function autoFetch(isManual) {
    if (isManual) console.log('[梦角字卡] 💡 收到手动触发指令，无视概率强制开始抓取...');
    else {
      tryAIExtracurricular();
      tryAISelfTalk(); // 触发自动发送
    }

    var raw = null; try { raw = localStorage.getItem(CHAT_KEY); } catch (e) { return; }
    if (!raw) { if (isManual) console.log('[梦角字卡] ❌ 未找到聊天记录'); return; }
    var msgs = null; try { msgs = JSON.parse(raw); } catch (e) { if (isManual) console.log('[梦角字卡] ❌ JSON 解析失败'); return; }
    if (!Array.isArray(msgs) || !msgs.length) { if (isManual) console.log('[梦角字卡] ❌ 聊天数组为空'); return; }

    var d = Store.data;
    if (d.pending.length >= MAX_PENDING) { if (isManual) console.log('[梦角字卡] ⏸️ 待审核积压已满'); return; }

    var hasLoveWord = msgs.some(function(m) { return /喜欢|爱|想你|开心|抱抱|亲亲/.test(pickText(m)); });
    if (!isManual) {
      var threshold = hasLoveWord ? 0.7 : 0.95;
      if (!(Math.random() > threshold)) return;
    }

    if (isManual) console.log('[梦角字卡] 🚀 开始扫描 ' + msgs.length + ' 条消息...');
    var now = Date.now();
    var WINDOW = 15 * 60 * 1000;
    var known = Object.create(null);
    d.pending.forEach(function (p) { known[p.text] = 1; });
    d.categoryOrder.forEach(function (name) { (d.categories[name] || []).forEach(function (c) { known[c.text] = 1; }); });

    var added = 0;
    var hasAnyTimestamp = msgs.some(function (m) { return m && typeof m === 'object' && pickTimestamp(m) !== null; });

    for (var i = 0; i < msgs.length; i++) {
      if (d.pending.length >= MAX_PENDING) { if (isManual) console.log('  ⏸️ 抓取已满 5 条'); break; }
      var m = msgs[i]; if (!m || typeof m !== 'object' || m.side !== 'out') continue;
      var ts = pickTimestamp(m);
      if (hasAnyTimestamp) {
        if (ts === null) continue;
        if (now - ts > WINDOW || ts - now > 60 * 1000) continue;
      } else { if (i < msgs.length - 20) continue; }

      var text = pickText(m); if (!text) continue;
      var len = Array.from(text).length; if (len < 5 || len > 35) continue;
      if (known[text]) continue;
      known[text] = 1;

      d.pending.push({ id: uid(), action: 'add', text: text, category: d.categoryOrder[0] || DEFAULT_CATEGORY, targetCategory: '', sender: '梦角' });
      added++;
      if (isManual) console.log('  [✅ 抓取]', text);
    }

    if (added > 0) { Store.save(); hideBadge = false; refreshUI(); toast('已静默收录 ' + added + ' 条字卡'); }
    else { if (isManual) console.log('[梦角字卡] 扫描结束，没有符合条件的新消息。'); }
  }

  /* =======================================================================
   * 7. 入口UI：悬浮球与原生图标注入
   * ===================================================================== */
  var ball = null;
  var hideBadge = false;

  function createBall() {
    if (ball) return;
    ball = document.createElement('div');
    ball.className = 'mac-float-ball';
    document.body.appendChild(ball);

    var dragging = false, moved = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
    ball.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      var r = ball.getBoundingClientRect();
      dragging = true; moved = false; startX = e.clientX; startY = e.clientY; startLeft = r.left; startTop = r.top;
      ball.style.left = r.left + 'px'; ball.style.top = r.top + 'px'; ball.style.right = 'auto'; ball.style.bottom = 'auto';
      try { ball.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    ball.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - startX; var dy = e.clientY - startY;
      if (!moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) moved = true;
      if (!moved) return;
      var size = Store.data.settings.ballSize;
      var nl = clamp(startLeft + dx, 0, Math.max(0, window.innerWidth - size));
      var nt = clamp(startTop + dy, 0, Math.max(0, window.innerHeight - size));
      ball.style.left = nl + 'px'; ball.style.top = nt + 'px';
    });
    function endDrag(e) {
      if (!dragging) return; dragging = false;
      try { ball.releasePointerCapture(e.pointerId); } catch (err) {}
      if (moved) { var r = ball.getBoundingClientRect(); Store.data.settings.position = { x: r.left, y: r.top }; Store.save(); }
      else { openPanel(); }
    }
    ball.addEventListener('pointerup', endDrag);
    ball.addEventListener('pointercancel', function (e) { if (!dragging) return; dragging = false; try { ball.releasePointerCapture(e.pointerId); } catch (err) {} });
  }

  function positionBall() {
    if (!ball) return;
    var s = Store.data.settings; var size = s.ballSize;
    if (s.position && typeof s.position.x === 'number' && typeof s.position.y === 'number') {
      var x = clamp(s.position.x, 0, Math.max(0, window.innerWidth - size));
      var y = clamp(s.position.y, 0, Math.max(0, window.innerHeight - size));
      ball.style.left = x + 'px'; ball.style.top = y + 'px'; ball.style.right = 'auto'; ball.style.bottom = 'auto';
    } else { ball.style.left = 'auto'; ball.style.top = 'auto'; ball.style.right = '20px'; ball.style.bottom = '110px'; }
  }

  function updateNativeIcon() {
    var node = document.querySelector('[data-app="mac-audit"]'); if (!node) return;
    var ico = node.querySelector('.app-ico'); var text = node.querySelector('.mac-native-text'); if (!ico || !text) return;
    var s = Store.data.settings;
    ico.style.backgroundImage = 'none'; ico.style.backgroundColor = 'transparent'; ico.style.boxShadow = 'none';
    if (s.appIconImage) {
      ico.style.backgroundImage = 'url("' + s.appIconImage + '")'; ico.style.backgroundSize = 'cover'; ico.style.backgroundPosition = 'center'; ico.style.backgroundColor = 'transparent'; text.style.opacity = '0';
    } else {
      ico.style.backgroundColor = s.appIconColor; text.style.opacity = '1';
      var hex = s.appIconColor.replace('#', ''); if (hex.length === 3) hex = hex.split('').map(function(c) { return c+c; }).join('');
      var r = parseInt(hex.substr(0, 2), 16) || 0; var g = parseInt(hex.substr(2, 2), 16) || 0; var b = parseInt(hex.substr(4, 2), 16) || 0;
      text.style.color = (0.299 * r + 0.587 * g + 0.114 * b) > 140 ? '#1f2430' : '#ffffff';
    }
  }

  function tryInjectNativeIcon() {
    try {
      var slides = document.querySelectorAll('.page-slide');
      if (!slides.length) slides = document.querySelectorAll('.app-grid.p3-grid');
      if (!slides.length) return;

      var s = Store.data.settings;
      var pageIdx = Math.min(Math.max(s.iconPage || 0, 0), slides.length - 1);
      var targetContainer = slides[pageIdx];
      
      var targetGrid = null;
      if (targetContainer.classList.contains('app-grid') || targetContainer.classList.contains('p3-grid')) targetGrid = targetContainer;
      else targetGrid = targetContainer.querySelector('.app-grid') || targetContainer.querySelector('[class*="grid"]');
      
      if (!targetGrid) { var apps = targetContainer.querySelectorAll('.app'); if (apps.length > 0) targetGrid = apps[0].parentElement; }
      if (!targetGrid) return;
      
      var appNode = document.querySelector('[data-app="mac-audit"]');
      if (appNode && !appNode.querySelector('.mac-native-text')) { appNode.remove(); appNode = null; }

      if (!appNode) {
        var sampleApp = null;
        for (var i = 0; i < targetGrid.children.length; i++) {
          var child = targetGrid.children[i];
          if (child.classList.contains('app') && child.querySelector('.app-ico')) { sampleApp = child; break; }
        }
        if (sampleApp) appNode = sampleApp.cloneNode(true);
        else { appNode = document.createElement('div'); appNode.className = 'app'; }
        
        appNode.setAttribute('data-app', 'mac-audit'); appNode.removeAttribute('data-desk-widget'); appNode.classList.add('mac-injected-app');
        var withIds = appNode.querySelectorAll('[id]'); for (var k = 0; k < withIds.length; k++) withIds[k].removeAttribute('id');
        
        var ico = appNode.querySelector('.app-ico');
        if (!ico) { ico = document.createElement('div'); ico.className = 'app-ico'; appNode.insertBefore(ico, appNode.firstChild); }
        ico.innerHTML = '';
        
        var textEl = document.createElement('span'); textEl.className = 'mac-native-text'; textEl.textContent = '审'; ico.appendChild(textEl);
        var badge = document.createElement('span'); badge.className = 'mac-badge'; badge.setAttribute('data-role', 'ball-badge'); ico.appendChild(badge);
        
        var nameEl = appNode.querySelector('.app-name');
        if (!nameEl) { nameEl = document.createElement('div'); nameEl.className = 'app-name'; appNode.appendChild(nameEl); }
        nameEl.textContent = '审核';
        
        appNode.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); openPanel(); });
      }

      var targetIdx = s.iconIndex || 0;
      var children = Array.prototype.slice.call(targetGrid.children).filter(function(el) { return el !== appNode; });
      var refNode = children[targetIdx] || null;
      if (appNode.parentNode !== targetGrid || appNode.nextElementSibling !== refNode) targetGrid.insertBefore(appNode, refNode);

      updateNativeIcon(); updateBadges();
    } catch (e) {}
  }

  function updateBadges() {
    var n = Store.data.pending.length;
    var nodes = document.querySelectorAll('[data-role="ball-badge"]');
    for (var i = 0; i < nodes.length; i++) {
      var b = nodes[i];
      if (n > 0 && !hideBadge) { b.textContent = n > 99 ? '99+' : String(n); b.style.display = 'flex'; }
      else { b.style.display = 'none'; }
    }
  }

  function applyEntryUI() {
    var s = Store.data.settings;
    if (ball) {
      var shouldShowBall = !s.isHidden || isForceShow;
      ball.style.display = shouldShowBall ? 'flex' : 'none';
      ball.style.width = s.ballSize + 'px'; ball.style.height = s.ballSize + 'px';
      ball.style.backgroundColor = s.ballImage ? 'transparent' : s.ballColor;
      ball.style.backgroundImage = s.ballImage ? 'url("' + s.ballImage + '")' : 'none';
      ball.innerHTML = '<span class="mac-ball-text" style="opacity:' + (s.ballImage ? 0 : 1) + ';font-size:' + Math.round(s.ballSize * 0.38) + 'px">审</span><span class="mac-badge" data-role="ball-badge"></span>';
      positionBall();
    }
    tryInjectNativeIcon();
  }

  /* =======================================================================
   * 8. 管理面板构建与渲染
   * ===================================================================== */
  var panelRoot = null;
  var expandedCats = Object.create(null);

  function buildPanelHTML() {
    return '' +
      '<div class="mac-panel">' +
        '<div class="mac-header">' +
          '<div class="mac-header-title">梦角字卡 · 审核与管理</div>' +
          '<button class="mac-icon-btn" data-act="close">✕</button>' +
        '</div>' +
        '<div class="mac-tabs">' +
          '<button class="mac-tab is-active" data-tab="review">待审核</button>' +
          '<button class="mac-tab" data-tab="cards">字卡库</button>' +
          '<button class="mac-tab" data-tab="settings">设置</button>' +
        '</div>' +
        '<div class="mac-panes">' +

          /* 待审核面板 */
          '<div class="mac-pane is-active" data-pane="review">' +
            '<div class="mac-addbox">' +
              '<textarea class="mac-textarea" data-role="manual-text" placeholder="手动输入要添加的字卡内容，提交后进入待审核（发件人：我）"></textarea>' +
              '<div class="mac-row">' +
                '<select class="mac-select" data-role="manual-cat"></select>' +
                '<button class="mac-btn mac-btn-primary" data-act="manual-add">提交审核</button>' +
              '</div>' +
            '</div>' +
            '<div class="mac-list" data-role="pending-list"></div>' +
            '<div class="mac-row">' +
              '<button class="mac-btn" data-act="approve-all">全部通过</button>' +
              '<button class="mac-btn mac-btn-danger" data-act="clear-pending">清空待审核</button>' +
            '</div>' +
            '<div class="mac-section" style="margin-top:20px; border-color:#ffe0b2; background:#fffdfa;">' +
              '<div class="mac-section-title" style="color:#d84315;">🧪 测试静默发送</div>' +
              '<div class="mac-row">' +
                '<input class="mac-input" data-role="test-msg" placeholder="输入内容，测试无刷新发送" value="测试无刷新发送消息">' +
                '<button class="mac-btn mac-btn-primary" data-act="test-send">一键发送</button>' +
              '</div>' +
            '</div>' +
          '</div>' +

          /* 字卡库面板 */
          '<div class="mac-pane" data-pane="cards">' +
            '<div class="mac-row">' +
              '<input class="mac-input" data-role="new-cat" placeholder="新分类名称">' +
              '<button class="mac-btn mac-btn-primary" data-act="add-cat">新建分类</button>' +
            '</div>' +
            '<div class="mac-cat-list" data-role="cat-list"></div>' +
          '</div>' +

          /* 设置面板 */
          '<div class="mac-pane" data-pane="settings">' +
            '<div class="mac-section">' +
              '<div class="mac-section-title">悬浮球外观</div>' +
              '<div class="mac-field"><span>背景颜色</span><input type="color" data-role="set-ball-color"></div>' +
              '<div class="mac-field"><span>图标大小</span><input type="range" min="36" max="96" step="2" data-role="set-ball-size"><span data-role="ball-size-val">56</span></div>' +
              '<div class="mac-row"><button class="mac-btn" data-act="upload-ball-img">上传悬浮球图片</button><button class="mac-btn" data-act="clear-ball-img">清除图片</button></div>' +
              '<input type="file" accept="image/*" data-role="ball-img-file" style="display:none">' +
            '</div>' +
            '<div class="mac-section">' +
              '<div class="mac-section-title">九宫格图标外观</div>' +
              '<div style="font-size:12px;color:#9aa1b2;margin-bottom:10px;">尺寸自动继承原网页，若上传图片将覆盖背景色。</div>' +
              '<div class="mac-field"><span>背景颜色</span><input type="color" data-role="set-app-color"></div>' +
              '<div class="mac-row"><button class="mac-btn" data-act="upload-app-img">上传图标图片</button><button class="mac-btn" data-act="clear-app-img">清除图片</button></div>' +
              '<input type="file" accept="image/*" data-role="app-img-file" style="display:none">' +
            '</div>' +
            '<div class="mac-section">' +
              '<div class="mac-section-title">九宫格位置控制</div>' +
              '<div class="mac-field"><span>所在页</span><select class="mac-select mac-select-sm" data-role="set-icon-page"><option value="0">第 1 页</option><option value="1">第 2 页</option><option value="2">第 3 页</option><option value="3">第 4 页</option></select></div>' +
              '<div class="mac-field"><span>第几个</span><select class="mac-select mac-select-sm" data-role="set-icon-index"></select></div>' +
            '</div>' +
            '<div class="mac-section">' +
              '<div class="mac-section-title">入口控制</div>' +
              '<label class="mac-check"><input type="checkbox" data-role="set-hidden"> 隐藏悬浮球（仅隐藏右下角球体，原生图标不受影响）</label>' +
              '<div style="font-size:12px;color:#9aa1b2;margin-top:6px;line-height:1.5;">开启后，只能通过原网页【审核】图标进入面板关闭。若找不到入口，可在网址后加 <b>?show_audit=true</b> 救急。</div>' +
              '<div class="mac-row"><button class="mac-btn" data-act="reset-pos">重置悬浮球位置</button></div>' +
            '</div>' +
            '<div class="mac-section">' +
              '<div class="mac-section-title">数据安全</div>' +
              '<div class="mac-row"><button class="mac-btn" data-act="export">导出备份</button><button class="mac-btn" data-act="import">导入备份</button></div>' +
              '<input type="file" accept=".json,application/json" data-role="import-file" style="display:none">' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function ensurePanel() {
    if (panelRoot) return panelRoot;
    panelRoot = document.createElement('div');
    panelRoot.className = 'mac-overlay';
    panelRoot.innerHTML = buildPanelHTML();
    document.body.appendChild(panelRoot);
    bindPanelEvents(panelRoot);
    return panelRoot;
  }

  function openPanel() { ensurePanel(); panelRoot.classList.add('is-open'); renderAll(); hideBadge = true; updateBadges(); }
  function closePanel() { if (panelRoot) panelRoot.classList.remove('is-open'); }
  function switchTab(name) {
    if (!panelRoot) return;
    var tabs = panelRoot.querySelectorAll('.mac-tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('is-active', tabs[i].dataset.tab === name);
    var panes = panelRoot.querySelectorAll('.mac-pane');
    for (var j = 0; j < panes.length; j++) panes[j].classList.toggle('is-active', panes[j].dataset.pane === name);
  }

  function findCatEl(name) {
    if (!panelRoot) return null;
    var nodes = panelRoot.querySelectorAll('.mac-cat');
    for (var i = 0; i < nodes.length; i++) if (nodes[i].dataset.cat === name) return nodes[i];
    return null;
  }

  function renderPending() {
    var list = panelRoot.querySelector('[data-role="pending-list"]');
    var pending = Store.data.pending;
    if (!pending.length) { list.innerHTML = '<div class="mac-empty">暂无待审核事项</div>'; return; }
    var cats = Store.data.categoryOrder;
    
    list.innerHTML = pending.map(function (p) {
      var isMeng = p.sender === '梦角';
      var senderText = isMeng ? '梦角' : '我';
      var senderClass = isMeng ? 'mac-sender-meng' : 'mac-sender-me';
      var actText = ''; var actClass = ''; var uiExtra = '';

      if (p.action === 'add') {
        actText = '申请新增'; actClass = 'mac-act-add';
        var options = cats.map(function (n) { return '<option value="' + escAttr(n) + '"' + (n === p.category ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('');
        uiExtra = '<select class="mac-select mac-select-sm" data-role="pending-cat" data-id="' + escAttr(p.id) + '">' + options + '</select>';
      } else if (p.action === 'delete') { actText = '申请删除'; actClass = 'mac-act-del'; }
      else if (p.action === 'disable') { actText = '申请禁用'; actClass = 'mac-act-dis'; }
      else if (p.action === 'move') {
        actText = '申请迁移'; actClass = 'mac-act-mov';
        var moveOpts = cats.filter(function(n) { return n !== p.category; }).map(function (n) { return '<option value="' + escAttr(n) + '"' + (n === p.targetCategory ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('');
        uiExtra = '<span style="font-size:12px;color:#666;">从【' + esc(p.category) + '】移至</span><select class="mac-select mac-select-sm" data-role="pending-target-cat" data-id="' + escAttr(p.id) + '">' + moveOpts + '</select>';
      }

      return '<div class="mac-pending-item" data-id="' + escAttr(p.id) + '"><div class="mac-pending-text"><span class="mac-action-tag ' + actClass + '">' + actText + '</span> <span class="mac-sender ' + senderClass + '">' + senderText + '</span> 「' + esc(p.text) + '」</div><div class="mac-pending-meta">' + uiExtra + '<button class="mac-mini mac-mini-primary" data-act="approve" data-id="' + escAttr(p.id) + '">同意</button><button class="mac-mini mac-mini-danger" data-act="reject" data-id="' + escAttr(p.id) + '">驳回</button></div></div>';
    }).join('');
  }

  function renderCatBody(name, cards) {
    if (!cards.length) return '<div class="mac-empty">该分类下暂无字卡</div>';
    var others = Store.data.categoryOrder.filter(function (n) { return n !== name; });
    var opts = others.length ? others.map(function (n) { return '<option value="' + escAttr(n) + '">' + esc(n) + '</option>'; }).join('') : '<option value="">无其他分类</option>';

    var items = cards.map(function (c) {
      var disabledClass = c.isDisabled ? ' mac-card-disabled' : '';
      var recoverBtn = c.isDisabled ? '<button class="mac-mini mac-mini-primary" data-act="card-recover" data-cat="' + escAttr(name) + '" data-id="' + escAttr(c.id) + '">恢复</button>' : '';
      
      // 核心：给字卡加上纸飞机发送按钮
      var sendBtn = c.isDisabled ? '' : '<button class="mac-mini" data-act="card-send" data-cat="' + escAttr(name) + '" data-id="' + escAttr(c.id) + '" title="发送给梦角">✈️ 发送</button>';

      return '<div class="mac-card" data-id="' + escAttr(c.id) + '">' +
               '<input type="checkbox" class="mac-card-check" data-id="' + escAttr(c.id) + '">' +
               '<span class="mac-card-text' + disabledClass + '">' + esc(c.text) + '</span>' +
               sendBtn +
               recoverBtn + 
               '<button class="mac-mini" data-act="card-edit" data-cat="' + escAttr(name) + '" data-id="' + escAttr(c.id) + '">编辑</button>' +
               '<button class="mac-mini mac-mini-danger" data-act="card-del" data-cat="' + escAttr(name) + '" data-id="' + escAttr(c.id) + '">删除</button>' +
             '</div>';
    }).join('');

    return '<div class="mac-batchbar"><label class="mac-check"><input type="checkbox" data-role="select-all"> 全选</label><button class="mac-mini" data-act="batch-del" data-cat="' + escAttr(name) + '">批量删除</button><select class="mac-select mac-select-sm" data-role="batch-target">' + opts + '</select><button class="mac-mini" data-act="batch-move" data-cat="' + escAttr(name) + '">批量转移</button></div><div class="mac-card-list">' + items + '</div>';
  }

  function renderCards() {
    var list = panelRoot.querySelector('[data-role="cat-list"]');
    var d = Store.data;
    if (!d.categoryOrder.length) { list.innerHTML = '<div class="mac-empty">还没有分类，先新建一个吧</div>'; return; }
    list.innerHTML = d.categoryOrder.map(function (name, idx) {
      var cards = d.categories[name] || [];
      var expanded = !!expandedCats[name];
      return '<div class="mac-cat" data-cat="' + escAttr(name) + '" draggable="true"><div class="mac-cat-head"><span class="mac-cat-name">' + esc(name) + '</span><span class="mac-cat-count">' + cards.length + '</span><div class="mac-cat-actions"><button class="mac-mini" data-act="cat-up" data-cat="' + escAttr(name) + '"' + (idx === 0 ? ' disabled' : '') + '>上移</button><button class="mac-mini" data-act="cat-down" data-cat="' + escAttr(name) + '"' + (idx === d.categoryOrder.length - 1 ? ' disabled' : '') + '>下移</button><button class="mac-mini" data-act="cat-rename" data-cat="' + escAttr(name) + '">改名</button><button class="mac-mini" data-act="cat-toggle" data-cat="' + escAttr(name) + '">' + (expanded ? '收起' : '展开') + '</button><button class="mac-mini mac-mini-danger" data-act="cat-del" data-cat="' + escAttr(name) + '">删除</button></div></div><div class="mac-cat-body"' + (expanded ? '' : ' style="display:none"') + '>' + (expanded ? renderCatBody(name, cards) : '') + '</div></div>';
    }).join('');
  }

  function renderSettings() {
    if (!panelRoot) return;
    var s = Store.data.settings;
    var ballColor = panelRoot.querySelector('[data-role="set-ball-color"]');
    var ballSize = panelRoot.querySelector('[data-role="set-ball-size"]');
    var ballSizeVal = panelRoot.querySelector('[data-role="ball-size-val"]');
    var hidden = panelRoot.querySelector('[data-role="set-hidden"]');
    var appColor = panelRoot.querySelector('[data-role="set-app-color"]');
    var iconPage = panelRoot.querySelector('[data-role="set-icon-page"]');
    var iconIndex = panelRoot.querySelector('[data-role="set-icon-index"]');
    
    if (ballColor) ballColor.value = normalizeHex(s.ballColor);
    if (ballSize) ballSize.value = s.ballSize;
    if (ballSizeVal) ballSizeVal.textContent = s.ballSize;
    if (hidden) hidden.checked = !!s.isHidden;
    if (appColor) appColor.value = normalizeHex(s.appIconColor);
    if (iconPage) iconPage.value = s.iconPage;
    if (iconIndex) {
      var opts = '';
      for (var i = 1; i <= 15; i++) opts += '<option value="' + (i - 1) + '">第 ' + i + ' 个</option>';
      iconIndex.innerHTML = opts; iconIndex.value = s.iconIndex;
    }
  }

  function renderManualCat() {
    var sel = panelRoot.querySelector('[data-role="manual-cat"]');
    if (!sel) return;
    var prev = sel.value; var cats = Store.data.categoryOrder;
    sel.innerHTML = cats.map(function (n) { return '<option value="' + escAttr(n) + '">' + esc(n) + '</option>'; }).join('');
    if (prev && cats.indexOf(prev) !== -1) sel.value = prev;
  }

  function renderAll() {
    if (!panelRoot) return;
    renderManualCat(); renderPending(); renderCards(); renderSettings();
  }

  function refreshUI() {
    updateBadges();
    if (panelRoot && panelRoot.classList.contains('is-open')) renderAll();
    applyEntryUI();
  }

  /* =======================================================================
   * 9. 面板事件绑定与交互动作
   * ===================================================================== */
  function bindPanelEvents(root) {
    root.addEventListener('click', function (e) {
      var tabBtn = e.target.closest('[data-tab]');
      if (tabBtn && root.contains(tabBtn)) { switchTab(tabBtn.dataset.tab); return; }
      var btn = e.target.closest('[data-act]');
      if (btn && root.contains(btn)) { e.preventDefault(); e.stopPropagation(); handleAction(btn.dataset.act, btn); return; }
      if (e.target === root) closePanel();
    });

    root.addEventListener('change', function (e) {
      var t = e.target;
      if (t.matches('[data-role="select-all"]')) {
        var catBody = t.closest('.mac-cat-body');
        if (catBody) {
          var boxes = catBody.querySelectorAll('.mac-card-check');
          for (var i = 0; i < boxes.length; i++) boxes[i].checked = t.checked;
        }
        return;
      }
      if (t.matches('[data-role="pending-cat"]')) {
        var id = t.dataset.id;
        for (var k = 0; k < Store.data.pending.length; k++) { if (Store.data.pending[k].id === id) { Store.data.pending[k].category = t.value; Store.save(); break; } }
        return;
      }
      if (t.matches('[data-role="pending-target-cat"]')) {
        var id = t.dataset.id;
        for (var k = 0; k < Store.data.pending.length; k++) { if (Store.data.pending[k].id === id) { Store.data.pending[k].targetCategory = t.value; Store.save(); break; } }
        return;
      }
      if (t.matches('[data-role="set-hidden"]')) { Store.data.settings.isHidden = !!t.checked; Store.save(); applyEntryUI(); return; }
      if (t.matches('[data-role="set-icon-page"]')) { Store.data.settings.iconPage = parseInt(t.value, 10) || 0; Store.save(); tryInjectNativeIcon(); return; }
      if (t.matches('[data-role="set-icon-index"]')) { Store.data.settings.iconIndex = parseInt(t.value, 10) || 0; Store.save(); tryInjectNativeIcon(); return; }
      if (t.matches('[data-role="import-file"]')) { if (t.files && t.files[0]) importBackup(t.files[0]); t.value = ''; return; }
      if (t.matches('[data-role="ball-img-file"]')) { if (t.files && t.files[0]) handleImageFile(t.files[0], 'ball'); t.value = ''; return; }
      if (t.matches('[data-role="app-img-file"]')) { if (t.files && t.files[0]) handleImageFile(t.files[0], 'app'); t.value = ''; return; }
      if (t.matches('[data-role="set-ball-color"]')) { Store.data.settings.ballColor = t.value; Store.save(); applyEntryUI(); return; }
      if (t.matches('[data-role="set-app-color"]')) { Store.data.settings.appIconColor = t.value; Store.save(); applyEntryUI(); return; }
    });

    root.addEventListener('input', function (e) {
      var t = e.target;
      if (t.matches('[data-role="set-ball-size"]')) {
        Store.data.settings.ballSize = parseInt(t.value, 10) || 56;
        var v = root.querySelector('[data-role="ball-size-val"]');
        if (v) v.textContent = Store.data.settings.ballSize;
        Store.save(); applyEntryUI(); return;
      }
      if (t.matches('[data-role="set-ball-color"]')) { Store.data.settings.ballColor = t.value; Store.save(); applyEntryUI(); return; }
      if (t.matches('[data-role="set-app-color"]')) { Store.data.settings.appIconColor = t.value; Store.save(); applyEntryUI(); return; }
    });

    // 拖拽排序分类
    var dragSrcCat = null;
    root.addEventListener('dragstart', function (e) {
      var head = e.target.closest ? e.target.closest('.mac-cat-head') : null; if (!head) return;
      dragSrcCat = head.parentElement.dataset.cat;
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragSrcCat); } catch (err) {}
    });
    root.addEventListener('dragover', function (e) { if (!dragSrcCat) return; var over = e.target.closest ? e.target.closest('.mac-cat') : null; if (over) { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch (err) {} } });
    root.addEventListener('drop', function (e) {
      if (!dragSrcCat) return; var over = e.target.closest ? e.target.closest('.mac-cat') : null; dragSrcCat = null; if (!over) return; e.preventDefault();
      var target = over.dataset.cat; var order = Store.data.categoryOrder.slice(); var from = order.indexOf(dragSrcCat);
      if (from === -1) return; order.splice(from, 1); var to = order.indexOf(target); if (to === -1) to = order.length; order.splice(to, 0, dragSrcCat);
      Store.data.categoryOrder = order; Store.save(); renderCards();
    });
    root.addEventListener('dragend', function () { dragSrcCat = null; });
  }

  function findPendingById(id) {
    for (var i = 0; i < Store.data.pending.length; i++) if (Store.data.pending[i].id === id) return Store.data.pending[i]; return null;
  }

  function addCardToCategory(name, text) {
    var d = Store.data; if (!name) name = d.categoryOrder[0] || DEFAULT_CATEGORY;
    if (!d.categories[name]) { d.categories[name] = []; d.categoryOrder.push(name); }
    d.categories[name].push({ id: uid(), text: text, isDisabled: false });
  }

  function getCheckedIds(catName) {
    var catEl = findCatEl(catName); if (!catEl) return [];
    var boxes = catEl.querySelectorAll('.mac-card-check'); var ids = [];
    for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) ids.push(boxes[i].dataset.id);
    return ids;
  }

  function deleteCategoryForce(name, target) {
    var d = Store.data; var cards = d.categories[name] || [];
    if (target && d.categories[target]) cards.forEach(function (c) { d.categories[target].push({ id: c.id || uid(), text: c.text, isDisabled: c.isDisabled }); });
    delete d.categories[name]; d.categoryOrder = d.categoryOrder.filter(function (n) { return n !== name; }); delete expandedCats[name];
    Store.save(); renderAll(); applyEntryUI(); toast('分类已删除');
  }

  async function handleAction(act, btn) {
    var d = Store.data;
    switch (act) {
      case 'close': closePanel(); break;
      
      case 'test-send': {
        var input = panelRoot.querySelector('[data-role="test-msg"]');
        var txt = (input.value || '').trim();
        if (txt) injectFakeMessage(txt, 'out', true); // 测试手动发送
        break;
      }

      case 'manual-add': {
        var ta = panelRoot.querySelector('[data-role="manual-text"]'); var text = (ta.value || '').trim();
        if (!text) { toast('请输入字卡内容'); return; }
        if (Array.from(text).length > 200) { toast('内容过长'); return; }
        var catSel = panelRoot.querySelector('[data-role="manual-cat"]'); var cat = (catSel && catSel.value) || d.categoryOrder[0] || DEFAULT_CATEGORY;
        d.pending.push({ id: uid(), action: 'add', text: text, category: cat, targetCategory: '', sender: '我' });
        Store.save(); ta.value = ''; hideBadge = false; renderAll(); updateBadges(); toast('已加入待审核');
        break;
      }

      case 'approve': {
        var pid = btn.dataset.id; var item = findPendingById(pid); if (!item) return;
        if (item.action === 'add') {
          var selEl = panelRoot.querySelector('[data-role="pending-cat"][data-id="' + pid + '"]');
          addCardToCategory(selEl ? selEl.value : item.category, item.text);
        } else if (item.action === 'delete') {
          if (d.categories[item.category]) d.categories[item.category] = d.categories[item.category].filter(function(c) { return c.text !== item.text; });
        } else if (item.action === 'disable') {
          if (d.categories[item.category]) { var card = d.categories[item.category].find(function(c) { return c.text === item.text; }); if (card) card.isDisabled = true; }
        } else if (item.action === 'move') {
          var selEl = panelRoot.querySelector('[data-role="pending-target-cat"][data-id="' + pid + '"]'); var targetCat = selEl ? selEl.value : item.targetCategory;
          if (d.categories[item.category] && d.categories[targetCat]) {
            var idx = d.categories[item.category].findIndex(function(c) { return c.text === item.text; });
            if (idx !== -1) d.categories[targetCat].push(d.categories[item.category].splice(idx, 1)[0]);
          }
        }
        d.pending = d.pending.filter(function (p) { return p.id !== pid; });
        Store.save(); renderAll(); updateBadges(); toast('已同意申请');
        break;
      }

      case 'reject': { d.pending = d.pending.filter(function (p) { return p.id !== btn.dataset.id; }); Store.save(); renderAll(); updateBadges(); break; }

      case 'approve-all': {
        if (!d.pending.length) { toast('没有待审核事项'); return; }
        var list = d.pending.slice();
        list.forEach(function (p) {
          if (p.action === 'add') addCardToCategory(p.category, p.text);
          else if (p.action === 'delete') { if (d.categories[p.category]) d.categories[p.category] = d.categories[p.category].filter(function(c) { return c.text !== p.text; }); }
          else if (p.action === 'disable') { if (d.categories[p.category]) { var card = d.categories[p.category].find(function(c) { return c.text === p.text; }); if (card) card.isDisabled = true; } }
          else if (p.action === 'move') {
            var tgt = p.targetCategory || p.category;
            if (d.categories[p.category] && d.categories[tgt]) {
              var idx = d.categories[p.category].findIndex(function(c) { return c.text === p.text; });
              if (idx !== -1) d.categories[tgt].push(d.categories[p.category].splice(idx, 1)[0]);
            }
          }
        });
        d.pending = []; Store.save(); renderAll(); updateBadges(); toast('已全部通过');
        break;
      }

      case 'clear-pending': {
        if (!d.pending.length) return;
        var okClear = await confirmModal('清空待审核', '确定清空全部待审核事项吗？此操作不可撤销。', '清空');
        if (!okClear) return;
        d.pending = []; Store.save(); renderAll(); updateBadges();
        break;
      }

      case 'add-cat': {
        var input = panelRoot.querySelector('[data-role="new-cat"]'); var name = (input.value || '').trim();
        if (!name) { toast('请输入分类名称'); return; }
        if (name.length > 20) { toast('分类名过长'); return; }
        if (d.categories[name]) { toast('该分类已存在'); return; }
        d.categories[name] = []; d.categoryOrder.push(name); input.value = ''; Store.save(); renderAll();
        break;
      }

      case 'cat-up': case 'cat-down': {
        var cname = btn.dataset.cat; var idx = d.categoryOrder.indexOf(cname); if (idx === -1) return;
        var newIdx = act === 'cat-up' ? idx - 1 : idx + 1; if (newIdx < 0 || newIdx >= d.categoryOrder.length) return;
        var arr = d.categoryOrder.slice(); arr.splice(idx, 1); arr.splice(newIdx, 0, cname); d.categoryOrder = arr; Store.save(); renderCards();
        break;
      }

      case 'cat-toggle': { expandedCats[btn.dataset.cat] = !expandedCats[btn.dataset.cat]; renderCards(); break; }

      case 'cat-rename': {
        var oldName = btn.dataset.cat;
        var newName = await showModal({ title: '重命名分类', html: '<input class="mac-input" data-role="rename-input" style="width:100%" value="' + escAttr(oldName) + '">', okText: '保存', onOk: function (rootEl) { return (rootEl.querySelector('[data-role="rename-input"]').value || '').trim(); } });
        if (!newName || newName === oldName) return;
        if (d.categories[newName]) { toast('同名分类已存在'); return; }
        d.categories[newName] = d.categories[oldName] || []; delete d.categories[oldName];
        d.categoryOrder = d.categoryOrder.map(function (n) { return n === oldName ? newName : n; });
        d.pending.forEach(function (p) { if (p.category === oldName) p.category = newName; if (p.targetCategory === oldName) p.targetCategory = newName; });
        if (expandedCats[oldName]) { delete expandedCats[oldName]; expandedCats[newName] = true; }
        Store.save(); renderAll();
        break;
      }

      case 'cat-del': {
        var delName = btn.dataset.cat; var cards = d.categories[delName] || []; var others = d.categoryOrder.filter(function (n) { return n !== delName; });
        if (!cards.length) { if (await confirmModal('删除分类', '确定删除空分类「' + delName + '」吗？', '删除')) deleteCategoryForce(delName, null); return; }
        if (!others.length) { if (await confirmModal('删除分类', '「' + delName + '」是唯一分类且包含 ' + cards.length + ' 张字卡，删除将同时移除这些字卡，确定吗？', '一并删除')) deleteCategoryForce(delName, null); return; }
        var moveTo = await showModal({ title: '删除分类', html: '<div class="mac-tip">分类「' + esc(delName) + '」下有 <b>' + cards.length + '</b> 张字卡，请选择要转移到的目标分类：</div><select class="mac-select" data-role="move-target" style="width:100%;margin-top:10px">' + others.map(function (n) { return '<option value="' + escAttr(n) + '">' + esc(n) + '</option>'; }).join('') + '</select>', okText: '转移并删除', onOk: function (rootEl) { return rootEl.querySelector('[data-role="move-target"]').value; } });
        if (!moveTo) return; deleteCategoryForce(delName, moveTo);
        break;
      }

      case 'card-send': {
        var scat = btn.dataset.cat;
        var sid = btn.dataset.id;
        var scardList = d.categories[scat] || [];
        var scard = null;
        for (var i = 0; i < scardList.length; i++) {
          if (scardList[i].id === sid) { scard = scardList[i]; break; }
        }
        if (!scard) return;
        // 作为梦角发送 (side: 'in')，并自动刷新
        injectFakeMessage(scard.text, 'in', true);
        break;
      }

      case 'card-recover': {
        var rcat = btn.dataset.cat; var rid = btn.dataset.id; var rcardList = d.categories[rcat] || [];
        for (var i = 0; i < rcardList.length; i++) { if (rcardList[i].id === rid) { rcardList[i].isDisabled = false; Store.save(); renderCards(); toast('字卡已恢复'); break; } }
        break;
      }

      case 'card-edit': {
        var ecat = btn.dataset.cat; var eid = btn.dataset.id; var cardList = d.categories[ecat] || []; var card = null;
        for (var i = 0; i < cardList.length; i++) if (cardList[i].id === eid) { card = cardList[i]; break; }
        if (!card) return;
        var newText = await showModal({ title: '编辑字卡', html: '<textarea class="mac-textarea" data-role="edit-text">' + esc(card.text) + '</textarea>', okText: '保存', onOk: function (rootEl) { return (rootEl.querySelector('[data-role="edit-text"]').value || '').trim(); } });
        if (!newText) return; card.text = newText; Store.save(); renderCards(); toast('已保存');
        break;
      }

      case 'card-del': {
        var dcat = btn.dataset.cat; var did = btn.dataset.id;
        if (await confirmModal('删除字卡', '确定删除这张字卡吗？', '删除')) { d.categories[dcat] = (d.categories[dcat] || []).filter(function (c) { return c.id !== did; }); Store.save(); renderCards(); }
        break;
      }

      case 'batch-del': {
        var bcat = btn.dataset.cat; var ids = getCheckedIds(bcat); if (!ids.length) { toast('请先勾选字卡'); return; }
        if (await confirmModal('批量删除', '确定删除选中的 ' + ids.length + ' 张字卡吗？', '删除')) { d.categories[bcat] = (d.categories[bcat] || []).filter(function (c) { return ids.indexOf(c.id) === -1; }); Store.save(); renderCards(); toast('已删除 ' + ids.length + ' 张字卡'); }
        break;
      }

      case 'batch-move': {
        var mcat = btn.dataset.cat; var mids = getCheckedIds(mcat); if (!mids.length) { toast('请先勾选字卡'); return; }
        var catEl = findCatEl(mcat); var tgtSel = catEl ? catEl.querySelector('[data-role="batch-target"]') : null; var tgt = tgtSel ? tgtSel.value : '';
        if (!tgt) { toast('没有可转移的目标分类'); return; }
        var moving = (d.categories[mcat] || []).filter(function (c) { return mids.indexOf(c.id) !== -1; });
        d.categories[mcat] = (d.categories[mcat] || []).filter(function (c) { return mids.indexOf(c.id) === -1; });
        d.categories[tgt] = (d.categories[tgt] || []).concat(moving); Store.save(); renderCards(); toast('已转移 ' + moving.length + ' 张字卡');
        break;
      }

      case 'upload-ball-img': { panelRoot.querySelector('[data-role="ball-img-file"]').click(); break; }
      case 'clear-ball-img': { if (!d.settings.ballImage) { toast('当前没有悬浮球图片'); return; } d.settings.ballImage = ''; Store.save(); applyEntryUI(); toast('悬浮球图片已清除'); break; }
      case 'upload-app-img': { panelRoot.querySelector('[data-role="app-img-file"]').click(); break; }
      case 'clear-app-img': { if (!d.settings.appIconImage) { toast('当前没有图标图片'); return; } d.settings.appIconImage = ''; Store.save(); applyEntryUI(); toast('九宫格图标图片已清除'); break; }
      case 'reset-pos': { d.settings.position = null; Store.save(); applyEntryUI(); toast('悬浮球位置已重置'); break; }
      case 'export': exportBackup(); break;
      case 'import': { panelRoot.querySelector('[data-role="import-file"]').click(); break; }
      default: break;
    }
  }

  function handleImageFile(file, type) {
    if (!/^image\//.test(file.type)) { toast('请选择图片文件'); return; }
    if (file.size > 10 * 1024 * 1024) { toast('图片过大（请小于 10MB）'); return; }
    compressImage(file).then(function(compressedDataUrl) {
      openCropModal(compressedDataUrl, type === 'ball', function (dataUrl) {
        if (type === 'ball') Store.data.settings.ballImage = dataUrl;
        else Store.data.settings.appIconImage = dataUrl;
        Store.save(); applyEntryUI(); toast('图片已更新');
      });
    }).catch(function() { toast('图片处理失败'); });
  }

  /* =======================================================================
   * 10. 数据备份与导入
   * ===================================================================== */
  function exportBackup() {
    try {
      var payload = { __app: 'my-audit-cards', version: 1, exportedAt: new Date().toISOString(), data: { categories: Store.data.categories, categoryOrder: Store.data.categoryOrder, pending: Store.data.pending, settings: Store.data.settings } };
      var json = JSON.stringify(payload, null, 2);
      var blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob); var a = document.createElement('a');
      var stamp = new Date(); var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
      a.href = url; a.download = '梦角字卡备份-' + stamp.getFullYear() + pad(stamp.getMonth() + 1) + pad(stamp.getDate()) + '-' + pad(stamp.getHours()) + pad(stamp.getMinutes()) + '.json'; a.style.display = 'none';
      document.body.appendChild(a); a.click();
      setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); URL.revokeObjectURL(url); }, 1500);
      toast('备份已导出');
    } catch (e) { toast('导出失败：' + e.message); }
  }

  function importBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(String(reader.result)); var payload = (parsed && parsed.data) ? parsed.data : parsed;
        if (!payload || typeof payload !== 'object') throw new Error('文件内容不是有效对象');
        var normalized = normalizeData(payload);
        if (!normalized.categoryOrder.length && !normalized.pending.length) throw new Error('备份中没有任何字卡数据');
        showModal({ title: '导入备份', html: '<div class="mac-tip">导入将<b>覆盖</b>当前所有字卡、待审核与外观设置，确定继续吗？</div>', okText: '覆盖导入', onOk: function () { return true; } }).then(function (ok) {
          if (!ok) return;
          Store.data = normalized; Store.save(); Store.ensureDefaults(); expandedCats = Object.create(null);
          applyEntryUI(); hideBadge = false;
          if (panelRoot && panelRoot.classList.contains('is-open')) renderAll();
          updateBadges(); toast('导入成功');
        });
      } catch (e) { toast('导入失败：' + e.message); }
    };
    reader.onerror = function () { toast('文件读取失败'); };
    reader.readAsText(file);
  }

  /* =======================================================================
   * 11. 启动与监听
   * ===================================================================== */
  function onResize() {
    if (!Store.data) return; positionBall();
    var s = Store.data.settings;
    if (s.position) {
      var x = clamp(s.position.x, 0, Math.max(0, window.innerWidth - s.ballSize));
      var y = clamp(s.position.y, 0, Math.max(0, window.innerHeight - s.ballSize));
      if (x !== s.position.x || y !== s.position.y) { s.position = { x: x, y: y }; Store.save(); positionBall(); }
    }
  }

  function setupObserver() {
    if (window.__mac_observer_attached) return;
    window.__mac_observer_attached = true;
    var observer = new MutationObserver(function(mutations) {
      if (window.__mac_inject_timer) clearTimeout(window.__mac_inject_timer);
      window.__mac_inject_timer = setTimeout(function() { tryInjectNativeIcon(); }, 250);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function boot() {
    if (!document.body) { setTimeout(boot, 100); return; }
    Store.load(); Store.ensureDefaults(); injectCSS();
    createBall(); applyEntryUI(); setupObserver();
    if (isForceShow) setTimeout(function () { toast('已通过 URL 强制显示悬浮球'); }, 1000);
    
    // 定时执行抓取与主动发消息
    setInterval(function () { try { autoFetch(false); } catch (e) {} }, FETCH_INTERVAL);
    
    window.addEventListener('resize', onResize); window.addEventListener('orientationchange', onResize);
  }

  ready(boot);

  window.MyAuditCards = {
    open: openPanel,
    close: closePanel,
    fetchNow: function() { autoFetch(true); }, // 在控制台手动触发抓取
    sendMsg: injectFakeMessage,
    getData: function () { return Store.data; },
    export: exportBackup
  };
})();
