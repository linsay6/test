(function () {
try {
(function () {
'use strict';
// ========== 审核模块配置，和mood-diary结构对齐 ==========
const KEY = 'audit';
function store() { return window.activeStore(); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function toast(t) {
try {
let el = document.getElementById('cc-toast');
if (!el) {
el = document.createElement('div');
el.id = 'cc-toast';
document.body.appendChild(el);
}
el.textContent = t;
el.className = 'cc-toast show';
clearTimeout(el.__timer);
el.__timer = setTimeout(() => { el.className = 'cc-toast'; }, 1800);
} catch (e) {}
}
function pad(n) { return (n < 10 ? '0' : '') + n; }
function dkey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

// 数据标准化
function normPkg(v) {
if (!v || typeof v !== 'object' || !Array.isArray(v.list)) return null;
return v;
}
function loadAll() {
try { const p = normPkg(JSON.parse(store().get(KEY) || 'null')); if (p) return p; } catch (e) {}
return { list: [] };
}
function libKey() { return window.activePrefix() + ':' + KEY; }
function parseLib(raw) {
if (typeof raw !== 'string' || !raw) return null;
try { return normPkg(JSON.parse(raw)); } catch (e) { return null; }
}
// 合并云端/本地数据
function unionPkg(lib, ours) {
if (!lib) return ours;
const out = { list: [...ours.list] };
lib.list.forEach(item => {
const exist = out.list.find(x => x.id === item.id);
if (!exist) out.list.push(item);
});
return out;
}

let _libMergeBusy = false, _libMergeAgain = false;
function queueLibMerge(retry) {
if (_libMergeBusy) { _libMergeAgain = true; return; }
_libMergeBusy = true;
const info = {};
let p;
try { p = Promise.resolve(window.idbGet(libKey(), info)); } catch (e) { p = Promise.resolve(undefined); }
const bail = function () {
_libMergeBusy = false;
if (!retry) { setTimeout(queueLibMerge, 4000, true); return; }
if (_libMergeAgain) { _libMergeAgain = false; queueLibMerge(false); }
};
Promise.resolve(p).then(function (libRaw) {
_libMergeBusy = false;
const ours = loadAll();
if ((libRaw === undefined || libRaw === null) && info.ambiguous) { bail(); return; }
const merged = unionPkg(parseLib(libRaw), ours);
try { store().set(KEY, JSON.stringify(merged)); } catch (e) {}
renderAuditCards();
if (_libMergeAgain) { _libMergeAgain = false; queueLibMerge(false); }
}, bail);
}

function saveAll(data) {
const s = JSON.stringify(data);
try { if (window.idbMemoSet) window.idbMemoSet(libKey(), s); } catch (e) {}
try { localStorage.setItem(libKey(), s); } catch (e) {}
if (!window.idbMemoSet || !window.idbGet || !window.idbSet) {
try { store().set(KEY, s); } catch (e2) {}
try { if (window.idbSet) window.idbSet(libKey(), s); } catch (e2) {}
return;
}
queueLibMerge(false);
}

// ========== 底部fd-fbar 导出 / 导入 / 清空 操作栏【重点，就是你要的栏】 ==========
function initFbar() {
const wrap = document.querySelector('.page-content');
if (!wrap || document.querySelector('.fd-fbar')) return;
const fbar = document.createElement('div');
fbar.className = 'fd-fbar';
fbar.innerHTML = `
  <button class="fd-export">导出JSON</button>
  <button class="fd-import">导入JSON</button>
  <input type="file" class="fd-import-file" accept=".json" hidden>
  <button class="fd-clear">清空全部审核数据</button>
`;
wrap.appendChild(fbar);
bindFbarEvent();
}
function bindFbarEvent() {
const pageWrap = document.getElementById('page-audit');
if (!pageWrap) return;
const expBtn = pageWrap.querySelector('.fd-export');
const impBtn = pageWrap.querySelector('.fd-import');
const fileInput = pageWrap.querySelector('.fd-import-file');
const clearBtn = pageWrap.querySelector('.fd-clear');

expBtn.onclick = function(){
const data = loadAll();
const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'audit-data.json';
a.click();
URL.revokeObjectURL(url);
toast('导出成功');
};
impBtn.onclick = function(){ fileInput.click(); };
fileInput.onchange = function(e){
const f = e.target.files[0];
if(!f) return;
const reader = new FileReader();
reader.onload = function(ev){
try{
const json = JSON.parse(ev.target.result);
const pkg = normPkg(json);
if(!pkg) throw new Error('格式不对');
saveAll(pkg);
renderAuditCards();
toast('导入完成');
}catch(err){
toast('导入失败，文件格式错误');
}
};
reader.readAsText(f);
};
clearBtn.onclick = function(){
if(!confirm('确定清空所有审核卡片数据？不可恢复！')) return;
saveAll({list:[]});
renderAuditCards();
toast('已清空');
};
}

// ========== 审核卡片渲染函数（你后续在这里改成自己的审核UI逻辑） ==========
function renderAuditCards(){
const cardWrap = document.getElementById('audit-card-wrap');
if(!cardWrap) return;
const data = loadAll();
if(!data.list.length){
cardWrap.innerHTML = `<div class="tip">暂无待审核卡片，等待提交...</div>`;
return;
}
let html = '';
data.list.forEach(item=>{
// item 示例结构 {id:"xxx",title:"卡片标题",content:"卡片内容",status:"pending",submitTs:123456}
html += `
<div class="audit-card-item">
  <div class="audit-card-title">${esc(item.title||'无标题')}</div>
  <div class="audit-card-body">${esc(item.content||'')}</div>
  <div class="audit-card-status">状态：${esc(item.status||'pending')}</div>
  <div class="audit-card-ctrl">
    <button class="audit-pass" data-id="${esc(item.id)}">通过</button>
    <button class="audit-reject" data-id="${esc(item.id)}">驳回</button>
  </div>
</div>
`;
});
cardWrap.innerHTML = html;
bindCardAction();
}
// 卡片内 通过/驳回 按钮绑定（基础占位，后续你扩展）
function bindCardAction(){
const pageEl = document.getElementById('page-audit');
if(!pageEl) return;
pageEl.querySelectorAll('.audit-pass').forEach(btn=>{
btn.onclick = function(){
const id = this.dataset.id;
const pkg = loadAll();
const target = pkg.list.find(x=>x.id===id);
if(target){
target.status = 'pass';
saveAll(pkg);
renderAuditCards();
toast('已通过');
}
};
});
pageEl.querySelectorAll('.audit-reject').forEach(btn=>{
btn.onclick = function(){
const id = this.dataset.id;
const pkg = loadAll();
const target = pkg.list.find(x=>x.id===id);
if(target){
target.status = 'reject';
saveAll(pkg);
renderAuditCards();
toast('已驳回');
}
};
});
}

// ========== 页面打开入口函数，feature-hub 跳转调用 ==========
function openAuditPage() {
const pg = document.getElementById('page-audit');
if (!pg) return;
document.querySelectorAll('.page').forEach(p => p.hidden = true);
pg.hidden = false;
renderAuditCards();
initFbar(); // 打开页面就挂载底部导出导入栏
}

// 顶部返回、页面控件绑定
function bindChrome() {
const back = document.getElementById('audit-back');
if (back && !back.dataset.bound) {
back.dataset.bound = '1';
back.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
// 默认返回功能主页 page-phone，你可以按需改成 page-feature 或者别的
const backTarget = 'page-phone';
const node = document.getElementById(backTarget);
if (node) node.hidden = false;
});
}
}
function init() {
bindChrome();
if (!document.getElementById('audit-back')) setTimeout(bindChrome, 1500);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

// 暴露全局入口，给路由调用
window.openAuditPage = openAuditPage;
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("page-audit.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("page-audit.js"); try { console.error("[JS] page-audit.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[page-audit.js] " + String(__e && __e.message || __e)); } })();

