import { importPreset } from './preset';
import type { Translate } from './i18n';
import type { ExecutionContext, InputTask, Platform, ProbeData, Shell } from './types';

type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');

export function parseMappingDraft(text: string) {
  const mappings: ExecutionContext['pathMappings'] = [], invalidLines: number[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) { return; }
    const separator = line.indexOf('=>');
    const from = line.slice(0, separator).trim(), to = line.slice(separator + 2).trim();
    if (separator < 0 || !from || !to) { invalidLines.push(index + 1); }
    else { mappings.push({ from, to }); }
  });
  return { mappings, invalidLines };
}

export function isProbeData(value: unknown): value is ProbeData {
  if (!object(value) || value.format === undefined && value.streams === undefined) { return false; }
  if (value.streams !== undefined && !(Array.isArray(value.streams) && value.streams.every(object))) { return false; }
  if (value.format === undefined) { return true; }
  if (!object(value.format)) { return false; }
  const { duration } = value.format;
  return duration == null || typeof duration === 'string' || typeof duration === 'number';
}

const platforms: readonly Platform[] = ['windows', 'linux', 'macos'];
const shells: readonly Shell[] = ['powershell', 'powershell5', 'cmd', 'bash', 'zsh'];

export function parseWorkspace(value: unknown, t: Translate) {
  if (!object(value) || value.format !== 'ffmpeg-command-forge/workspace' || ![1, 2, 3].includes(Number(value.version)) || typeof value.version !== 'number') {
    throw new Error(t('工作区格式无效或版本不支持'));
  }
  const invalid = (path: string): never => { throw new Error(t('工作区字段无效：{0}', path)); };
  const record = (value: unknown, path: string) => object(value) ? value : invalid(path);
  const string = (value: unknown, path: string) => typeof value === 'string' ? value : invalid(path);
  const list = (value: unknown, path: string): unknown[] => Array.isArray(value) ? value : invalid(path);
  const ctx = record(value.context, 'context');
  const text = (key: string) => string(ctx[key], 'context.' + key);
  const platform = platforms.find(platform => platform === ctx.platform) ?? invalid('context.platform');
  const shell = shells.find(shell => shell === ctx.shell) ?? invalid('context.shell');
  const ids = new Set<string>();
  const inputs = list(ctx.inputs, 'context.inputs').map((value, index): InputTask => {
    const path = `context.inputs[${index}]`;
    const item = record(value, path);
    const id = string(item.id, path + '.id');
    if (!id || ids.has(id)) { invalid(path + '.id'); }
    ids.add(id);
    const task: InputTask = { id, path: string(item.path, path + '.path') };
    for (const field of ['output', 'subtitle'] as const) {
      if (item[field] !== undefined) { task[field] = string(item[field], path + '.' + field); }
    }
    if (item.sidecars !== undefined) { task.sidecars = strings(item.sidecars) ? item.sidecars : invalid(path + '.sidecars'); }
    if (item.sidecarsConfirmed !== undefined) {
      task.sidecarsConfirmed = typeof item.sidecarsConfirmed === 'boolean' ? item.sidecarsConfirmed : invalid(path + '.sidecarsConfirmed');
    }
    if (item.probe !== undefined) {
      const probe = record(item.probe, path + '.probe');
      task.probe = {
        path: string(probe.path, path + '.probe.path'),
        resolvedPath: probe.resolvedPath === undefined ? undefined : string(probe.resolvedPath, path + '.probe.resolvedPath'),
        data: isProbeData(probe.data) ? probe.data : invalid(path + '.probe.data')
      };
    }
    return task;
  });
  const pathMappings = list(ctx.pathMappings, 'context.pathMappings').map((value, index) => {
    const path = `context.pathMappings[${index}]`;
    const mapping = record(value, path);
    return { from: string(mapping.from, path + '.from'), to: string(mapping.to, path + '.to') };
  });
  const resources = Object.fromEntries(Object.entries(record(ctx.resources, 'context.resources')).map(
    ([key, content]) => [key, string(content, `context.resources[${JSON.stringify(key)}]`)]
  ));
  const context: ExecutionContext = {
    platform, shell, inputs, pathMappings, resources,
    ffmpeg: text('ffmpeg'), ffprobe: text('ffprobe'), cwd: text('cwd'), outputDirectory: text('outputDirectory'),
    clock: text('clock'), nonce: text('nonce'),
    confirmedPaths: strings(ctx.confirmedPaths) ? ctx.confirmedPaths : invalid('context.confirmedPaths')
  };
  const doc = importPreset(record(value.preset, 'preset'), t);
  const baseline = value.version === 3 ? importPreset(record(value.baselinePreset, 'baselinePreset'), t) : importPreset(doc.raw, t);
  const drafts = { pathMappings: value.version === 1 ? pathMappings.map(m => m.from + ' => ' + m.to).join('\n') :
    string(record(value.drafts, 'drafts').pathMappings, 'drafts.pathMappings') };
  const parsed = parseMappingDraft(drafts.pathMappings);
  if (!parsed.invalidLines.length) { context.pathMappings = parsed.mappings; }
  return { context, doc, baseline, drafts, theme: value.theme === 'light' ? 'light' : 'dark' };
}
