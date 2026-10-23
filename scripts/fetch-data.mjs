#!/usr/bin/env node
// 抓取新浪彩票走势图开奖数据，写入 data/draws.json
// 用法：npm run fetch
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAll } from "../lib/fetch-sina.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "data", "draws.json");

const { draws, errors } = await fetchAll(2026);
let total = 0;
for (const [k, v] of Object.entries(draws)) {
  total += v.length;
  console.log(`[fetch] ${k}: ${v.length} 期${errors[k] ? `（错误：${errors[k]}）` : ""}`);
}
const payload = {
  source: "新浪彩票走势图 https://view.lottery.sina.com.cn/lotto/pc_zst/index (lottoType=p3/p5/3d)",
  fetchedAt: new Date().toISOString(),
  note: total === 0
    ? "本次抓取未取得任何数据（网络或页面结构变化），draws 为空，运行服务时页面会明确提示暂无数据；请稍后重试 npm run fetch。"
    : `本次实际抓到共 ${total} 期（三彩种合计），各彩种期数见运行日志与文件内容。`,
  errors,
  draws,
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(payload, null, 1), "utf8");
console.log(`[fetch] 已写入 ${outPath}，合计 ${total} 期`);
