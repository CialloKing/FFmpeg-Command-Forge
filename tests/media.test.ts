import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildPlan, defaultContext } from '../src/plan';
import { importPreset } from '../src/preset';
import { translator } from '../src/i18n';
import { renderPlan } from '../src/render';
import type { CommandPlan, Shell } from '../src/types';
import { pwsh } from './runtime';

function run(exe: string, args: string[]) {
  const r = spawnSync(exe, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 2e6, env: { ...process.env, FCF_TEST_VAR: 'MUST_NOT_EXPAND' } });
  assert.equal(r.status, 0, (r.error?.message || '') + '\n' + r.stderr); return r.stdout;
}
function execute(plan: CommandPlan, dir: string, expectedFailure = false): void {
  const t = translator('en');
  const r = renderPlan(plan, t); assert.equal(plan.status, 'ready', JSON.stringify(plan.issues)); assert.deepEqual(r.issues, []);
  const file = path.join(dir, r.download.name); writeFileSync(file, r.download.content);
  const cmd = r.download.name.endsWith('.cmd');
  const exe = cmd ? 'cmd.exe' : plan.context.shell === 'powershell5' ? 'powershell.exe' : pwsh;
  const args = cmd ? ['/d', '/v:off', '/c', file] : ['-NoProfile', '-File', file];
  if (expectedFailure) {
    const result = spawnSync(exe, args, { encoding: 'utf8', timeout: 30000 });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /batch/);
  } else { run(exe, args); }
}
test('实际媒体验证三类 Windows 脚本、两遍编码、命名及文件时间', { skip: process.platform !== 'win32' }, async () => {
  mkdirSync('.cache', { recursive: true }); const dir = mkdtempSync(path.resolve('.cache/media-')), input = path.join(dir, 'input 中文 & ! %.mkv');
  run('ffmpeg', ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '2', '-c:v', 'libx264', '-c:a', 'aac', input]);
  utimesSync(input, new Date('2025-01-02T03:04:05Z'), new Date('2025-01-02T03:04:05Z'));
  const title = '中文 "标题" %FCF_TEST_VAR% !FCF_TEST_VAR! & more';
  for (const shell of ['powershell', 'powershell5', 'cmd'] as Shell[]) {
    const output = path.join(dir, shell, 'relative.mkv'), c = defaultContext(); c.shell = shell; c.cwd = dir;
    c.inputs = [{ id: shell, path: path.basename(input), output: path.join(shell, 'relative.mkv') }];
    const doc = importPreset({ 输出容器: 'mkv', 输出_自动命名选项: 0, 视频参数_编码器_具体编码: 'libx264', 视频参数_编码器_编码预设: 'ultrafast', 视频参数_分辨率: '128x72', 视频参数_比特率_控制方式: shell === 'powershell5' ? 'TPE' : 'CRF', 视频参数_质量控制_值: '25', 视频参数_比特率_基础: shell === 'powershell5' ? '250k' : '', 音频参数_编码器_代号: 'aac.native', 音频参数_比特率: '64k', 元数据_要写入的信息: [{ 字段: 'title', 值: title }], 输出命名_保留修改时间: true });
    execute(await buildPlan(doc, c), dir);
    const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', output]));
    assert.equal(probe.streams.find((s: any) => s.codec_type === 'video').width, 128); assert.equal(probe.streams.find((s: any) => s.codec_type === 'audio').codec_name, 'aac'); assert.equal(probe.format.tags.title, title); assert.equal(statSync(output).mtimeMs, statSync(input).mtimeMs);
  }
  const c = defaultContext(); c.outputDirectory = dir; c.inputs = [{ id: 'name', path: input }];
  const candidate = path.join(dir, path.parse(input).name + '~1.mkv');
  const doc = importPreset({ 输出容器: 'mkv', 输出_自动命名选项: '附加_递增数字', 视频参数_编码器_具体编码: 'copy', 音频参数_编码器_代号: 'audio.copy', 元数据_要写入的信息: [{ 字段: 'title', 值: candidate }, { 字段: 'comment', 值: '<OutputFile>' }] });
  const plan = await buildPlan(doc, c);
  writeFileSync(plan.tasks[0].output, 'existing'); execute(plan, dir);
  const renamed = candidate.replace('~1.mkv', '~2.mkv');
  assert.equal(readFileSync(candidate, 'utf8'), 'existing');
  const renamedProbe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', renamed]));
  assert.equal(renamedProbe.format.tags.title, candidate);
  assert.equal(renamedProbe.format.tags.COMMENT ?? renamedProbe.format.tags.comment, renamed);
  c.shell = 'powershell5';
  const serialPlan = await buildPlan(importPreset({ ...doc.raw, 输出_自动命名选项: '附加_2位结尾序号', 输出命名_替代文本: 'clip20261106192344998' }), c);
  const occupied = path.join(dir, 'clip20261106192344999.mkv');
  assert.equal(serialPlan.tasks[0].output, occupied);
  writeFileSync(occupied, 'existing'); execute(serialPlan, dir);
  assert.equal(readFileSync(occupied, 'utf8'), 'existing'); assert.ok(statSync(path.join(dir, 'clip20261106192345000.mkv')).size > 100);
  const srt = path.join(dir, "字幕 author's sample,[1].srt"), chapters = path.join(dir, 'chapters.txt'), font = path.join(dir, 'font.ttf');
  writeFileSync(srt, '1\n00:00:00,000 --> 00:00:01,500\nHello subtitle\n');
  writeFileSync(chapters, ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1500\ntitle=First chapter\n'); writeFileSync(font, 'attachment bytes');
  const extraContext = defaultContext(); extraContext.inputs = [{ id: 'extras', path: input, output: path.join(dir, 'extras.mkv'), sidecars: [srt], sidecarsConfirmed: true }]; extraContext.confirmedPaths = [chapters, font];
  const extras = await buildPlan(importPreset({ 视频参数_编码器_具体编码: 'copy', 音频参数_编码器_代号: 'audio.copy', 流控制_自动混流SRT: true, 章节_来源: '文本文档', 章节_文件路径: chapters, 附件_要写入的附件: [{ 类型: '字体文件', 文件路径: font }] }), extraContext);
  execute(extras, dir); const extraProbe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_chapters', '-of', 'json', extras.tasks[0].output])); assert.ok(extraProbe.streams.some((s: any) => s.codec_type === 'subtitle')); assert.ok(extraProbe.streams.some((s: any) => s.codec_type === 'attachment')); assert.equal(extraProbe.chapters[0].tags.title, 'First chapter');
  const burnContext = defaultContext(); burnContext.inputs = [{ id: 'burn', path: input, output: path.join(dir, 'burned.mkv'), subtitle: srt }];
  const fonts = path.join(dir, "author's fonts");
  mkdirSync(fonts); burnContext.confirmedPaths = [fonts];
  const burned = await buildPlan(importPreset({ 视频参数_编码器_具体编码: 'libx264', 视频参数_编码器_编码预设: 'ultrafast', 音频参数_编码器_代号: 'audio.copy', 视频参数_烧录字幕_滤镜选择: 'subtitles', 视频参数_烧录字幕_字幕来源是外部文件: '外部字幕文件', 视频参数_烧录字幕_字体文件夹: fonts, 视频参数_烧录字幕_基本样式_名称: "Author's font" }), burnContext);
  execute(burned, dir); assert.ok(statSync(burned.tasks[0].output).size > 100);
});

test('CMD 长批次通过任务包启动并保留调用目录', { skip: process.platform !== 'win32' }, async () => {
  mkdirSync('.cache', { recursive: true });
  const dir = mkdtempSync(path.resolve('.cache/cmd-batch-'));
  const bundle = path.join(dir, '任务包 & %');
  mkdirSync(bundle);
  run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=64x64:d=0.2', '-c:v', 'libx264', path.join(dir, 'source.mkv')]);
  const c = defaultContext(); c.shell = 'cmd';
  c.inputs = Array.from({ length: 6 }, (_, i) => ({ id: String(i), path: 'source.mkv', output: `render/out-${i}.mkv` }));
  const plan = await buildPlan(importPreset({ 视频参数_编码器_具体编码: 'copy' }), c);
  const rendered = renderPlan(plan);
  assert.equal(plan.status, 'ready');
  assert.equal(rendered.copyable, false);
  assert.equal(rendered.download.name, 'forge-task.ps1');
  for (const { name, content } of rendered.bundleScripts) { writeFileSync(path.join(bundle, name), content); }
  const args = ['/d', '/v:off', '/s', '/c', '""' + path.join(bundle, 'forge-task.cmd') + '""'];
  const r = spawnSync('cmd.exe', args, { cwd: dir, encoding: 'utf8', timeout: 15000, windowsVerbatimArguments: true });
  assert.equal(r.status, 0, r.error?.message || r.stderr);
  assert.ok(statSync(path.join(dir, 'render/out-5.mkv')).size > 100);
  assert.equal(existsSync(path.join(bundle, 'render')), false);
  const conflict = spawnSync('cmd.exe', args, { cwd: dir, encoding: 'utf8', timeout: 15000, windowsVerbatimArguments: true });
  assert.notEqual(conflict.status, 0);
});

test('转码前检查整批输出，覆盖授权拒绝源文件硬链接', { skip: process.platform !== 'win32' }, async () => {
  mkdirSync('.cache', { recursive: true });
  const dir = mkdtempSync(path.resolve('.cache/overwrite-'));
  const input = path.join(dir, 'source.mkv'), first = path.join(dir, 'first.mkv'), target = path.join(dir, 'occupied.mkv');
  run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=64x64:d=0.2', '-c:v', 'libx264', input]);
  const original = readFileSync(input);
  const doc = importPreset({ 视频参数_编码器_具体编码: 'copy' });
  const c = defaultContext(); c.cwd = dir;
  c.inputs = [{ id: 'first', path: 'source.mkv', output: 'first.mkv' }, { id: 'second', path: 'source.mkv', output: 'occupied.mkv' }];
  writeFileSync(target, 'existing');
  const english = translator('en');
  execute(await buildPlan(doc, c, english), dir, true);
  assert.equal(existsSync(first), false);
  assert.equal(readFileSync(target, 'utf8'), 'existing');
  c.shell = 'cmd';
  c.inputs.shift();
  execute(await buildPlan(doc, c, english, true), dir);
  assert.ok(statSync(target).size > 100);
  const alias = path.join(dir, 'hardlink.mkv');
  linkSync(input, alias);
  c.inputs[0].output = 'hardlink.mkv';
  execute(await buildPlan(doc, c, english, true), dir, true);
  assert.deepEqual(readFileSync(input), original);
  assert.deepEqual(readFileSync(alias), original);
});

test('辅助文件按 UTF-8 写入且阶段失败后不继续', { skip: process.platform !== 'win32' }, async () => {
  mkdirSync('.cache', { recursive: true });
  const dir = mkdtempSync(path.resolve('.cache/helpers-')), c = defaultContext();
  const otherInput = path.join(dir, 'source.frames.avs'), observed = path.join(dir, 'observed.txt');
  writeFileSync(otherInput, 'protected');
  c.inputs = [{ id: 'frames', path: path.join(dir, 'source.mp4') }, { id: 'other', path: otherInput }];
  c.resources['template.avs'] = '# 中文模板\nSource("<FilePath>")\n';
  const plan = await buildPlan(importPreset({ 输出_输出文件参数使用方法: 2, 视频参数_视频帧服务器_使用AviSynth: true, 视频参数_视频帧服务器_avs脚本文件: 'template.avs' }), c);
  const first = plan.tasks[0].stages[0];
  first.executable = process.execPath;
  first.args = ['-e', 'const fs=require("node:fs"); fs.copyFileSync(process.argv[1],process.argv[2]); process.exit(7);', first.args[first.assetArg!], observed];
  first.assetArg = 2;
  plan.tasks[1].stages[0] = { ...first, executable: process.execPath, args: ['-e', 'console.log("SHOULD_NOT_RUN")'], assetArg: undefined };
  const script = renderPlan(plan).script; const r = spawnSync(pwsh, ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 20000 });
  assert.ifError(r.error); assert.notEqual(r.status, 0); assert.ok(!r.stdout.includes('SHOULD_NOT_RUN'));
  assert.equal(readFileSync(observed, 'utf8'), '# 中文模板\nSource("' + plan.tasks[0].input + '")\n');
  assert.equal(readFileSync(otherInput, 'utf8'), 'protected');
});

test('落盘前重新核验覆盖目标，编码失败保留旧输出', { skip: process.platform !== 'win32' }, async () => {
  mkdirSync('.cache', { recursive: true });
  const dir = mkdtempSync(path.resolve('.cache/publish-'));
  const source = path.join(dir, 'source.mkv'), target = path.join(dir, 'target.mkv');
  writeFileSync(source, 'original source');
  const c = defaultContext(); c.cwd = dir; c.inputs = [{ id: 'one', path: 'source.mkv', output: 'target.mkv' }];
  const t = translator('en');
  for (const swap of [false, true]) {
    writeFileSync(target, 'original target');
    const plan = await buildPlan(importPreset({}), c, t, true);
    const stage = plan.tasks[0].stages[0];
    stage.executable = process.execPath;
    stage.args = ['-e', 'const f=require("node:fs"); const [out,dest,source,swap]=process.argv.slice(1); f.writeFileSync(out,"encoded"); if(swap==="true"){f.unlinkSync(dest); f.linkSync(source,dest);}else{process.exit(7);}', target, target, source, String(swap)];
    stage.mediaOutputArg = 2;
    stage.outputArgs = {};
    const r = spawnSync(pwsh, ['-NoProfile', '-Command', renderPlan(plan, t).script], { encoding: 'utf8', timeout: 15000 });
    assert.ifError(r.error); assert.notEqual(r.status, 0);
    assert.equal(readFileSync(source, 'utf8'), 'original source');
    assert.equal(readFileSync(target, 'utf8'), swap ? 'original source' : 'original target');
    if (swap) { assert.match(r.stderr, /Encoded file kept at/); }
  }
});
