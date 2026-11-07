import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const channel = process.env.FORGE_BROWSER === 'chromium' ? undefined : 'msedge';
const browser = await chromium.launch({ channel, headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1536, height: 1000 }, acceptDownloads: true });
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
const key = 'ffmpeg-command-forge.workspace.v1';
const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
async function upload(button, value, name = 'preset.json') {
  const chooser = page.waitForEvent('filechooser');
  await button.click();
  await (await chooser).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
}
try {
  await context.route(/^https?:/, route => route.abort());
  await page.goto(pathToFileURL(path.resolve('FFmpeg Command Forge.html')).href);
  await page.getByLabel('输入文件 1 路径', { exact: true }).fill('D:\\Media\\sample.mp4');
  await page.getByRole('button', { name: '自定义参数', exact: true }).click();
  await page.getByLabel('自定义参数 / 之后参数', { exact: true }).fill('-metadata comment=latest');
  await page.reload();
  await page.getByRole('button', { name: '自定义参数', exact: true }).click();
  assert.equal(await page.getByLabel('自定义参数 / 之后参数', { exact: true }).inputValue(), '-metadata comment=latest');
  await page.getByRole('button', { name: '任务与环境', exact: true }).click();
  await page.getByLabel('显式路径映射', { exact: true }).fill('D:\\Media => D:\\Source');
  await page.getByText('命令已就绪', { exact: true }).waitFor();
  await page.getByLabel('显式路径映射', { exact: true }).fill('D:\\Media => D:\\New\nbroken');
  await page.getByText('草稿已保存，路径映射仍需修正', { exact: true }).waitFor();
  for (const id of ['copy-preview', 'copy-final', 'download-script', 'download-zip']) { assert.equal(await page.locator('#' + id).isDisabled(), true); }
  const draft = await saved();
  assert.equal(draft.version, 2);
  assert.equal(draft.context.pathMappings[0].to, 'D:\\Source');
  await page.reload();
  assert.equal(await page.getByLabel('显式路径映射', { exact: true }).inputValue(), draft.drafts.pathMappings);
  await page.getByRole('button', { name: '工作区', exact: true }).click();
  await upload(page.getByRole('button', { name: '导入工作区', exact: true }), draft);
  await page.getByText('工作区已恢复', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('显式路径映射', { exact: true }).inputValue(), draft.drafts.pathMappings);
  await page.getByLabel('显式路径映射', { exact: true }).fill('');
  await page.getByText('命令已就绪', { exact: true }).waitFor();
  assert.equal(await page.locator('#copy-final').isDisabled(), false);
  assert.deepEqual(errors, []);
  console.log(`${channel ?? 'Chromium'} 第二轮编辑器回归通过`);
} finally { await browser.close(); }
