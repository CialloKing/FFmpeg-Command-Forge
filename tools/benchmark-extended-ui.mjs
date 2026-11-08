// 同机交替比较两遍编码、大模板与 ZIP；计时覆盖完整就绪/下载，不把工作移出计时窗口。
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const templateOnly = process.argv.includes('--template-only');
const files = process.argv.slice(2).filter(value => value !== '--template-only');
if (files.length !== 2) { throw new Error('Provide before.html and after.html'); }
const browser = await chromium.launch({ channel: 'msedge', headless: true });
async function sample(file, profile, count) {
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1536, height: 1000 }, acceptDownloads: true });
  try {
    await context.route(/^https?:/, route => route.abort());
    const page = await context.newPage(); await page.goto(pathToFileURL(path.resolve(file)).href);
    const template = profile === 'template';
    const workspace = {
      format: 'ffmpeg-command-forge/workspace', version: 2, theme: 'dark', drafts: { pathMappings: '' },
      preset: { 预设文件版本: 6, 输出容器: 'mkv', 视频参数_编码器_具体编码: 'libx264',
        ...(template ? { 视频参数_视频帧服务器_使用AviSynth: true, 视频参数_视频帧服务器_avs脚本文件: 'template.avs' } : { 视频参数_比特率_控制方式: 'TPE', 视频参数_比特率_基础: '200k' }) },
      context: { platform: 'windows', shell: 'powershell', ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', cwd: '', outputDirectory: '',
        clock: '2026.11.08-00.00.00', nonce: 'benchmark', inputs: [{ id: 'seed', path: '' }], pathMappings: [], confirmedPaths: [],
        resources: template ? { 'template.avs': '# ' + 'x'.repeat(1024 * 1024) + '\nDirectShowSource("<FilePath>")\n' } : {} }
    };
    await page.getByRole('button', { name: '工作区', exact: true }).click();
    const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '导入工作区', exact: true }).click();
    await (await chooser).setFiles({ name: 'benchmark.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(workspace)) });
    await page.getByText('工作区已恢复', { exact: true }).waitFor();
    await page.getByRole('button', { name: '批量粘贴路径', exact: true }).click();
    await page.getByRole('textbox', { name: '每行一个输入文件路径' }).fill(Array.from({ length: count }, (_, i) => `D:\\Media\\clip-${i}.mp4`).join('\n'));
    const ready = await page.evaluate(async () => {
      const durations = [], observer = new PerformanceObserver(list => durations.push(...list.getEntries().map(entry => entry.duration)));
      observer.observe({ type: 'longtask' }); const start = performance.now();
      const ready = new Promise(resolve => {
        const changes = new MutationObserver(() => { if (document.querySelector('#status-title').textContent === '命令已就绪') {
          changes.disconnect(); requestAnimationFrame(() => requestAnimationFrame(resolve));
        } });
        changes.observe(document.querySelector('#status-title'), { childList: true, subtree: true });
      });
      [...document.querySelectorAll('#dialog-body button')].find(button => button.textContent === '应用').click();
      await ready; durations.push(...observer.takeRecords().map(entry => entry.duration)); observer.disconnect();
      return { readyMs: performance.now() - start, longestTaskMs: Math.max(0, ...durations) };
    });
    if (!template) { return ready; }
    await page.getByText('已保存到浏览器', { exact: true }).waitFor();
    await page.evaluate(() => {
      window.zipTasks = []; window.zipObserver = new PerformanceObserver(list => window.zipTasks.push(...list.getEntries().map(entry => entry.duration)));
      window.zipObserver.observe({ type: 'longtask' }); window.zipStarted = performance.now();
    });
    const download = page.waitForEvent('download'); await page.locator('#download-zip').click(); await (await download).path();
    return { ...ready, ...await page.evaluate(() => {
      window.zipTasks.push(...window.zipObserver.takeRecords().map(entry => entry.duration)); window.zipObserver.disconnect();
      return { zipMs: performance.now() - window.zipStarted, zipLongestTaskMs: Math.max(0, ...window.zipTasks) };
    }) };
  } finally { await context.close(); }
}
try {
  for (const [profile, count] of templateOnly ? [['template', 20]] : [['two-pass', 100], ['two-pass', 2000], ['template', 20]]) {
    const samples = new Map(files.map(file => [file, []]));
    for (let round = 0; round < 5; round++) {
      for (const file of round % 2 ? [...files].reverse() : files) { samples.get(file).push(await sample(file, profile, count)); }
    }
    for (const [file, runs] of samples) {
      const medians = Object.fromEntries(Object.keys(runs[0]).map(key => [key, Number(runs.map(run => run[key]).sort((a, b) => a - b)[2].toFixed(2))]));
      console.log(JSON.stringify({ file, profile, count, ...medians, runs }));
    }
  }
} finally { await browser.close(); }
