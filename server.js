// 零依赖后端：Node 内置 http 提供静态页面与 JSON API。
// API:
//   GET  /api/lottery?type=p3|p5|3d   分析 + 当日预测 + 近10期复盘 + 历史存档
//   POST /api/plan  {type, text}     计划表解析与交叉（仅参考）
//   POST /api/refresh                重新抓取新浪数据（并为下一期生成/存档预测）
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { LOTTERIES, analyzeWindow, buildPrediction, buildReview, reviewOne, nextIssueOf, parsePlanSheet, crossPlan } from "./lib/analysis.mjs";
import { fetchAll } from "./lib/fetch-sina.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = join(root, "data");
const drawsPath = join(dataDir, "draws.json");
const snapshotsPath = join(dataDir, "snapshots.json");
const PORT = process.env.PORT || 5173;

function loadDraws() {
  if (!existsSync(drawsPath)) return { draws: { p3: [], p5: [], "3d": [] }, fetchedAt: null, note: "尚未抓取，请先运行 npm run fetch" };
  return JSON.parse(readFileSync(drawsPath, "utf8"));
}
function loadSnapshots() {
  if (!existsSync(snapshotsPath)) return { snapshots: [] };
  return JSON.parse(readFileSync(snapshotsPath, "utf8"));
}
function saveSnapshots(data) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(snapshotsPath, JSON.stringify(data, null, 1), "utf8");
}

// 预测首次生成即存档：按 彩种+目标期号 唯一，已存在不覆盖。
function ensureSnapshot(type, targetIssue, basedOnLatestIssue, prediction) {
  const data = loadSnapshots();
  if (data.snapshots.some((s) => s.lottery === type && s.targetIssue === targetIssue)) return false;
  data.snapshots.push({
    lottery: type, targetIssue, basedOnLatestIssue,
    prediction: snapshotPrediction(prediction),
    seed: false, note: "", createdAt: new Date().toISOString(),
  });
  saveSnapshots(data);
  return true;
}
function snapshotPrediction(p) {
  return {
    danma: p.danma, kills: p.kills, groupPool: p.groupPool, posPicks: p.posPicks,
    directCombos: p.directCombos.map((c) => c.combo),
    sumRange: p.sumRange, spanRange: p.spanRange,
  };
}
// 存档复盘计算时把 directCombos 还原为对象数组
function revivePrediction(sp) {
  return { ...sp, directCombos: sp.directCombos.map((c) => (typeof c === "string" ? { combo: c, nums: c.split("").map(Number) } : c)) };
}

function lotteryPayload(type) {
  const all = loadDraws();
  const draws = (all.draws && all.draws[type]) || [];
  if (!draws.length) {
    return { type, name: LOTTERIES[type].name, empty: true, note: "暂无该彩种开奖数据，请先运行 npm run fetch 抓取。", fetchedAt: all.fetchedAt || null };
  }
  const window = draws.slice(-120);
  const prediction = buildPrediction(window, type);
  const targetIssue = nextIssueOf(draws);
  ensureSnapshot(type, targetIssue, draws[draws.length - 1].issue, prediction);
  const snapshots = loadSnapshots().snapshots
    .filter((s) => s.lottery === type)
    .sort((a, b) => b.targetIssue.localeCompare(a.targetIssue))
    .map((s) => {
      const actual = draws.find((d) => d.issue === s.targetIssue);
      return { ...s, review: actual ? reviewOne(revivePrediction(s.prediction), actual, type) : null };
    });
  return {
    type, name: LOTTERIES[type].name, empty: false,
    fetchedAt: all.fetchedAt || null,
    totalIssues: draws.length,
    latest: draws[draws.length - 1],
    recentDraws: draws.slice(-15).reverse(),
    stats: analyzeWindow(window, type),
    prediction: { ...prediction, directCombos: prediction.directCombos.map((c) => c.combo) },
    targetIssue,
    review: buildReview(draws, type),
    snapshots,
  };
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };
function sendJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (c) => { buf += c; if (buf.length > 2_000_000) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(buf || "{}")); } catch { resolve({}); } });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/api/lottery") {
      const type = url.searchParams.get("type") || "p3";
      if (!LOTTERIES[type]) return sendJson(res, 400, { error: "未知彩种" });
      return sendJson(res, 200, lotteryPayload(type));
    }
    if (url.pathname === "/api/plan" && req.method === "POST") {
      const body = await readBody(req);
      const type = LOTTERIES[body.type] ? body.type : "p3";
      const all = loadDraws();
      const draws = (all.draws && all.draws[type]) || [];
      if (!draws.length) return sendJson(res, 200, { error: "暂无开奖数据，无法交叉，请先 npm run fetch" });
      const prediction = buildPrediction(draws.slice(-120), type);
      const plan = parsePlanSheet(body.text || "", type);
      return sendJson(res, 200, { plan, cross: crossPlan(prediction, plan), disclaimer: "计划表仅作补充参考，不绝对正确。" });
    }
    if (url.pathname === "/api/refresh" && req.method === "POST") {
      const { draws, errors } = await fetchAll(2026);
      const total = Object.values(draws).reduce((a, v) => a + v.length, 0);
      if (total > 0) {
        mkdirSync(dataDir, { recursive: true });
        writeFileSync(drawsPath, JSON.stringify({ source: "新浪彩票走势图", fetchedAt: new Date().toISOString(), errors, draws }, null, 1), "utf8");
      }
      return sendJson(res, 200, { ok: total > 0, total, errors });
    }
    // 静态文件
    const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = join(root, "public", rel);
    if (!file.startsWith(join(root, "public")) || !existsSync(file)) { res.writeHead(404); return res.end("Not Found"); }
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  } catch (e) {
    sendJson(res, 500, { error: String(e && e.message ? e.message : e) });
  }
});

server.listen(PORT, () => console.log(`[server] http://localhost:${PORT}`));
