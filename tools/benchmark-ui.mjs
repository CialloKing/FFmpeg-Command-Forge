// 每个样本使用独立浏览器上下文；交替测量旧版和新版，避免缓存及顺序偏差。
// node tools/benchmark-ui.mjs .cache/round2-before.html "FFmpeg Command Forge.html"
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const files = process.argv.slice(2);
if (!files.length) { files.push('FFmpeg Command Forge.html'); }
const browser = await chromium.launch({ channel: 'msedge', headless: true });
async function sample(file, count) {
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1536, height: 1000 } });
  try {
    const page = await context.newPage();
    await context.route(/^https?:/, route => route.abort());
    await page.goto(pathToFileURL(path.resolve(file)).href);
    await page.getByRole('button', { name: '批量粘贴路径', exact: true }).click();
    await page.getByRole('textbox', { name: '每行一个输入文件路径' }).fill(Array.from({ length: count }, (_, i) => `D:\\Media\\clip-${i}.mp4`).join('\n'));
    return await page.evaluate(async () => {
      const durations = [], observer = new PerformanceObserver(list => durations.push(...list.getEntries().map(entry => entry.duration)));
      observer.observe({ type: 'longtask' });
      const start = performance.now();
      const ready = new Promise(resolve => {
        const changes = new MutationObserver(() => {
          if (document.querySelector('#status-title').textContent !== '命令已就绪') { return; }
          changes.disconnect(); requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
        changes.observe(document.querySelector('#status-title'), { childList: true, subtree: true });
      });
      [...document.querySelectorAll('#dialog-body button')].find(button => button.textContent === '应用').click();
      const applyMs = performance.now() - start;
      await ready;
      durations.push(...observer.takeRecords().map(entry => entry.duration)); observer.disconnect();
      return { applyMs, readyMs: performance.now() - start, longestTaskMs: Math.max(0, ...durations), nodes: document.querySelectorAll('*').length, cards: document.querySelectorAll('.input-task').length };
    });
  } finally { await context.close(); }
}
try {
  for (const file of files) { await sample(file, 100); }
  for (const count of [100, 500, 1000, 2000]) {
    const samples = new Map(files.map(file => [file, []]));
    for (let round = 0; round < 5; round++) {
      for (const file of round % 2 ? [...files].reverse() : files) { samples.get(file).push(await sample(file, count)); }
    }
    for (const [file, runs] of samples) {
      const medians = Object.fromEntries(Object.keys(runs[0]).map(key => [key, Number(runs.map(run => run[key]).sort((a, b) => a - b)[2].toFixed(2))]));
      console.log(JSON.stringify({ file, count, ...medians, runs }));
    }
  }
} finally { await browser.close(); }
