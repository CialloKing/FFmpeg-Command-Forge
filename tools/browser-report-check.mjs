import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: process.env.FORGE_BROWSER === 'chromium' ? undefined : 'msedge', headless: true });
try {
  const context = await browser.newContext({ locale: 'zh-CN', acceptDownloads: true });
  await context.route(/^https?:/, route => route.abort());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve('FFmpeg Command Forge.html')).href);
  async function upload(button, value) {
    const chooser = page.waitForEvent('filechooser'); await button.click();
    await (await chooser).setFiles({ name: 'report.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  }
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('ffmpeg-command-forge.workspace.v1')).workspace);
  await upload(page.locator('#import'), { 预设文件版本: 6, 视频参数_编码器_具体编码: 'libx264', unknownExtension: null });
  await page.getByText('已导入：report.json', { exact: true }).waitFor();
  await page.getByLabel('输入文件 1 路径', { exact: true }).fill('D:\\Media\\sample.mp4');
  await page.getByRole('button', { name: '输出', exact: true }).click();
  await page.getByRole('combobox', { name: '输出容器', exact: true }).fill('webm');
  await page.getByRole('option', { name: 'webm', exact: true }).click();
  await page.getByRole('combobox', { name: '参数视图', exact: true }).fill('相对载入');
  await page.getByRole('option', { name: '相对载入预设的修改', exact: true }).click();
  await page.getByRole('combobox', { name: '输出容器', exact: true }).waitFor();
  const container = page.locator('.field').filter({ has: page.getByRole('combobox', { name: '输出容器', exact: true }) }).first();
  await container.getByRole('button', { name: '恢复载入值', exact: true }).click();
  const download = page.waitForEvent('download'); await page.locator('#export').click();
  const preset = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  assert.equal(Object.hasOwn(preset, '输出容器'), false); assert.equal(preset.unknownExtension, null);
  await page.getByRole('button', { name: '预设库', exact: true }).click();
  const before = await saved();
  await page.getByRole('button', { name: '查看变更', exact: true }).first().click();
  await page.getByRole('dialog', { name: '预设变更摘要', exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  assert.deepEqual((await saved()).preset, before.preset);
  await page.getByRole('button', { name: '任务与环境', exact: true }).click();
  await page.getByText('已保存到浏览器', { exact: true }).waitFor();
  const workspace = await saved(), task = workspace.context.inputs[0];
  const report = { format: 'ffmpeg-command-forge/probes', version: 1, platform: 'windows', executable: 'ffprobe', capturedAt: new Date().toISOString(), results: [
    { key: task.id, taskId: task.id, path: task.path, resolvedPath: task.path, exitCode: 0, stdoutBase64: Buffer.from(JSON.stringify({ format: { duration: '42' }, streams: [] })).toString('base64'), stderrBase64: '' }
  ] };
  await upload(page.getByRole('button', { name: '导入批量探测结果', exact: true }), report);
  await page.getByText('探测结果：成功 1 项，失败 0 项，过期或不匹配 0 项', { exact: true }).waitFor();
  await page.getByText(/已关联此路径.*42/).waitFor();
  const script = page.waitForEvent('download'); await page.getByRole('button', { name: '下载批量探测脚本', exact: true }).click();
  assert.equal((await script).suggestedFilename(), 'forge-probe.ps1');
  const environment = { ...report, format: 'ffmpeg-command-forge/environment', executable: 'ffmpeg', results: ['version', 'encoders', 'filters', 'hwaccels'].map(key => ({ key, exitCode: 0, stdoutBase64: '', stderrBase64: '' })) };
  await upload(page.getByRole('button', { name: '导入环境报告', exact: true }), environment);
  await page.getByText('命令已就绪', { exact: true }).waitFor();
  await page.getByText(/环境报告未列出所需编码器：libx264/).waitFor();
  assert.equal(await page.locator('#download-script').isDisabled(), false);
  await page.reload(); await page.getByRole('button', { name: '移除环境报告', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  await context.close();
  console.log('参数差异与恢复、预设摘要、批量报告及环境提示浏览器验收通过');
} finally { await browser.close(); }
