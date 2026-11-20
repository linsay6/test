// icon-registry.base.js
// 图标注册公共底座 A方案：无内置弹窗，点击回调由业务模块自行实现
// 本文件必须在所有业务模块之前合并加载，处于 Module1_AuditEntry 闭包内部

const injectedRegistry = new Set();

/**
 * 注册桌面应用图标
 * @param {Object} opts
 * @param {string} opts.id 图标唯一id
 * @param {string} opts.name 图标展示名称
 * @param {string} opts.svg svg图标源码字符串
 * @param {Function} opts.onClick 图标点击回调
 * @param {string} [opts.badge] 角标文字，不传则不显示角标
 */
function registerAppIcon(opts) {
    const { id, name, svg, onClick, badge = "" } = opts;
    if (injectedRegistry.has(id)) {
        updateBadge(id, badge);
        return;
    }

    const container = getDeskContainer();
    if (!container) return;

    const iconEl = document.createElement("div");
    iconEl.className = "audit-app-icon";
    iconEl.dataset.iconId = id;
    iconEl.innerHTML = `
        <div class="icon-svg">${svg}</div>
        <div class="icon-name">${name}</div>
        <div class="icon-badge" style="display:${badge ? '' : 'none'}">${badge}</div>
    `;

    iconEl.addEventListener("click", onClick);
    container.appendChild(iconEl);
    injectedRegistry.add(id);
    updateBadge(id, badge);
}

/**
 * 更新指定图标的角标
 * @param {string} id
 * @param {string} text
 */
function updateBadge(id, text) {
    const el = document.querySelector(`.audit-app-icon[data-icon-id="${id}"] .icon-badge`);
    if (!el) return;
    el.textContent = text;
    el.style.display = text ? "" : "none";
}
// 自动注入图标样式，加到icon-registry.base.js最后
(function injectIconStyle(){
  const styleId = "audit-app-icon-style";
  if(document.getElementById(styleId)) return;
  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
.audit-app-icon {
    position: relative;
    width: 64px;
    display: flex;
    flex-direction: column;
    align-items: center;
    cursor: pointer;
    gap:4px;
}
.audit-app-icon .icon-svg {
    width: 40px;
    height:40px;
}
.audit-app-icon .icon-name {
    font-size: 12px;
    text-align: center;
}
.audit-app-icon .icon-badge {
    position: absolute;
    top: 0;
    right: 0;
    background: #f56c6c;
    color: #fff;
    font-size:10px;
    padding: 1px 4px;
    border-radius: 6px;
    min-width: 14px;
    text-align: center;
}
  `;
  document.head.appendChild(style);
})();

