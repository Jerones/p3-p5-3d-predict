// 从新浪彩票走势图抓取开奖数据（期号 + 开奖号）。
// 页面结构：<tbody id="cpdata"> 中每行第一个 <td> 为期号；
// 直选形态奖号在 class="fen"/"bg3" 且长度等于位数的单元格中，
// 基本走势奖号则是每位一个 class="chartball*" 的球，按顺序拼接。
const SINA_BASE = "https://view.lottery.sina.com.cn/lotto/pc_zst/index";

export const FETCH_CONFIG = {
  p3: { lottoType: "p3", actionType: "jqzs", digits: 3, label: "排列三" },
  p5: { lottoType: "p5", actionType: "chzs", digits: 5, label: "排列五" },
  "3d": { lottoType: "3d", actionType: "jqzs", digits: 3, label: "福彩3D" },
};

export function parseDrawsFromHtml(html, digits) {
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = trRe.exec(html)) !== null) {
    const rowHtml = m[1];
    const issueMatch = rowHtml.match(/<td[^>]*>\s*(20\d{5})\s*<\/td>/);
    if (!issueMatch) continue;
    // 奖号单元格 class 在不同行分别为 fen / bg3（星期单元格也是 fen 但只有 1 位，会被长度过滤）
    const fenRe = /<td[^>]*class="(?:fen|bg3)"[^>]*>\s*(\d+)\s*<\/td>/g;
    let f;
    let draw = null;
    while ((f = fenRe.exec(rowHtml)) !== null) {
      if (f[1].length === digits) { draw = f[1]; break; }
    }
    if (!draw) {
      // 兜底一：基本走势（chzs，如排列五）没有合并奖号单元格，
      // 奖号是每位一个 chartball 球，按顺序拼接
      const balls = [...rowHtml.matchAll(/<td[^>]*class="chartball[^"]*"[^>]*>\s*(\d)\s*<\/td>/g)].map((x) => x[1]);
      if (balls.length === digits) draw = balls.join("");
    }
    if (!draw) {
      // 兜底二：按列位置取第 5 个单元格（期号、分隔、星期、分隔、奖号）
      const tds = [...rowHtml.matchAll(/<td[^>]*>\s*(\d*)\s*<\/td>/g)].map((x) => x[1]);
      if (tds[4] && tds[4].length === digits) draw = tds[4];
    }
    if (!draw) continue;
    rows.push({ issue: issueMatch[1], nums: draw.split("").map(Number) });
  }
  // 按期号去重并升序
  const seen = new Map();
  for (const r of rows) seen.set(r.issue, r);
  return [...seen.values()].sort((a, b) => a.issue.localeCompare(b.issue));
}

export async function fetchLottery(key, year = 2026) {
  const cfg = FETCH_CONFIG[key];
  const url = `${SINA_BASE}?lottoType=${cfg.lottoType}&actionType=${cfg.actionType}&year=${year}&dpc=1`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();
  return parseDrawsFromHtml(html, cfg.digits);
}

export async function fetchAll(year = 2026) {
  const out = {};
  const errors = {};
  for (const key of Object.keys(FETCH_CONFIG)) {
    try {
      out[key] = await fetchLottery(key, year);
    } catch (e) {
      out[key] = [];
      errors[key] = String(e && e.message ? e.message : e);
    }
  }
  return { draws: out, errors };
}
