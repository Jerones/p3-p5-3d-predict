// 分析 / 预测 / 复盘 / 计划表交叉 —— 纯函数，无外部依赖。
export const LOTTERIES = {
  p3: { name: "排列三", digits: 3, danmaCount: 3, killCount: 3, directCount: 8, poolSize: 6, posNames: ["百位", "十位", "个位"] },
  "3d": { name: "福彩3D", digits: 3, danmaCount: 3, killCount: 3, directCount: 8, poolSize: 6, posNames: ["百位", "十位", "个位"] },
  p5: { name: "排列五", digits: 5, danmaCount: 4, killCount: 3, directCount: 12, poolSize: 8, posNames: ["万位", "千位", "百位", "十位", "个位"] },
};

const sum = (a) => a.reduce((x, y) => x + y, 0);
const span = (a) => Math.max(...a) - Math.min(...a);

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor((p / 100) * sortedAsc.length)));
  return sortedAsc[idx];
}

// ---------- 基础统计（窗口内） ----------
export function analyzeWindow(draws, type) {
  const cfg = LOTTERIES[type];
  const D = cfg.digits;
  const freq = Array(10).fill(0);
  const posFreq = Array.from({ length: D }, () => Array(10).fill(0));
  for (const d of draws) {
    const seen = new Set(d.nums);
    for (const n of seen) freq[n] += 1; // 出现期次口径（同一期重复数字只计 1 次热度）
    d.nums.forEach((n, i) => { posFreq[i][n] += 1; });
  }
  // 当前遗漏：距最近一次出现（任意位置）相隔的期数
  const omission = Array(10).fill(draws.length);
  for (let i = draws.length - 1, gap = 0; i >= 0; i--, gap++) {
    for (const n of new Set(draws[i].nums)) if (omission[n] === draws.length) omission[n] = gap;
  }
  const sumDist = {};
  const spanDist = {};
  const oddEven = {};
  const bigSmall = {};
  const roadDist = Array.from({ length: D }, () => [0, 0, 0]); // 每位 012 路
  const formDist = { zu6: 0, zu3: 0, baozi: 0, other: 0 };
  for (const d of draws) {
    const s = sum(d.nums), sp = span(d.nums);
    sumDist[s] = (sumDist[s] || 0) + 1;
    spanDist[sp] = (spanDist[sp] || 0) + 1;
    const odd = d.nums.filter((n) => n % 2 === 1).length;
    oddEven[`${odd}:${D - odd}`] = (oddEven[`${odd}:${D - odd}`] || 0) + 1;
    const big = d.nums.filter((n) => n >= 5).length;
    bigSmall[`${big}:${D - big}`] = (bigSmall[`${big}:${D - big}`] || 0) + 1;
    d.nums.forEach((n, i) => { roadDist[i][n % 3] += 1; });
    if (D === 3) {
      const uniq = new Set(d.nums).size;
      if (uniq === 3) formDist.zu6 += 1;
      else if (uniq === 2) formDist.zu3 += 1;
      else formDist.baozi += 1;
    } else {
      formDist[`distinct${new Set(d.nums).size}`] = (formDist[`distinct${new Set(d.nums).size}`] || 0) + 1;
    }
  }
  const byFreq = [...Array(10).keys()].sort((a, b) => freq[b] - freq[a]);
  return {
    windowSize: draws.length,
    freq, posFreq, omission, sumDist, spanDist, oddEven, bigSmall, roadDist, formDist,
    hot: byFreq.slice(0, 5),
    cold: byFreq.slice(-5).reverse(),
  };
}

// ---------- 预测 ----------
export function buildPrediction(windowDraws, type) {
  const cfg = LOTTERIES[type];
  const D = cfg.digits;
  const stats = analyzeWindow(windowDraws, type);
  // 单数字综合评分：整体热度 + 遗漏回补（温和） 
  const score = (d) => stats.freq[d] * 1.0 + stats.omission[d] * 0.35;
  const ranked = [...Array(10).keys()].sort((a, b) => score(b) - score(a) || a - b);
  const danma = ranked.slice(0, cfg.danmaCount);
  const kills = ranked.slice(-cfg.killCount).reverse();
  const groupPool = ranked.slice(0, cfg.poolSize);
  // 每位候选：该位热度 + 整体评分
  const posPicks = [];
  const posTop = [];
  for (let i = 0; i < D; i++) {
    const pr = [...Array(10).keys()].sort(
      (a, b) => (stats.posFreq[i][b] * 1.2 + score(b)) - (stats.posFreq[i][a] * 1.2 + score(a)) || a - b
    );
    posPicks.push(pr.slice(0, D === 5 ? 3 : 4));
    posTop.push(pr.slice(0, 3));
  }
  // 和值 / 跨度推荐区间（窗口分位数）
  const sums = windowDraws.map((d) => sum(d.nums)).sort((a, b) => a - b);
  const spans = windowDraws.map((d) => span(d.nums)).sort((a, b) => a - b);
  const sumRange = { low: percentile(sums, 25), high: percentile(sums, 75) };
  const spanRange = { low: percentile(spans, 25), high: percentile(spans, 80) };
  // 直选精选：每位前 3 的笛卡尔积，区间内优先，再按位置评分排序
  let combos = [[]];
  for (let i = 0; i < D; i++) {
    const next = [];
    for (const c of combos) for (const n of posTop[i]) next.push([...c, n]);
    combos = next;
  }
  const comboScore = (c) =>
    c.reduce((acc, n, i) => acc + stats.posFreq[i][n] * 1.2 + score(n), 0);
  const scored = combos.map((c) => {
    const s = sum(c), sp = span(c);
    const inRange = s >= sumRange.low && s <= sumRange.high && sp >= spanRange.low && sp <= spanRange.high;
    return { combo: c.join(""), nums: c, inRange, score: Math.round(comboScore(c) * 100) / 100 };
  });
  scored.sort((a, b) => (b.inRange - a.inRange) || (b.score - a.score) || a.combo.localeCompare(b.combo));
  const directCombos = scored.slice(0, cfg.directCount);
  return {
    danma, kills, groupPool, posPicks, directCombos,
    sumRange, spanRange,
    basedOn: windowDraws.length ? windowDraws[windowDraws.length - 1].issue : null,
  };
}

export function nextIssueOf(draws) {
  if (!draws.length) return null;
  return String(Number(draws[draws.length - 1].issue) + 1);
}

// ---------- 直选逐注比对 ----------
export function directDetail(comboNums, actualNums) {
  let posMatches = 0;
  for (let i = 0; i < actualNums.length; i++) if (comboNums[i] === actualNums[i]) posMatches += 1;
  // 数对：不看位置，按数字多重集 min 交集计数
  let digitMatches = 0;
  for (let d = 0; d <= 9; d++) {
    digitMatches += Math.min(
      comboNums.filter((n) => n === d).length,
      actualNums.filter((n) => n === d).length
    );
  }
  const full = actualNums.length;
  const kind = posMatches === full ? "exact" : digitMatches === full ? "digitFullWrongOrder" : "closest";
  return { posMatches, digitMatches, kind };
}

export function computeDirectDetails(prediction, actualNums) {
  const details = prediction.directCombos.map((c) => {
    const nums = typeof c === "string" ? c.split("").map(Number) : c.nums;
    const combo = typeof c === "string" ? c : c.combo;
    return { combo, ...directDetail(nums, actualNums) };
  });
  const best = [...details].sort(
    (a, b) => (b.posMatches - a.posMatches) || (b.digitMatches - a.digitMatches) || a.combo.localeCompare(b.combo)
  )[0] || null;
  return { details, best, directHit: details.some((d) => d.kind === "exact") };
}

// ---------- 单期复盘 ----------
export function reviewOne(prediction, target, type) {
  const cfg = LOTTERIES[type];
  const drawnSet = new Set(target.nums);
  const danmaDetails = prediction.danma.map((d) => ({ digit: d, hit: drawnSet.has(d) }));
  const posDetails = prediction.posPicks.map((picks, i) => ({
    name: cfg.posNames[i], picks, actual: target.nums[i], hit: picks.includes(target.nums[i]),
  }));
  const killDetails = prediction.kills.map((d) => ({ digit: d, correct: !drawnSet.has(d) }));
  const s = sum(target.nums), sp = span(target.nums);
  const direct = computeDirectDetails(prediction, target.nums);
  return {
    issue: target.issue,
    nums: target.nums,
    danmaDetails,
    danmaHits: danmaDetails.filter((x) => x.hit).length,
    danmaTotal: danmaDetails.length,
    posDetails,
    posHits: posDetails.filter((x) => x.hit).length,
    killDetails,
    killOk: killDetails.every((x) => x.correct),
    sumDetail: { ...prediction.sumRange, actual: s, inRange: s >= prediction.sumRange.low && s <= prediction.sumRange.high },
    spanDetail: { ...prediction.spanRange, actual: sp, inRange: sp >= prediction.spanRange.low && sp <= prediction.spanRange.high },
    directHit: direct.directHit,
    directDetails: direct.details,
    bestCombo: direct.best,
  };
}

// ---------- 近 10 期回测复盘 ----------
export function buildReview(allDraws, type, count = 10, windowSize = 120) {
  const details = [];
  const start = Math.max(windowSize, allDraws.length - count);
  for (let idx = start; idx < allDraws.length; idx++) {
    const window = allDraws.slice(idx - windowSize, idx);
    const pred = buildPrediction(window, type);
    details.push(reviewOne(pred, allDraws[idx], type));
  }
  const n = details.length || 1;
  const summary = {
    issues: details.length,
    danmaAvgHits: round2(details.reduce((a, d) => a + d.danmaHits, 0) / n),
    killAccuracy: pct(details.reduce((a, d) => a + d.killDetails.filter((k) => k.correct).length, 0),
                       details.reduce((a, d) => a + d.killDetails.length, 0)),
    posAvgHits: round2(details.reduce((a, d) => a + d.posHits, 0) / n),
    sumRangeAccuracy: pct(details.filter((d) => d.sumDetail.inRange).length, details.length),
    directAccuracy: pct(details.filter((d) => d.directHit).length, details.length),
    directHitCount: details.filter((d) => d.directHit).length,
    directDigitFullWrongOrderCount: details.filter((d) => d.bestCombo && d.bestCombo.kind === "digitFullWrongOrder").length,
    directBestAvgPos: round2(details.reduce((a, d) => a + (d.bestCombo ? d.bestCombo.posMatches : 0), 0) / n),
    directBestAvgDigit: round2(details.reduce((a, d) => a + (d.bestCombo ? d.bestCombo.digitMatches : 0), 0) / n),
  };
  return { summary, details };
}

const round2 = (x) => Math.round(x * 100) / 100;
const pct = (hit, total) => (total ? Math.round((hit / total) * 1000) / 10 : 0);

// ---------- 计划表解析与交叉（仅参考，不绝对正确） ----------
export function parsePlanSheet(text, type) {
  const cfg = LOTTERIES[type];
  const D = cfg.digits;
  const kills = new Set();
  const danma = new Set();
  const combos = [];
  const comboRe = new RegExp(`(?<!\\d)\\d{${D}}(?!\\d)`, "g");
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const isKillLine = /杀/.test(line);
    const isDanLine = /胆/.test(line);
    if (isKillLine) {
      for (const ch of line.replace(/[^0-9]/g, "")) kills.add(Number(ch));
      continue; // 杀号行数字不计入推荐
    }
    if (isDanLine) for (const ch of line.replace(/[^0-9]/g, "")) danma.add(Number(ch));
    const found = line.match(comboRe) || [];
    for (const c of found) if (!combos.includes(c)) combos.push(c);
    if (!isDanLine && !found.length && /推荐|定位|组选/.test(line)) {
      for (const ch of line.replace(/[^0-9]/g, "")) danma.add(Number(ch));
    }
  }
  const comboDigits = new Set();
  combos.forEach((c) => c.split("").forEach((ch) => comboDigits.add(Number(ch))));
  return {
    kills: [...kills].sort((a, b) => a - b),
    danma: [...danma].sort((a, b) => a - b),
    combos,
    digits: [...new Set([...danma, ...comboDigits])].sort((a, b) => a - b),
  };
}

export function crossPlan(prediction, plan) {
  const modelKill = new Set(prediction.kills);
  const planKill = new Set(plan.kills);
  const pool = new Set(prediction.groupPool);
  const consensusDanma = plan.danma.filter((d) => prediction.danma.includes(d) || pool.has(d));
  const crossCombos = [];
  const riskCombos = [];
  for (const c of plan.combos) {
    const nums = c.split("").map(Number);
    const hitsKill = nums.some((n) => modelKill.has(n) || planKill.has(n));
    if (hitsKill) riskCombos.push({ combo: c, reason: "含主模型杀号或计划表自身杀号" });
    else if (nums.every((n) => pool.has(n))) crossCombos.push({ combo: c, reason: "数字全在主模型组选池内" });
    else riskCombos.push({ combo: c, reason: "有数字不在主模型组选池内，仅供参考" });
  }
  return {
    consensusDanma,
    crossCombos,
    riskCombos,
    note: "计划表仅作补充参考，不绝对正确；交叉结果不替代主模型预测。",
  };
}
