import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { data, exportPreset, importPreset, patchPreset, schema } from '../src/preset';
import { buildPlan, defaultContext } from '../src/plan';
import { parseArguments, windowsQuote } from '../src/arguments';
import { argumentReads } from '../src/arguments';
import { dirname, filename, relativeSubdirectory, seconds, stem, substitute } from '../src/paths';
import ffmpegFull from '../src/data/ffmpeg-full-2026.11.3.json';

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
  const cases: { name: string; preset: any; duration?: string; input?: string; output?: string; expectReady?: boolean }[] = [
    { name: 'default', preset: {} },
    ...data.builtins.map(x => ({ name: x.名称, preset: x.数据 })),
    ...ffmpegFull.presets.map(preset => ({
      name: 'ffmpeg-full/' + preset.名称,
      preset: preset.数据,
      output: 'D:\\输出\\result' + preset.数据.输出容器,
      expectReady: true
    })),
    { name: 'x264 audio metadata', preset: { 视频参数_编码器_具体编码: 'libx264', 视频参数_编码器_类型: '视频', 视频参数_编码器_编码预设: 'slow', 视频参数_比特率_控制方式: 'CRF', 视频参数_质量控制_值: '23', 音频参数_编码器_代号: 'aac.nmr', 音频参数_比特率: '128k', 元数据_要写入的信息: [{ 字段: 'title', 值: '中文 "标题"' }] } },
    { name: 'copy streams', preset: { 视频参数_编码器_具体编码: 'copy', 音频参数_编码器_代号: 'audio.copy', 流控制_将视频参数应用于指定流: ['0', '1'], 流控制_将音频参数应用于指定流: ['1'], 流控制_启用保留其他音频流: true, 流控制_将字幕参数应用于指定流: ['0'], 流控制_如何操作指定的字幕: '转为_mov_text' } },
    { name: 'filter order', preset: { 视频参数_编码器_具体编码: 'libx264', 视频参数_分辨率: '1280x720', 视频参数_画面翻转_镜像翻转: '水平镜像', 自定义参数_视频滤镜: "eq=contrast=1.1", 视频参数_降噪_方式: 'hqdn3d', 视频参数_降噪_参数1: '1', 音频参数_编码器_代号: 'aac.native', 音频参数_响度标准化_启用调整目标响度: true, 音频参数_响度标准化_目标响度: '-16' } },
    { name: 'keep filtered streams', preset: { 视频参数_编码器_具体编码: 'libx264', 音频参数_编码器_代号: 'aac.native', 视频参数_分辨率: '640x360', 流控制_启用保留其他视频流: true, 流控制_启用保留其他音频流: true, 流控制_将视频参数应用于指定流: ['1'] } },
    { name: 'complex graph', preset: { 视频参数_编码器_具体编码: 'libx264', 自定义参数_视频滤镜: '[0:v]split[x][y];[x][y]hstack[out]', 视频参数_分辨率: '320x240' } },
    { name: 'two pass', preset: { 视频参数_编码器_具体编码: 'libx264', 视频参数_比特率_控制方式: 'TPE', 视频参数_比特率_基础: '400k', 音频参数_编码器_代号: 'aac.native' } },
    { name: 'precise seek', preset: { 剪辑区间_方法: '精剪空降解码', 剪辑区间_入点: '00:00:10', 剪辑区间_出点: '00:00:12', 剪辑区间_向前解码多久秒: '2.0' } },
    { name: 'trim', preset: { 剪辑区间_方法: 'Trim滤镜', 剪辑区间_入点: '00:00:01', 剪辑区间_出点: '00:00:02', 音频参数_编码器_代号: 'aac.native' } },
    { name: 'TimeSpan compatibility', preset: { 剪辑区间_方法: 'Trim滤镜', 剪辑区间_入点: '1:2:.3', 剪辑区间_出点: '1:2:03.0001234567' } },
    { name: 'remove middle', duration: '30.0', preset: { 剪辑区间_方法: '剔除中间', 剪辑区间_入点: '00:00:01', 剪辑区间_出点: '00:00:02', 音频参数_编码器_代号: 'aac.native' } },
    { name: 'full custom', preset: { 自定义参数_完全自己写: '-i "<InputFile>" -metadata title="a & b" "<OutputFile>"' } },
    { name: 'quoted custom directory and literal dollar', input: 'D:\\素材\\cash$$.mp4', preset: { 自定义参数_完全自己写: '-i "<InputFile>" -metadata "comment=<InputFilePath>" "<OutputFile>"' } },
    { name: 'filter directory placeholder', preset: { 自定义参数_完全自己写: '-i "<InputFile>" -vf "subtitles=<\\InputFilePath>\\captions.srt" "<OutputFile>"' } },
    ...['crf', '1'].map(value => ({ name: 'enum string/' + value, preset: { 视频参数_编码器_具体编码: 'libx264', 视频参数_比特率_控制方式: value, 视频参数_质量控制_值: '23' } }))
  ];
  for (const key of ['视频参数_降噪_方式', '视频参数_锐化_方式', '视频参数_胶片颗粒_方式', '视频参数_平滑断层_方式', '视频参数_处理扫描方式', '视频参数_画面翻转_角度翻转', '视频参数_画面翻转_镜像翻转']) {
    for (const [name, n] of Object.entries(schema.fields![key].values!)) { if (n) { cases.push({ name: key + '/' + name, preset: { [key]: name } }); } }
  }
  cases.push(
    { name: 'subtitle styling', preset: { 视频参数_烧录字幕_滤镜选择: 'ass', 视频参数_烧录字幕_字幕来源是外部文件: '内嵌的流', 视频参数_烧录字幕_指定内嵌的流: '0', 视频参数_烧录字幕_基本样式_名称: 'Test Font', 视频参数_烧录字幕_基本样式_粗体: true, 视频参数_烧录字幕_主要颜色: { 已设置: true, R: 240 }, 视频参数_烧录字幕_对齐方位: '底部居中', 视频参数_烧录字幕_补充样式: 'Outline=2' } },
    { name: 'color conversion', preset: { 视频参数_色彩管理_滤镜选择: 'zscale', 视频参数_色彩管理_处理方式: '写入元数据并转换', 视频参数_色彩管理_矩阵系数: 'bt709', 视频参数_色彩管理_色域: 'bt709', 视频参数_色彩管理_范围: 'tv 有限', 视频参数_色彩管理_像素格式预先转换: 'yuv420p', 视频参数_色彩管理_启用调整亮度: true, 视频参数_色彩管理_亮度: '0.1' } },
    { name: 'chapters attachments', preset: { 章节_来源: '文本文档', 章节_文件路径: 'D:\\chapters.txt', 流控制_附件选项: '保留附件', 附件_要写入的附件: [{ 类型: 'MP4封面图', 文件路径: 'D:\\cover.png' }, { 类型: '字体文件', 文件路径: 'D:\\font.ttf' }] } },
    { name: 'cuda interpolate superres', preset: { 视频参数_分辨率自动计算_缩放滤镜: 'scale_cuda', 视频参数_分辨率自动计算_宽度: '1280', 视频参数_分辨率自动计算_缩放算法: 'lanczos', 视频参数_插帧_目标帧率: '60', 视频参数_插帧_运动估计算法: '基于 Hexagon', 视频参数_超分_滤镜叠加策略组: [{ 目标宽度: '1920', 着色器文件路径: 'D:\\shaders\\test.glsl' }] } }
  );
  for (const name of Object.keys(data.video)) { cases.push({ name: 'video catalog/' + name, preset: { 视频参数_编码器_具体编码: name, 视频参数_编码器_编码预设: 'fast', 视频参数_编码器_配置文件: 'main', 视频参数_编码器_场景优化: 'film', 视频参数_编码器_图片编码器质量值: '2' } }); }
  for (const audio of data.audio) { cases.push({ name: 'audio catalog/' + audio.私有ID, preset: { 音频参数_编码器_代号: audio.私有ID, 音频参数_质量参数名: 'q:a', 音频参数_质量值: '2' } }); }
  const input = 'D:\\素材\\视频 test.mp4', output = 'D:\\输出\\result.mkv';
  const requests = cases.map(x => ({ preset: x.preset, input: x.input ?? input, output: x.output ?? output, duration: x.duration || '' }));
  const oracle = spawnSync('dotnet', ['tools/oracle/bin/Debug/net10.0/Oracle.dll'], { input: requests.map(x => JSON.stringify(x)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 8e6 });
  assert.equal(oracle.status, 0, oracle.stderr);
  const results = oracle.stdout.trim().split(/\r?\n/).map(x => JSON.parse(x));
  for (let i = 0; i < cases.length; i++) {
    const sampleInput = requests[i].input;
    const context = defaultContext(); context.inputs = [{ id: 'test', path: sampleInput, output: requests[i].output, probe: { path: sampleInput, data: { format: { duration: cases[i].duration || '30.0' }, streams: [] } } }];
    const plan = await buildPlan(importPreset(cases[i].preset), context);
    if (cases[i].expectReady) { assert.equal(plan.status, 'ready', JSON.stringify(plan.issues)); }
    assert.equal(results[i].error, undefined, cases[i].name);
    assert.equal(plan.tasks[0].stages.length, results[i].length, cases[i].name);
    results[i].forEach((r: any, j: number) => {
      const stage = plan.tasks[0].stages[j], expected = parseArguments(r.命令行);
      if (stage.overwriteArg !== undefined) {
        assert.equal(expected[stage.overwriteArg], '-y');
        assert.equal(stage.args[stage.overwriteArg], '-n');
        expected[stage.overwriteArg] = '-n';
      }
      assert.deepEqual(stage.args, expected, cases[i].name);
      assert.equal(stage.graph, r.滤镜图, cases[i].name);
    });
  }
});

test('TimeSpan 边界与原版 .NET 10 行为一致', () => {
  const values = ['1', '+1', '10.0', '1.2', '1:2:.3', '1:2:03.0001234567', '1:2:3.12345678', '1.02:03', '1:02:03:04', '24:00', '25:00:00', '00:60', '1.25:00:00', '-1:2:3.5', '1:2:3.00000001', '1:2:3.00012345678'];
  const result = spawnSync('dotnet', ['tools/oracle/bin/Debug/net10.0/Oracle.dll', '--times', ...values], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  for (const item of JSON.parse(result.stdout)) { const fallback = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(item.text) ? Number(item.text) : undefined; assert.equal(seconds(item.text), item.ok ? item.seconds : fallback, item.text); }
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
  const mapped = defaultContext(); mapped.platform = 'linux'; mapped.shell = 'bash'; mapped.inputs = [{ id: 'template', path: '/media/input$$.mp4' }]; mapped.pathMappings = [{ from: 'D:\\tpl', to: '/tmp/tpl' }]; mapped.resources['D:\\tpl\\a.avs'] = 'Source("<FilePath>")';
  const template = await buildPlan(importPreset({ 视频参数_视频帧服务器_使用AviSynth: true, 视频参数_视频帧服务器_avs脚本文件: 'D:\\tpl\\a.avs' }), mapped);
  assert.equal(template.status, 'ready', JSON.stringify(template.issues)); assert.equal(template.tasks[0].assets[0].content, 'Source("/media/input$$.mp4")');
});

test('保留子目录结构前规范化路径，长序号准确避让同批任务', async () => {
  const context = defaultContext();
  context.cwd = 'D:\\Media';
  context.outputDirectory = 'D:\\Output';
  context.inputs = [
    { id: 'outside', path: 'source\\..\\outside\\clip.mp4' },
    { id: 'inside', path: 'source\\temp\\..\\sub\\clip.mp4' }
  ];
  const directoryPreset = importPreset({ 输出容器: 'mkv', 输出_自动命名选项: 0, 输出位置_保留子文件夹结构起始点: 'source' });
  const directoryPlan = await buildPlan(directoryPreset, context);
  assert.equal(directoryPlan.status, 'ready', JSON.stringify(directoryPlan.issues));
  assert.deepEqual(directoryPlan.tasks.map(task => task.output), ['D:\\Output\\clip.mkv', 'D:\\Output\\sub\\clip.mkv']);
  assert.equal(relativeSubdirectory('\\\\Server\\Share\\source\\temp\\..\\Sub', '\\\\server\\share\\Source', '', true), 'Sub');
  assert.equal(relativeSubdirectory('/media/source/../outside', '/media/source', '', false), '');

  context.inputs = [{ id: 'serial-1', path: 'clip20261106192345000.mp4' }];
  const serialPreset = importPreset({ 输出容器: 'mkv', 输出_自动命名选项: '附加_2位结尾序号' });
  assert.equal((await buildPlan(serialPreset, context)).tasks[0].output, 'D:\\Output\\clip20261106192345001.mkv');
  context.inputs.push({ id: 'serial-2', path: context.inputs[0].path });
  const serialPlan = await buildPlan(serialPreset, context);
  assert.deepEqual(serialPlan.tasks.map(task => task.output), ['D:\\Output\\clip20261106192345001.mkv', 'D:\\Output\\clip20261106192345002.mkv']);
});

test('探测和转码使用同一份路径映射，显式输出提供容器后缀', async () => {
  const c = defaultContext();
  c.platform = 'linux';
  c.shell = 'bash';
  c.cwd = 'D:\\Media';
  c.pathMappings = [{ from: 'D:\\', to: '/mnt' }, { from: 'd:/media', to: '/source' }, { from: '/source', to: '/wrong' }];
  c.inputs = [{ id: 'clip', path: 'input', output: 'render/out.mkv' }];
  const plan = await buildPlan(importPreset({}), c);
  assert.equal(plan.status, 'ready', JSON.stringify(plan.issues));
  assert.equal(plan.probes[0].args.at(-1), '/source/input');
  assert.deepEqual(plan.tasks[0].stages[0].args.slice(-3), ['-i', '/source/input', '/source/render/out.mkv']);
  const custom = await buildPlan(importPreset({ 自定义参数_完全自己写: '-i "<InputFile>" -i "D:\\Media\\extra.mkv" "<OutputFile>"' }), c);
  assert.equal(custom.status, 'ready', JSON.stringify(custom.issues));
  assert.deepEqual(custom.tasks[0].stages[0].args, ['-i', '/source/input', '-i', '/source/extra.mkv', '/source/render/out.mkv']);
});

test('批量固定输出不能占用其他输入或输出', async () => {
  const c = defaultContext();
  c.cwd = 'D:\\Media';
  c.inputs = [
    { id: 'one', path: 'first.mkv', output: 'a/../Second.MKV' },
    { id: 'two', path: 'second.mkv', output: 'out.mkv' },
    { id: 'three', path: 'third.mkv', output: './OUT.mkv' }
  ];
  const plan = await buildPlan(importPreset({}), c);
  assert.equal(plan.status, 'incompatible');
  assert.equal(plan.issues.filter(issue => issue.level === 'error').length, 2);
});

test('目标系统决定反斜杠语义，Windows 来源映射保持原有规则', async () => {
  const input = "/media/中文 path/part\\name'01.mp4";
  assert.equal(filename(input, 'posix'), "part\\name'01.mp4");
  assert.equal(dirname(input, 'posix'), '/media/中文 path/');
  assert.equal(stem(input, 'posix'), "part\\name'01");
  assert.equal(filename('\\\\server\\share\\clip.mp4'), 'clip.mp4');
  assert.equal(substitute('<InputFileWithOutExtension>|<InputFileName>', input, '', 'posix'), "/media/中文 path/part\\name'01|part\\name'01.mp4");
  const c = defaultContext(); c.platform = 'linux'; c.shell = 'bash';
  c.inputs = [{ id: 'posix', path: input }];
  const plan = await buildPlan(importPreset({ 输出容器: 'mkv', 输出_自动命名选项: 0 }), c);
  assert.equal(plan.status, 'ready');
  assert.equal(plan.tasks[0].output, "/media/中文 path/part\\name'01.mkv");
  c.pathMappings = [{ from: 'D:\\Media', to: '/media/中文 path' }];
  c.inputs[0].path = 'd:/media/part/clip.mp4';
  assert.equal((await buildPlan(importPreset({ 输出容器: 'mkv', 输出_自动命名选项: 0 }), c)).tasks[0].output, '/media/中文 path/part/clip.mkv');
  c.pathMappings = [{ from: '/media/dir\\name', to: '/target' }];
  c.inputs[0].path = '/media/dir\\name/Leaf\\keep.mp4';
  assert.equal((await buildPlan(importPreset({ 输出容器: 'mkv', 输出_自动命名选项: 0 }), c)).tasks[0].output, '/target/Leaf\\keep.mkv');
});

test('附加参数的输入先映射再保留，协议输入关闭覆盖授权', async () => {
  const c = defaultContext();
  c.cwd = 'D:\\Media';
  c.pathMappings = [{ from: 'X:\\Assets', to: 'D:\\Media' }];
  c.inputs = [{ id: 'one', path: 'primary.mkv', output: 'folder/../secondary.mkv' }];
  const doc = importPreset({ 自定义参数_之前参数: '-i "X:\\Assets\\secondary.mkv" -attach "attachment.ttf"' });
  const plan = await buildPlan(doc, c, undefined, true);
  assert.equal(plan.status, 'incompatible');
  assert.ok(plan.tasks[0].reads?.includes('D:\\Media\\secondary.mkv'));
  assert.ok(plan.tasks[0].reads?.includes('D:\\Media\\attachment.ttf'));
  const automatic = await buildPlan(importPreset({ 输出容器: 'mkv', 输出命名_替代文本: 'secondary', 输出_自动命名选项: 11, 自定义参数_之前参数: '-i "X:\\Assets\\secondary01.mkv"' }), { ...c, inputs: [{ id: 'one', path: 'primary.mp4' }] });
  assert.equal(automatic.status, 'ready');
  assert.equal(automatic.tasks[0].output, 'D:\\Media\\secondary02.mkv');
  const remote = await buildPlan(importPreset({ 自定义参数_之前参数: '-i "https://example.com/input.mkv"' }), { ...c, inputs: [{ id: 'one', path: 'primary.mkv', output: 'output.mkv' }] }, undefined, true);
  assert.equal(remote.status, 'ready');
  assert.equal(remote.allowOverwrite, false);
  const nested = await buildPlan(importPreset({ 自定义参数_之前参数: '-i "local-list.m3u8"' }), { ...c, inputs: [{ id: 'one', path: 'primary.mkv', output: 'output.mkv' }] }, undefined, true);
  assert.equal(nested.allowOverwrite, false);
  assert.ok(nested.tasks[0].reads?.includes('D:\\Media\\local-list.m3u8'));
  assert.deepEqual(argumentReads(['-metadata', '-i', '-i', 'real.mkv']).indices, [3]);
});
