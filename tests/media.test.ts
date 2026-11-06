import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildPlan, defaultContext } from '../src/plan';
import { importPreset } from '../src/preset';
import { downloadableScript, renderPlan } from '../src/render';
import type { CommandPlan, Shell } from '../src/types';
import { pwsh } from './runtime';

function run(exe: string, args: string[]) {
  const r = spawnSync(exe, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 2e6, env: { ...process.env, FCF_TEST_VAR: 'MUST_NOT_EXPAND' } });
  assert.equal(r.status, 0, (r.error?.message || '') + '\n' + r.stderr); return r.stdout;
}
function execute(plan: CommandPlan, dir: string): void {
  const r = renderPlan(plan); assert.equal(plan.status, 'ready', JSON.stringify(plan.issues)); assert.deepEqual(r.issues, []);
  const file = path.join(dir, r.filename); writeFileSync(file, (r.filename.endsWith('.ps1') ? '\uFEFF' : '') + downloadableScript(plan, r));
  if (plan.context.shell === 'cmd') { run('cmd.exe', ['/d', '/v:off', '/c', file]); }
  else { run(plan.context.shell === 'powershell5' ? 'powershell.exe' : pwsh, ['-NoProfile', '-File', file]); }
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
  const doc = importPreset({ 输出容器: 'mkv', 输出_自动命名选项: '附加_递增数字', 视频参数_编码器_具体编码: 'copy', 音频参数_编码器_代号: 'audio.copy' }); const plan = await buildPlan(doc, c);
  writeFileSync(plan.tasks[0].output, 'existing'); execute(plan, dir);
  assert.equal(readFileSync(plan.tasks[0].output, 'utf8'), 'existing'); assert.ok(statSync(plan.tasks[0].output.replace('~1.mkv', '~2.mkv')).size > 100);
  c.shell = 'powershell5';
  const serialPlan = await buildPlan(importPreset({ ...doc.raw, 输出_自动命名选项: '附加_2位结尾序号', 输出命名_替代文本: 'clip20261106192344998' }), c);
  const occupied = path.join(dir, 'clip20261106192344999.mkv');
  assert.equal(serialPlan.tasks[0].output, occupied);
  writeFileSync(occupied, 'existing'); execute(serialPlan, dir);
  assert.equal(readFileSync(occupied, 'utf8'), 'existing'); assert.ok(statSync(path.join(dir, 'clip20261106192345000.mkv')).size > 100);
  const srt = path.join(dir, '字幕 test.srt'), chapters = path.join(dir, 'chapters.txt'), font = path.join(dir, 'font.ttf');
  writeFileSync(srt, '1\n00:00:00,000 --> 00:00:01,500\nHello subtitle\n');
  writeFileSync(chapters, ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1500\ntitle=First chapter\n'); writeFileSync(font, 'attachment bytes');
  const extraContext = defaultContext(); extraContext.inputs = [{ id: 'extras', path: input, output: path.join(dir, 'extras.mkv'), sidecars: [srt], sidecarsConfirmed: true }]; extraContext.confirmedPaths = [chapters, font];
  const extras = await buildPlan(importPreset({ 视频参数_编码器_具体编码: 'copy', 音频参数_编码器_代号: 'audio.copy', 流控制_自动混流SRT: true, 章节_来源: '文本文档', 章节_文件路径: chapters, 附件_要写入的附件: [{ 类型: '字体文件', 文件路径: font }] }), extraContext);
  execute(extras, dir); const extraProbe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_chapters', '-of', 'json', extras.tasks[0].output])); assert.ok(extraProbe.streams.some((s: any) => s.codec_type === 'subtitle')); assert.ok(extraProbe.streams.some((s: any) => s.codec_type === 'attachment')); assert.equal(extraProbe.chapters[0].tags.title, 'First chapter');
  const burnContext = defaultContext(); burnContext.inputs = [{ id: 'burn', path: input, output: path.join(dir, 'burned.mkv'), subtitle: srt }];
  const burned = await buildPlan(importPreset({ 视频参数_编码器_具体编码: 'libx264', 视频参数_编码器_编码预设: 'ultrafast', 音频参数_编码器_代号: 'audio.copy', 视频参数_烧录字幕_滤镜选择: 'subtitles', 视频参数_烧录字幕_字幕来源是外部文件: '外部字幕文件' }), burnContext);
  execute(burned, dir); assert.ok(statSync(burned.tasks[0].output).size > 100);
});

test('辅助文件按 UTF-8 写入且阶段失败后不继续', { skip: process.platform !== 'win32' }, async () => {
  mkdirSync('.cache', { recursive: true }); const dir = mkdtempSync(path.resolve('.cache/helpers-')), c = defaultContext(); c.inputs = [{ id: 'frames', path: path.join(dir, 'source.mp4'), output: path.join(dir, 'out.mkv') }]; c.resources['template.avs'] = '# 中文模板\nSource("<FilePath>")\n';
  const plan = await buildPlan(importPreset({ 视频参数_视频帧服务器_使用AviSynth: true, 视频参数_视频帧服务器_avs脚本文件: 'template.avs' }), c);
  plan.tasks[0].stages[0].executable = path.resolve('tools/oracle/bin/Debug/net10.0/Oracle.exe'); plan.tasks[0].stages[0].args.unshift('--argv'); execute(plan, dir);
  assert.equal(readFileSync(plan.tasks[0].assets[0].path, 'utf8'), '# 中文模板\nSource("' + plan.tasks[0].input + '")\n');
  const first = plan.tasks[0].stages[0]; first.executable = 'cmd.exe'; first.args = ['/c', 'exit 7']; plan.tasks[0].stages.push({ ...first, executable: path.resolve('tools/oracle/bin/Debug/net10.0/Oracle.exe'), args: ['--argv', 'SHOULD_NOT_RUN'] });
  const script = renderPlan(plan).script; const r = spawnSync(pwsh, ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 20000 });
  assert.notEqual(r.status, 0); assert.ok(!r.stdout.includes('SHOULD_NOT_RUN'));
});
