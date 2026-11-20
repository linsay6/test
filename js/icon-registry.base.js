// icon-registry.base.js
// 图标注册公共底座 A方案：无内置弹窗，生成原生 .app 结构，样式完全复用网站自带
// 本文件必须在所有业务模块之前合并加载，处于 Module1_AuditEntry 闭包内部

const injectedRegistry = new Set();

/**
 * 注册桌面应用图标，生成原生 .app 结构
 * @param {Object} opts
 * @param {string} opts.id 图标唯一id，对应 data-app
 * @param {string} opts.name 图标展示名称
 * @param {string} opts.svg 图标源码，svg字符串或 img 标签字符串
 * @param {Function} opts.onClick 图标点击回调
 * @param {string} [opts.badge] 角标文字，不传则不显示
 */
function registerAppIcon(opts) {
    const { id, name, svg, onClick, badge = "" } = opts;
    if (injectedRegistry.has(id)) {
        updateBadge(id, badge);
        return;
    }

    const container = getDeskContainer();
    if (!container) {
        setTimeout(function () { registerAppIcon(opts); }, 300);
        return;
    }

    const iconEl = document.createElement("div");
    iconEl.className = "app";
    iconEl.dataset.app = id;
    iconEl.dataset.deskWidget = "app-" + id;
    iconEl.innerHTML =
        '<div class="app-ico">' + svg + '</div>' +
        '<div class="app-name">' + name + '</div>';

    iconEl.addEventListener("click", function (ev) {
        if (ev) ev.stopPropagation();
        onClick(ev);
    });

    container.appendChild(iconEl);
    injectedRegistry.add(id);
    updateBadge(id, badge);
}

/**
 * 更新指定图标角标，复用现有 .audit-badge 样式
 * @param {string} id
 * @param {string} text
 */
function updateBadge(id, text) {
    const icon = document.querySelector('.app[data-app="' + id + '"]');
    if (!icon) return;
    let badge = icon.querySelector('.audit-badge');
    if (!badge) {
        badge = document.createElement('div');
        badge.className = 'audit-badge';
        icon.appendChild(badge);
    }
    badge.dataset.count = text || '0';
    badge.textContent = text || '';
    badge.style.display = text ? '' : 'none';
}
