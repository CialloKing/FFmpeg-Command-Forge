import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditorState } from '../src/editor-state';
import { sourceText } from '../src/i18n';
import { parseMappingDraft } from '../src/workspace';

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
  assert.equal(state.snapshot().version, 2);
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
