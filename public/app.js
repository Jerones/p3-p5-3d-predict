// 前端渲染：三彩种切换、当日预测 / 历史预测、复盘明细、计划表交叉
let curType = "p3";
let curView = "today";
let cache = {};

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const balls = (nums) => nums.map((n) => `<span class="num ball">${n}</span>`).join(" ");
const chips = (arr) => arr.map((n) => `<span class="chip">${n}</span>`).join(" ");

async function load(type) {
  if (!cache[type]) {
    const r = await fetch(`/api/lottery?type=${encodeURIComponent(type)}`);
    cache[type] = await r.json();
  }
  return cache[type];
}

function danmaView(details) {
  if (!details) return "";
  const inner = details.map((d) =>
    d.hit ? `<span class="chip hit">${d.digit}✓</span>` : `<span class="chip miss">${d.digit}✗</span>`).join(" ");
  return `${inner} <span>(${details.filter((d) => d.hit).length}/${details.length})</span>`;
}
function killView(details) {
  if (!details) return "";
  return details.map((d) =>
    d.correct ? `<span class="chip ok">${d.digit}✓杀对</span>` : `<span class="chip bad">${d.digit}✗杀错(已开出)</span>`).join(" ");
}
function posView(details) {
  if (!details || !details.length) return "<span>定位候选未提供</span>";
  return details.map((p) =>
    `<div>${esc(p.name)}：候选 ${chips(p.picks)} · 开奖 ${p.actual} ${p.hit ? "<b>在候选中✓</b>" : "不在候选✗"}</div>`).join("");
}
function rangeView(label, d) {
  if (!d) return "";
  return `${label} 区间 ${d.low}–${d.high} · 实际 ${d.actual} ${d.inRange ? "✓在区间内" : "✗不在区间"}`;
}
function directView(r) {
  if (!r || !r.directDetails) return "";
  const best = r.bestCombo;
  let head = r.directHit ? "<b>直选全中✓</b>" : "未中直选";
  if (best) {
    const tag = best.kind === "exact" ? "直选全中✓" : best.kind === "digitFullWrongOrder" ? "数字全对·顺序错" : "最接近";
    head += ` · 代表注 ${best.combo}：位对${best.posMatches} · 数对${best.digitMatches} · ${tag}`;
  }
  const all = r.directDetails.map((d) =>
    `<span class="chip ${d.kind === "exact" ? "hit" : d.kind === "digitFullWrongOrder" ? "bad" : ""}">${d.combo} 位${d.posMatches}·数${d.digitMatches}${d.kind === "digitFullWrongOrder" ? "·顺序错" : ""}</span>`).join(" ");
  return `${head}<details><summary>展开全部注逐注明细</summary><div>${all}</div></details>`;
}
function reviewBlock(r) {
  if (!r) return "<p class='hint'>待开奖：今晚 22:00 开奖后刷新入库后显示开奖与复盘。</p>";
  return `<div class="kv">
    <span>开奖 ${balls(r.nums)}</span></div>
    <div>胆码 ${danmaView(r.danmaDetails)}</div>
    <div>定位 ${posView(r.posDetails)}<div>(${r.posHits}/${r.posDetails ? r.posDetails.length : 0} 位)</div></div>
    <div>杀号 ${killView(r.killDetails)}</div>
    <div>${rangeView("和值", r.sumDetail)}；${rangeView("跨度", r.spanDetail)}</div>
    <div>直选精选 ${directView(r)}</div>`;
}

async function render() {
  const app = $("#app");
  app.innerHTML = "<p class='loading'>加载中…</p>";
  const data = await load(curType);
  if (data.empty) { app.innerHTML = `<section class="card"><p>${esc(data.note || "暂无数据")}</p></section>`; return; }
  if (curView === "history") return renderHistory(data);
  const p = data.prediction, s = data.stats, rv = data.review;
  app.innerHTML = `
  <section class="card">
    <h2>${esc(data.name)} 第 ${esc(data.targetIssue)} 期预测 · 基于近 ${s.windowSize} 期 · 数据至第 ${esc(data.latest.issue)} 期</h2>
    <div class="kv">
      <span>胆码：<span class="big">${p.danma.join(" ")}</span></span>
      <span>杀号：${p.kills.join(" ")}</span>
      <span>组选池：${p.groupPool.join(" ")}</span>
      <span>和值区间：${p.sumRange.low}–${p.sumRange.high}</span>
      <span>跨度区间：${p.spanRange.low}–${p.spanRange.high}</span>
    </div>
    <h3>直选定位（每位候选）</h3>
    <div>${p.posPicks.map((picks, i) => `<div>第${i + 1}位：${chips(picks)}</div>`).join("")}</div>
    <h3>直选精选（${p.directCombos.length} 注，区间内优先）</h3>
    <div>${p.directCombos.map((c) => `<span class="chip">${c}</span>`).join(" ")}</div>
    <h3>走势统计（近 ${s.windowSize} 期）</h3>
    <div class="kv">
      <span>热号：${s.hot.join(" ")}</span><span>冷号：${s.cold.join(" ")}</span>
    </div>
    <div class="scroll"><table><tr><th>数字</th>${s.freq.map((_, d) => `<th>${d}</th>`).join("")}</tr>
    <tr><td>出现期次</td>${s.freq.map((v) => `<td>${v}</td>`).join("")}</tr>
    <tr><td>当前遗漏</td>${s.omission.map((v) => `<td>${v}</td>`).join("")}</tr></table></div>
    <p class="hint">和值分布 ${Object.entries(s.sumDist).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}:${v}次`).join(" · ")}<br>
    跨度分布 ${Object.entries(s.spanDist).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}次`).join(" · ")}<br>
    奇偶比 ${Object.entries(s.oddEven).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}(${v})`).join(" · ")} · 大小比 ${Object.entries(s.bigSmall).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}(${v})`).join(" · ")}<br>
    形态 ${Object.entries(s.formDist).map(([k, v]) => `${k}:${v}次`).join(" · ")}</p>
    <h3>近期开奖</h3>
    <div class="scroll"><table><tr><th>期号</th><th>开奖号</th><th>和值</th><th>跨度</th></tr>
    ${data.recentDraws.map((d) => `<tr><td>${d.issue}</td><td>${balls(d.nums)}</td><td>${d.nums.reduce((a, b) => a + b, 0)}</td><td>${Math.max(...d.nums) - Math.min(...d.nums)}</td></tr>`).join("")}
    </table></div>
  </section>
  <section class="card">
    <h2>预测复盘（近 ${rv.summary.issues} 期回测）</h2>
    <div class="kv">
      <span>胆码平均命中 ${rv.summary.danmaAvgHits} 个/期</span>
      <span>杀号准确率 ${rv.summary.killAccuracy}%（按杀号个数计）</span>
      <span>定位平均命中 ${rv.summary.posAvgHits} 位/期</span>
      <span>和值区间命中 ${rv.summary.sumRangeAccuracy}%</span>
      <span>直选精选命中率 ${rv.summary.directAccuracy}%（${rv.summary.directHitCount}/${rv.summary.issues} 期 · 整注全等口径）</span>
      <span>数字全对·顺序错 ${rv.summary.directDigitFullWrongOrderCount} 期</span>
      <span>最接近注平均位对 ${rv.summary.directBestAvgPos} · 平均数对 ${rv.summary.directBestAvgDigit}</span>
    </div>
    <div class="scroll"><table>
      <tr><th>期号</th><th>开奖</th><th>胆码</th><th>定位</th><th>杀号</th><th>和值/跨度</th><th>直选精选（位对/数对）</th></tr>
      ${rv.details.map((r) => `<tr>
        <td>${r.issue}</td><td>${balls(r.nums)}</td>
        <td>${danmaView(r.danmaDetails)}</td>
        <td>${posView(r.posDetails)}</td>
        <td>${killView(r.killDetails)}</td>
        <td>${rangeView("和值", r.sumDetail)}<br>${rangeView("跨度", r.spanDetail)}</td>
        <td>${directView(r)}</td></tr>`).join("")}
    </table></div>
  </section>`;
}

function renderHistory(data) {
  const app = $("#app");
  const snaps = data.snapshots || [];
  if (!snaps.length) { app.innerHTML = "<section class='card'><p>暂无历史存档。</p></section>"; return; }
  const sel = snaps[0];
  app.innerHTML = `
  <section class="card">
    <h2>历史预测存档（${esc(data.name)}）</h2>
    <p class="hint">每期预测首次生成即存档、刷新前先存不覆盖。每天 22:00 开奖后刷新时存档复盘当天预测并生成次日预测。</p>
    <div class="row">选择期号：
      <select id="snapSel">${snaps.map((s) => `<option value="${s.targetIssue}">第${s.targetIssue}期${s.review ? "" : "·待开奖"}${s.seed ? "（种子示例）" : ""}</option>`).join("")}</select>
    </div>
    <div id="snapBody"></div>
  </section>`;
  const drawSnap = (issue) => {
    const s = snaps.find((x) => x.targetIssue === issue) || sel;
    const p = s.prediction;
    $("#snapBody").innerHTML = `
      <h3>第 ${s.targetIssue} 期存档预测（基于第 ${s.basedOnLatestIssue} 期${s.seed ? " · 种子示例" : ""}）</h3>
      ${s.note ? `<p class="hint">${esc(s.note)}</p>` : ""}
      <div class="kv"><span>胆码：<span class="big">${p.danma.join(" ")}</span></span>
      <span>杀号：${p.kills.join(" ")}</span><span>组选池：${p.groupPool.join(" ")}</span>
      <span>和值区间：${p.sumRange.low}–${p.sumRange.high}</span><span>跨度区间：${p.spanRange.low}–${p.spanRange.high}</span></div>
      <div>直选精选：${p.directCombos.map((c) => `<span class="chip">${c}</span>`).join(" ")}</div>
      <h3>开奖复盘</h3>${reviewBlock(s.review)}`;
  };
  drawSnap(sel.targetIssue);
  $("#snapSel").addEventListener("change", (e) => drawSnap(e.target.value));
}

document.querySelectorAll("#lotteryTabs [data-type]").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll("#lotteryTabs [data-type]").forEach((x) => x.classList.remove("active"));
    b.classList.add("active"); curType = b.dataset.type; render();
  }));
document.querySelectorAll("#viewTabs [data-view]").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll("#viewTabs [data-view]").forEach((x) => x.classList.remove("active"));
    b.classList.add("active"); curView = b.dataset.view; render();
  }));
$("#refreshBtn").addEventListener("click", async () => {
  $("#refreshBtn").textContent = "刷新中…";
  try { await fetch("/api/refresh", { method: "POST" }); } catch (e) { /* 忽略，重新加载即可 */ }
  cache = {}; await render();
  $("#refreshBtn").textContent = "刷新数据";
});
$("#planFile").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (f) $("#planText").value = await f.text();
});
$("#planBtn").addEventListener("click", async () => {
  const text = $("#planText").value;
  const r = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: curType, text }) });
  const d = await r.json();
  if (d.error) { $("#planResult").innerHTML = `<p>${esc(d.error)}</p>`; return; }
  $("#planResult").innerHTML = `
    <p>解析结果 — 胆码：${d.plan.danma.join(" ") || "无"} · 杀号：${d.plan.kills.join(" ") || "无"} · 推荐注：${d.plan.combos.join(" ") || "无"}</p>
    <p>共识胆码：${d.cross.consensusDanma.join(" ") || "无"}</p>
    <p>交叉精选：${d.cross.crossCombos.map((c) => `<span class="chip ok">${c.combo}</span>`).join(" ") || "无"}</p>
    <p>风险组：${d.cross.riskCombos.map((c) => `<span class="chip bad">${c.combo}（${esc(c.reason)}）</span>`).join(" ") || "无"}</p>
    <p class="warn">${esc(d.disclaimer)}</p>`;
});

render();
