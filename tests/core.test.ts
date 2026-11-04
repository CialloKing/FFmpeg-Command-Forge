import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { data, exportPreset, importPreset, patchPreset, schema } from '../src/preset';
import { buildPlan, defaultContext } from '../src/plan';
import { parseArguments, windowsQuote } from '../src/arguments';

test('预设往返保留原始嵌套数据，未知内容阻断执行', async () => {
  const raw = { 预设文件版本: 6, 视频参数_比特率_控制方式: 3, 自定义扩展: { future: 'keep' }, 元数据_要写入的信息: [{ 字段: 'title', 值: '中文', 扩展: 'keep too' }] };
  const doc = patchPreset(importPreset(raw), '输出容器', 'mkv');
  assert.equal(doc.normalized.视频参数_比特率_控制方式, 2);
  assert.deepEqual(JSON.parse(exportPreset(doc)).元数据_要写入的信息, raw.元数据_要写入的信息);
  assert.deepEqual(doc.raw.自定义扩展, raw.自定义扩展);
  assert.equal((await buildPlan(doc, defaultContext())).status, 'incompatible');
  assert.equal(importPreset().issues.length, 0);
  assert.equal(importPreset({ 预设文件版本: 5 }).issues[0].level, 'error');
});

test('原版参数与 TypeScript 执行计划保持一致', async () => {
  const cases: { name: string; preset: any; duration?: string }[] = [
    { name: 'default', preset: {} },
    ...data.builtins.map(x => ({ name: x.名称, preset: x.数据 })),
    { name: 'x264 audio metadata', preset: { 视频参数_编码器_具体编码: 'libx264', 视频参数_编码器_类型: '视频', 视频参数_编码器_编码预设: 'slow', 视频参数_比特率_控制方式: 'CRF', 视频参数_质量控制_值: '23', 音频参数_编码器_代号: 'aac.nmr', 音频参数_比特率: '128k', 元数据_要写入的信息: [{ 字段: 'title', 值: '中文 "标题"' }] } },
    { name: 'copy streams', preset: { 视频参数_编码器_具体编码: 'copy', 音频参数_编码器_代号: 'audio.copy', 流控制_将视频参数应用于指定流: ['0', '1'], 流控制_将音频参数应用于指定流: ['1'], 流控制_启用保留其他音频流: true, 流控制_将字幕参数应用于指定流: ['0'], 流控制_如何操作指定的字幕: '转为_mov_text' } },
    { name: 'filter order', preset: { 视频参数_编码器_具体编码: 'libx264', 视频参数_分辨率: '1280x720', 视频参数_画面翻转_镜像翻转: '水平镜像', 自定义参数_视频滤镜: "eq=contrast=1.1", 视频参数_降噪_方式: 'hqdn3d', 视频参数_降噪_参数1: '1', 音频参数_编码器_代号: 'aac.native', 音频参数_响度标准化_启用调整目标响度: true, 音频参数_响度标准化_目标响度: '-16' } },
    { name: 'keep filtered streams', preset: { 视频参数_编码器_具体编码: 'libx264', 音频参数_编码器_代号: 'aac.native', 视频参数_分辨率: '640x360', 流控制_启用保留其他视频流: true, 流控制_启用保留其他音频流: true, 流控制_将视频参数应用于指定流: ['1'] } },
    { name: 'complex graph', preset: { 视频参数_编码器_具体编码: 'libx264', 自定义参数_视频滤镜: '[0:v]split[x][y];[x][y]hstack[out]', 视频参数_分辨率: '320x240' } },
    { name: 'two pass', preset: { 视频参数_编码器_具体编码: 'libx264', 视频参数_比特率_控制方式: 'TPE', 视频参数_比特率_基础: '400k', 音频参数_编码器_代号: 'aac.native' } },
    { name: 'precise seek', preset: { 剪辑区间_方法: '精剪空降解码', 剪辑区间_入点: '00:00:10', 剪辑区间_出点: '00:00:12', 剪辑区间_向前解码多久秒: '2.0' } },
    { name: 'trim', preset: { 剪辑区间_方法: 'Trim滤镜', 剪辑区间_入点: '00:00:01', 剪辑区间_出点: '00:00:02', 音频参数_编码器_代号: 'aac.native' } },
    { name: 'remove middle', duration: '30.0', preset: { 剪辑区间_方法: '剔除中间', 剪辑区间_入点: '00:00:01', 剪辑区间_出点: '00:00:02', 音频参数_编码器_代号: 'aac.native' } },
    { name: 'full custom', preset: { 自定义参数_完全自己写: '-i "<InputFile>" -metadata title="a & b" "<OutputFile>"' } }
  ];
  const input = 'D:\\素材\\视频 test.mp4', output = 'D:\\输出\\result.mkv';
  const requests = cases.map(x => ({ preset: x.preset, input, output, duration: x.duration || '' }));
  const oracle = spawnSync('dotnet', ['tools/oracle/bin/Debug/net10.0/Oracle.dll'], { input: requests.map(x => JSON.stringify(x)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 8e6 });
  assert.equal(oracle.status, 0, oracle.stderr);
  const results = oracle.stdout.trim().split(/\r?\n/).map(x => JSON.parse(x));
  for (let i = 0; i < cases.length; i++) {
    const context = defaultContext(); context.inputs = [{ id: 'test', path: input, output, probe: { path: input, data: { format: { duration: cases[i].duration || '30.0' }, streams: [] } } }];
    const plan = await buildPlan(importPreset(cases[i].preset), context);
    assert.equal(results[i].error, undefined, cases[i].name);
    assert.equal(plan.tasks[0].stages.length, results[i].length, cases[i].name);
    results[i].forEach((r: any, j: number) => { assert.deepEqual(plan.tasks[0].stages[j].args, parseArguments(r.命令行), cases[i].name); assert.equal(plan.tasks[0].stages[j].graph, r.滤镜图, cases[i].name); });
  }
});

test('Windows 参数引用往返与原生 CommandLineToArgvW 一致', () => {
  const values = ['', '中文 path', 'a"b', "a'b", 'tail\\', '\\\\server\\path\\', 'a\\\\"b', '$x & | % ! ^ ( )', 'line\nnext'];
  assert.deepEqual(parseArguments(values.map(windowsQuote).join(' ')), values);
  if (process.platform === 'win32') {
    const r = spawnSync('tools/oracle/bin/Debug/net10.0/Oracle.exe', ['--argv', ...values], { encoding: 'utf8' });
    assert.equal(r.status, 0); assert.deepEqual(JSON.parse(r.stdout).slice(1), values);
  }
});

test('全部字段有界面分组，媒体探测与输入关联', async () => {
  assert.ok(Object.keys(schema.fields!).length > 150);
  const c = defaultContext(); c.inputs = [{ id: 'one', path: 'new.mp4', probe: { path: 'old.mp4', data: { format: { duration: '10' } } } }];
  const p = await buildPlan(importPreset({ 剪辑区间_方法: '剔除中间', 剪辑区间_入点: '00:00:01' }), c);
  assert.equal(p.status, 'missing'); assert.ok(p.issues.some(x => x.message.includes('ffprobe')));
});
