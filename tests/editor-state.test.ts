import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditorState } from '../src/editor-state';
import { sourceText } from '../src/i18n';
import { parseMappingDraft } from '../src/workspace';
import { buildPlan } from '../src/plan';
import { changedFields } from '../src/differences';
import { importPreset } from '../src/preset';

test('差异按有效值比较，字段恢复、JSON 编辑、工作区与撤销保留载入基线', () => {
  const state = createEditorState(() => sourceText);
  const raw = { 预设文件版本: 6, 视频参数_比特率_控制方式: ' cRf ', 滤镜排序系统: [{ 是自定义滤镜: true, 滤镜标识符: '自定义视频滤镜', 滤镜目标流类型: '视频', 自定义滤镜内容: 'hflip' }] };
  assert.deepEqual(changedFields(importPreset(raw), importPreset({ ...raw, 视频参数_比特率_控制方式: '1' })), []);
  state.replacePreset(raw); state.editPreset(['输出容器'], 'mkv');
  assert.ok(changedFields(state.doc, state.baseline).includes('输出容器'));
  state.editPresetJson(JSON.stringify({ ...state.doc.raw, 输出容器: 'mp4' }));
  assert.deepEqual(state.baseline.raw, raw);
  const snapshot = state.snapshot(); state.reset(); state.restore(JSON.stringify(snapshot));
  assert.deepEqual(state.baseline.raw, raw);
  state.resetField(['输出容器'], false);
  assert.equal(Object.hasOwn(state.doc.raw, '输出容器'), false);
  state.perform('replace', () => state.replacePreset()); state.undo();
  assert.deepEqual(state.baseline.raw, raw);
  const legacy: any = { ...snapshot, version: 2 }; delete legacy.baselinePreset;
  state.restore(JSON.stringify(legacy));
  assert.deepEqual(state.baseline.raw, legacy.preset);
});

test('覆盖授权仅用于当前方案，无变化及失败编辑不撤销授权', async () => {
  const state = createEditorState(() => sourceText);
  state.updateTask(state.context.inputs[0].id, task => { task.path = 'D:\\Media\\a.mp4'; task.output = 'D:\\Output\\a.mkv'; });
  const token = state.beginImport();
  state.setOverwrite(true); state.setTheme('light'); state.localize();
  state.updateContext(() => {}); state.editPreset(['输出容器'], state.doc.raw.输出容器);
  assert.equal(state.acceptsImport(token), true);
  assert.equal(state.allowOverwrite, true);
  const before = JSON.stringify(state.snapshot());
  assert.throws(() => state.updateContext(context => { context.cwd = 'broken'; throw new Error('failed'); }));
  assert.throws(() => state.replacePreset('[]'));
  assert.equal(JSON.stringify(state.snapshot()), before);
  assert.equal(state.allowOverwrite, true);
  state.updateTask(state.context.inputs[0].id, task => { task.path = 'D:\\Media\\b.mp4'; task.output = 'D:\\Output\\b.mkv'; });
  assert.equal(state.allowOverwrite, false);
  assert.equal((await buildPlan(state.doc, state.context, sourceText, state.allowOverwrite)).allowOverwrite, false);
  state.setOverwrite(true); state.editMappings('unfinished');
  assert.equal(state.allowOverwrite, false);
  assert.equal(JSON.stringify(state.snapshot()).includes('allowOverwrite'), false);
});

test('映射草稿完整应用，v1 迁移和 v2 恢复保留原文及最后有效映射', () => {
  const state = createEditorState(() => sourceText);
  state.editMappings('D:\\Media => /media\n');
  const mappings = structuredClone(state.context.pathMappings);
  state.editMappings('D:\\Media => /new\n\nunfinished\nsource => ');
  assert.deepEqual(state.mappingErrors, [3, 4]);
  assert.deepEqual(state.context.pathMappings, mappings);
  const saved = JSON.stringify(state.snapshot());
  state.reset(); state.restore(saved);
  assert.deepEqual(state.context.pathMappings, mappings);
  assert.equal(state.drafts.pathMappings, JSON.parse(saved).drafts.pathMappings);
  assert.deepEqual(state.mappingErrors, [3, 4]);
  const legacy: any = { ...state.snapshot(), version: 1 }; delete legacy.drafts;
  state.restore(JSON.stringify(legacy));
  assert.equal(state.drafts.pathMappings, 'D:\\Media => /media');
  assert.equal(state.snapshot().version, 3);
  const current = state.snapshot(); current.drafts = { pathMappings: 'D:\\Media => /new' };
  state.restore(JSON.stringify(current));
  assert.equal(state.context.pathMappings[0].to, '/new');
  const before = JSON.stringify(state.snapshot());
  assert.throws(() => state.restore(JSON.stringify({ ...current, drafts: { pathMappings: 42 } })));
  assert.equal(JSON.stringify(state.snapshot()), before);
  assert.deepEqual(parseMappingDraft(' \n a => b=>c\n'), { mappings: [{ from: 'a', to: 'b=>c' }], invalidLines: [] });
});


test('有效值按原始数组索引读取，保留预设原文', async () => {
  const { importPreset, effectiveValue, exportPreset } = await import('../src/preset');
  const raw = { 预设文件版本: 6, 视频参数_烧录字幕_主要颜色: { 已设置: true, R: 123 }, 视频参数_比特率_控制方式: 'crf', 元数据_要写入的信息: [null, { 字段: 'title', 值: 'kept' }] };
  const doc = importPreset(raw);
  assert.equal(effectiveValue(doc, ['视频参数_烧录字幕_主要颜色', 'A']), 255);
  assert.equal(effectiveValue(doc, ['视频参数_比特率_控制方式']), 1);
  assert.equal(effectiveValue(doc, ['元数据_要写入的信息', 0]), undefined);
  assert.equal(effectiveValue(doc, ['元数据_要写入的信息', 1, '值']), 'kept');
  assert.deepEqual(JSON.parse(exportPreset(doc)), raw);
});


test('导入令牌拒绝旧请求和业务修改，界面设置及失败解析不使其失效', () => {
  const state = createEditorState(() => sourceText);
  const first = state.beginImport(), latest = state.beginImport();
  assert.equal(state.acceptsImport(first), false);
  state.setTheme('light'); state.localize();
  assert.throws(() => state.restore('{}'));
  assert.throws(() => state.replacePreset('[]'));
  assert.equal(state.acceptsImport(latest), true);
  state.updateTask(state.context.inputs[0].id, task => { task.path = 'B'; });
  assert.equal(state.acceptsImport(latest), false);
  const next = state.beginImport(); state.reset();
  assert.equal(state.acceptsImport(next), false);
});


test('关键操作撤销恢复业务状态，后续修改使其失效，失败操作保留历史', () => {
  const state = createEditorState(() => sourceText);
  state.editMappings('unfinished');
  state.updateContext(current => { current.resources['template'] = 'content'; current.inputs[0].probe = { path: '', data: { streams: [] } }; });
  state.setOverwrite(true);
  const before = structuredClone(state.snapshot());
  state.perform('reset', () => state.reset());
  const token = state.beginImport();
  state.setTheme('light'); state.localize();
  assert.throws(() => state.perform('bad', () => state.restore('{}')));
  assert.equal(state.undoLabel, 'reset');
  assert.equal(state.undo(), true);
  assert.equal(state.acceptsImport(token), false);
  assert.equal(state.allowOverwrite, false);
  assert.deepEqual(state.snapshot(), { ...before, theme: 'light' });
  assert.equal(state.undo(), false);
  state.perform('preset', () => state.replacePreset({ 预设文件版本: 6 }));
  state.editPreset(['输出容器'], 'mkv');
  assert.equal(state.undo(), false);
  state.perform('reset', () => state.reset());
  const restored = createEditorState(() => sourceText); restored.restore(JSON.stringify(state.snapshot()));
  assert.equal(restored.undo(), false);
});
