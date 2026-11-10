(function () { try {
/* ===== 功能：线上有新版 · 强制刷新提醒弹窗（移植自言字卡 update-check.js 的提醒层） =====
归属：系统 / PWA / 开屏（AI-B 域）。build.mjs jsFiles 插在 pwa.js 之后加载。
触发：pwa.js 版本轮询判出「线上 version.json 比本页构建 ts 新」（本页是旧缓存包）时调用
window.mochiUpdateRemindShow()；已是最新＝不弹。静默自动升级（tryAutoUpgrade）照旧并行。
层位：#splash 内的自绘遮罩卡——开屏期间 modal-mask 不可见（.phone 整棵 visibility:hidden、
modal z-998 低于 splash z-999），不能用 openModal；与开屏同层，不新建全局遮罩、不改 z-index。
动作：主动作只有「点击刷新」＝走 pwa.js 的 mochiRefreshNow（预取最新 index 落进 SW 缓存再
reload，弱网根治「刷了还在旧版」）；下方留「暂不刷新」小字逃生口——离线/弱网刷不动时
不至于被钉死在开屏；关掉后本会话不再弹，下次打开仍是旧包会再弹。
无头/回归环境（webdriver / Headless UA）与 file:// 直开不弹，避免 278 个回归脚本被挡在门外。
====================================================== */
(function () {
'use strict';
const IS_AUTOMATION = (typeof navigator !== 'undefined') &&
(navigator.webdriver === true || /Headless/i.test(String(navigator.userAgent)));
const TITLE = '重要更新：2026.10.30 起禁止二传链接';
const BODY = 'mochi 的链接被大范围公开二传：很多二传不标注作者署名，不少人已经做过入站问卷、明知这是违规行为仍然继续，甚至拿本站去引流。作者最近看了抖音，才发现 mochi 的二传范围和影响远比想象中大（之前低估了）——二传的人实在太多，导致大量圈外人误入、站点被迫扩圈。所以从 2026.10.30 起，本站禁止二传链接：本站链接与代码库链接都算，任何形式的传播（分享到抖音、小红书等公开平台、转发到群聊、私发他人）都算二传；链接请自己留着、自己用，需要链接请到作者主页（抖音 @言序 58334080131、小红书 @言序 1842523578）简介里拿。同时明确一条新规：二改 mochi 原网站后如果要公开，必须先经过作者同意（自己拿代码改、自己私人使用、不公开也不给别人用的，不用问）。本次同时更换了站点地址，旧链接已失效（新地址见开屏署名卡）。另外写明两条：① 公开的二改版，链接只能在二改者本人的主页（抖音、小红书等）里提供、同样禁止二传，不许由公开者以外的人二传、搬运；② 把代码交给 AI 重写/换皮后冒充「从零写的原创」，同样属于抄袭。本次更新同步修改了开屏公告与入站问卷；《本站入站须知》已升版，进站时需要用新规则重新确认一次（只有 8 道原则题，很快）。提示：点击刷新后要重新下载全部内容（约 5.6MB），网络慢时可能需要一两分钟，请保持页面打开等它自动完成；如果刷新后进来还是旧版，说明刚才没下载完，再点一次刷新（或多试几次）就好。';
const BTN = '点击刷新更新至2026.10.30版本';
let done = false; // 本会话已弹过（含被「暂不刷新」关掉）＝不再重复弹
function esc(s) {
return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
window.mochiUpdateRemindShow = function () {
if (done || IS_AUTOMATION) return false;
if (!/^https?:$/.test(location.protocol)) return false;
const sp = document.getElementById('splash');
if (!sp || sp.classList.contains('hide')) return false; // 已进应用＝静默通道接管，不打扰会话
done = true;
const wrap = document.createElement('div');
wrap.className = 'ur-wrap';
wrap.id = 'update-remind-wrap';
wrap.innerHTML =
'<div class="ur-card">' +
'<div class="ur-t">' + esc(TITLE) + '</div>' +
'<div class="ur-d">' + esc(BODY) + '</div>' +
'<button type="button" class="ur-go">' + esc(BTN) + '</button>' +
'<div class="ur-st" role="status"></div>' +
'<button type="button" class="ur-later">暂不刷新</button>' +
'</div>';
sp.appendChild(wrap);
const go = wrap.querySelector('.ur-go');
const st = wrap.querySelector('.ur-st');
let refreshing = false, failTimer = 0, msgOn = false;
function urMsg(e) {
if (e.data && e.data.type === 'PRECACHE_DONE') {
try { navigator.serviceWorker.removeEventListener('message', urMsg); } catch (x) {}
msgOn = false;
try { location.reload(); } catch (x2) {}
}
}
function armMsg() {
if (msgOn || !(navigator.serviceWorker && navigator.serviceWorker.addEventListener)) return;
msgOn = true;
navigator.serviceWorker.addEventListener('message', urMsg);
}
function onFail() {
if (!refreshing) return;
refreshing = false;
if (msgOn) { try { navigator.serviceWorker.removeEventListener('message', urMsg); } catch (x) {} msgOn = false; }
if (!wrap.parentNode) return; // 弹窗已被「暂不刷新」关掉＝后台继续下、DONE 到了照样换版
go.disabled = false;
go.textContent = BTN;
st.textContent = '新版没下载完（网络太慢），本次等待已停止。可以再点一次上面的按钮重试，或点「暂不刷新」先进入（下次打开仍是旧版时会再提醒）。';
st.classList.add('show');
}
go.addEventListener('click', function () {
if (refreshing) return;
refreshing = true;
go.disabled = true;
go.textContent = '正在刷新…请保持页面打开';
st.textContent = '正在下载新版（网络慢时可能需要一两分钟），完成后会自动刷新，不用手动操作。';
st.classList.add('show');
armMsg();
if (failTimer) clearTimeout(failTimer);
failTimer = setTimeout(onFail, 185000); // 比 refreshNow 手动通道的 180s 超时晚一点，只补「如实告知」
try { if (window.mochiRefreshNow) { window.mochiRefreshNow(); return; } } catch (e) {}
try { location.reload(); } catch (e2) {}
});
wrap.querySelector('.ur-later').addEventListener('click', function () {
if (failTimer) { clearTimeout(failTimer); failTimer = 0; }
if (msgOn) { try { navigator.serviceWorker.removeEventListener('message', urMsg); } catch (x) {} msgOn = false; }
if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
});
return true;
};
window.__updateRemindReady = true;
/* ===== #1582（2026-10-22 作者直派「把这个弹窗固定，本次必定更新刷新」）=====
上面那条通道依赖「线上 version.json 的 ts > 本页 data-build-ts」才弹，判定不成立的情形很多——
version.json 请求被弱网/缓存吞掉、用户上次点了「暂不刷新」、PWA 快捷方式几天不重新导航等；
任何一种成立，用户就永远停在旧包上，表现就是「修了但还有人看不到第 8 题」。
本段是【按版本一次性强提醒】，判据只读本页自己的构建号（data-build-ts，构建时注入、零网络依赖）：
本页构建时间 ≤ FORCE_FLOOR_TS（＝上一版含缺陷的包）→ 必弹，不看版本号也不看网络；
已是最新包（ts 更大）→ 不弹，不制造无谓打扰。
弹过即记标记 xy-home-v2:update-remind-force（已进 contacts.js EXCLUDE），本版不再重复；
下次要再强提醒只需改 FORCE_TAG（并同步 FORCE_FLOOR_TS）。 */
const FORCE_TAG = '2026-10-30a';
const FORCE_FLOOR_TS = 1793275935623; // ≤ 2026-10-29 20:12（含上一批导出的包与更早的全部版本）＝旧包：一律必弹；本次新包 ts 更大＝自身不弹
const FORCE_KEY = 'update-remind-force';
const G = 'xy-home-v2';
function fGet(k) {
try { const v = window.xyStore ? window.xyStore(G).get(k) : null; if (v !== null && v !== undefined) return v; } catch (e) {}
try { return localStorage.getItem(G + ':' + k); } catch (e2) { return null; }
}
function fSet(k, v) {
try { if (window.xyStore) window.xyStore(G).set(k, v); else localStorage.setItem(G + ':' + k, v); }
catch (e) { try { localStorage.setItem(G + ':' + k, v); } catch (e2) {} }
}
(function forceOnce() {
if (IS_AUTOMATION) return;
if (!/^https?:$/.test(location.protocol)) return;
let pageTs = 0;
try {
const sv = document.getElementById('splash-ver');
pageTs = sv ? Number(sv.getAttribute('data-build-ts')) || 0 : 0;
} catch (e0) { pageTs = 0; }
if (pageTs > FORCE_FLOOR_TS) return; // 已是最新包 → 不弹
try { if (fGet(FORCE_KEY) === FORCE_TAG) return; } catch (e) { return; }
let n = 0; // 最多等 ~15s（开屏/本文件就绪）；弹成功即记标记收手
const t = setInterval(function () {
const sp = document.getElementById('splash');
const fn = window.mochiUpdateRemindShow;
if (sp && !sp.classList.contains('hide')) {
if (document.getElementById('update-remind-wrap')) {
fSet(FORCE_KEY, FORCE_TAG);
clearInterval(t);
return;
}
if (typeof fn === 'function' && fn()) {
fSet(FORCE_KEY, FORCE_TAG);
clearInterval(t);
return;
}
}
if (++n > 50) clearInterval(t);
}, 300);
})();
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("update-remind.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("update-remind.js"); try { console.error("[JS] update-remind.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[update-remind.js] " + String(__e && __e.message || __e)); } })();