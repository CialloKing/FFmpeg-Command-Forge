import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const channel = process.env.FORGE_BROWSER === 'chromium' ? undefined : 'msedge';
const browser = await chromium.launch({ channel, headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1536, height: 1000 }, acceptDownloads: true });
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
const key = 'ffmpeg-command-forge.workspace.v1';
const saved = () => page.evaluate(key => { const value = JSON.parse(localStorage.getItem(key)); return value?.workspace ?? value; }, key);
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
  assert.equal(await page.getByRole('button', { name: '复制探测命令', exact: true }).isDisabled(), true);
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
  await upload(page.locator('#import'), { 预设文件版本: 6, 流控制_自动混流SRT: true });
  await page.getByLabel('同名字幕清单', { exact: true }).fill('D:\\Media\\sample.srt');
  await page.reload();
  assert.equal(await page.getByLabel('同名字幕清单', { exact: true }).inputValue(), 'D:\\Media\\sample.srt');
  const preset = { 预设文件版本: 6, 视频参数_烧录字幕_主要颜色: { 已设置: true, R: 123 }, 视频参数_比特率_控制方式: 'crf', 元数据_要写入的信息: [null, { 字段: 'title', 值: 'kept' }] };
  for (const [value, label] of [[' cRf ', 'CRF'], ['1', 'CRF'], [3, 'VBR'], ['unknown', '未知：unknown']]) {
    await upload(page.locator('#import'), { ...preset, 视频参数_比特率_控制方式: value });
    await page.getByRole('button', { name: '质量', exact: true }).click();
    assert.equal(await page.getByLabel('比特率 / 控制方式', { exact: true }).inputValue(), label);
  }
  await upload(page.locator('#import'), preset);
  await page.getByRole('button', { name: '字幕', exact: true }).click();
  await page.locator('summary').filter({ hasText: '烧录字幕 / 主要颜色' }).click();
  assert.equal(await page.locator('details').filter({ has: page.locator('summary', { hasText: '烧录字幕 / 主要颜色' }) }).getByLabel('A', { exact: true }).inputValue(), '255');
  await page.getByRole('button', { name: '质量', exact: true }).click();
  assert.equal(await page.getByLabel('比特率 / 控制方式', { exact: true }).inputValue(), 'CRF');
  await page.getByRole('button', { name: '附加内容', exact: true }).click();
  await page.locator('summary').filter({ hasText: '元数据 / 要写入的信息' }).click();
  assert.equal(await page.getByLabel('值', { exact: true }).inputValue(), 'kept');
  assert.equal(await page.getByText('空项，不参与命令生成。', { exact: true }).isVisible(), true);
  assert.deepEqual((await saved()).preset, preset);
  await page.getByRole('button', { name: '任务与环境', exact: true }).click();
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = async function () {
      if (this.name === 'delayed.json') { window.readStarted = true; await new Promise(resolve => { window.releaseRead = resolve; }); }
      return original.call(this);
    };
  });
  await upload(page.getByRole('button', { name: '导入 ffprobe JSON', exact: true }), { format: { duration: '10' }, streams: [] }, 'delayed.json');
  await page.waitForFunction(() => window.readStarted);
  await page.getByLabel('输入文件 1 路径', { exact: true }).fill('D:\\Media\\changed.mp4');
  await page.evaluate(() => { document.querySelector('#toast').hidden = true; window.releaseRead(); });
  await page.getByText('导入期间数据已变更或已有更新的导入，请重新选择文件。', { exact: true }).waitFor();
  await page.getByText('已保存到浏览器', { exact: true }).waitFor();
  assert.equal((await saved()).context.inputs[0].probe, undefined);
  await upload(page.getByRole('button', { name: '导入 ffprobe JSON', exact: true }), { format: { duration: '20' }, streams: [] });
  await page.getByText(/已关联此路径.*20/).waitFor();
  for (const action of ['remove', 'workspace', 'newer']) {
    await page.getByText('已保存到浏览器', { exact: true }).waitFor();
    const snapshot = await saved();
    await page.evaluate(() => { window.readStarted = false; });
    await upload(page.getByRole('button', { name: '导入 ffprobe JSON', exact: true }), { format: { duration: '99' }, streams: [] }, 'delayed.json');
    await page.waitForFunction(() => window.readStarted);
    if (action === 'remove') { await page.getByRole('button', { name: '移除', exact: true }).click(); }
    if (action === 'workspace') {
      await page.getByRole('button', { name: '工作区', exact: true }).click();
      await upload(page.getByRole('button', { name: '导入工作区', exact: true }), snapshot);
      await page.getByText('工作区已恢复', { exact: true }).waitFor();
    }
    if (action === 'newer') {
      await upload(page.getByRole('button', { name: '导入 ffprobe JSON', exact: true }), { format: { duration: '30' }, streams: [] });
      await page.getByText(/已关联此路径.*30/).waitFor();
    }
    await page.evaluate(() => { document.querySelector('#toast').hidden = true; window.releaseRead(); });
    await page.getByText('导入期间数据已变更或已有更新的导入，请重新选择文件。', { exact: true }).waitFor();
    await page.getByText('已保存到浏览器', { exact: true }).waitFor();
    const tasks = (await saved()).context.inputs;
    assert.ok(tasks.every(task => task.probe?.data.format?.duration !== '99'));
    if (action === 'newer') { assert.equal(tasks[0].probe.data.format.duration, '30'); }
    if (action === 'remove') {
      await page.getByRole('button', { name: '+ 添加输入', exact: true }).click();
      await page.getByLabel('输入文件 1 路径', { exact: true }).fill('D:\\Media\\replacement.mp4');
    }
  }
  await page.getByRole('button', { name: '批量粘贴路径', exact: true }).click();
  await page.getByRole('textbox', { name: '每行一个输入文件路径' }).fill(Array.from({ length: 100 }, (_, i) => `D:\\Media\\batch-${i}.mp4`).join('\n'));
  await page.getByRole('button', { name: '应用', exact: true }).click();
  await page.getByText('命令已就绪', { exact: true }).waitFor();
  await page.getByText('已保存到浏览器', { exact: true }).waitFor();
  assert.equal(await page.locator('.input-task').count(), 50);
  const beforePaging = await saved();
  await page.evaluate(() => { window.planChanges = 0; new MutationObserver(() => window.planChanges++).observe(document.querySelector('#status-title'), { childList: true, subtree: true }); });
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  assert.equal(await page.getByLabel('输入文件 51 路径', { exact: true }).isVisible(), true);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  assert.equal(await page.locator('.input-task').count(), 1);
  assert.deepEqual(await saved(), beforePaging);
  assert.equal(await page.evaluate(() => window.planChanges), 0);
  const download = page.waitForEvent('download'); await page.locator('#download-script').click();
  const script = await readFile(await (await download).path(), 'utf8');
  assert.ok(script.includes('batch-0.mp4') && script.includes('batch-99.mp4'));
  await page.getByLabel('输入文件 101 路径', { exact: true }).fill('');
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await page.getByRole('button', { name: '输入 101：请填写输入文件的实际执行路径', exact: true }).click();
  assert.equal(await page.getByLabel('输入文件 101 路径', { exact: true }).evaluate(node => node === document.activeElement), true);
  await page.getByRole('button', { name: '移除', exact: true }).click();
  assert.equal(await page.getByLabel('任务页码', { exact: true }).inputValue(), '2');
  assert.equal(await page.locator('.input-task').count(), 50);
  await page.getByRole('button', { name: '+ 添加输入', exact: true }).click();
  assert.equal(await page.getByLabel('任务页码', { exact: true }).inputValue(), '3');
  assert.equal(await page.getByLabel('输入文件 101 路径', { exact: true }).inputValue(), '');
  await page.getByRole('button', { name: '移除', exact: true }).click();
  assert.equal(await page.locator('#undo').isEnabled(), true);
  await upload(page.locator('#import'), []);
  await page.getByText('预设必须是 JSON 对象', { exact: true }).waitFor();
  assert.equal(await page.locator('#undo').textContent(), '撤销：删除输入任务');
  await page.locator('#theme').click();
  await page.locator('#undo').click();
  assert.equal((await saved()).context.inputs.length, 101);
  assert.equal((await saved()).theme, 'light');
  assert.equal(await page.getByLabel('允许本批脚本覆盖已有输出', { exact: true }).isChecked(), false);
  assert.equal(await page.locator('#undo').isDisabled(), true);
  const beforeReset = await saved();
  await page.locator('#new').click();
  assert.equal(await page.getByLabel('输入文件 1 路径', { exact: true }).inputValue(), '');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('#undo').isVisible(), true);
  await page.getByRole('button', { name: '语言', exact: true }).click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  assert.equal(await page.locator('#undo').isEnabled(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await page.screenshot({ path: '.cache/round2-mobile-undo.png' });
  await page.locator('#undo').click();
  assert.deepEqual(await saved(), beforeReset);
  await page.setViewportSize({ width: 1536, height: 1000 });
  await page.locator('#new').click();
  await page.getByLabel('Input file 1 path', { exact: true }).fill('D:\\new.mp4');
  assert.equal(await page.locator('#undo').isDisabled(), true);
  await page.reload();
  assert.equal(await page.locator('#undo').isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log(`${channel ?? 'Chromium'} 第二轮编辑器回归通过`);
} finally { await browser.close(); }
