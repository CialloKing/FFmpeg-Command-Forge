import upstream from './data/upstream.json';
import type { FieldPath, Issue, Preset, PresetDocument, Schema } from './types';
import { fieldPathText, presetTarget } from './diagnostics';
import { sourceText, type Translate } from './i18n';

export const data = upstream as unknown as { defaults: Preset; schema: Schema; video: Record<string, any>; audio: any[]; builtins: { 名称: string; 数据: Preset }[] };
export const schema = data.schema;
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function matchesFieldType(value: unknown, spec: Schema): boolean {
  if (value == null) { return true; }
  if (spec.kind === 'array') { return Array.isArray(value); }
  if (spec.kind === 'object') { return typeof value === 'object' && !Array.isArray(value); }
  return spec.kind === 'enum' ? typeof value === 'string' || typeof value === 'number' : typeof value === spec.kind;
}
export function matchesFieldShape(value: any, spec: Schema): boolean {
  if (!matchesFieldType(value, spec)) { return false; }
  if (value == null) { return true; }
  if (spec.kind === 'array') { return value.every((item: unknown) => matchesFieldShape(item, spec.items!)); }
  if (spec.kind === 'object') { return Object.entries(spec.fields!).every(([key, child]) => matchesFieldShape(value[key], child)); }
  return true;
}
const meaningful = (v: unknown): boolean => v !== null && v !== '' && v !== false && v !== 0 && (Array.isArray(v) ? v.length > 0 : typeof v === 'object' ? Object.values(v as object).some(meaningful) : true);

function normalize(value: any, spec: Schema, fallback: any, path: FieldPath, issues: Issue[], t: Translate): any {
  const field = fieldPathText(path);
  const problem = (message: string) => issues.push({ level: 'error', field, target: presetTarget(path), message });
  if (fallback === undefined) { fallback = spec.defaults; }
  if (value === undefined || value === null) { value = fallback ?? (spec.kind === 'object' ? {} : spec.kind === 'array' ? [] : spec.kind === 'boolean' ? false : spec.kind === 'number' ? 0 : spec.kind === 'enum' ? 0 : ''); }
  if (spec.kind === 'enum') {
    const values = Object.entries(spec.values ?? {});
    let n: number | undefined;
    if (typeof value === 'number') { n = value; }
    else if (typeof value === 'string') {
      // JsonStringEnumConverter accepts case-insensitive names and integer strings.
      const name = value.trim().toLowerCase();
      n = /^[+-]?\d+$/.test(name) ? Number(name) : values.find(([key]) => key.toLowerCase() === name)?.[1];
    }
    // v6 retains this legacy VBR enum value even though it is absent from Enum.GetNames.
    if (field === '视频参数_比特率_控制方式' && n === 3) { n = 2; }
    if (n === undefined || !values.some(([, known]) => known === n)) {
      problem(t('{0}：未知枚举 {1}', field, String(value))); return 0;
    }
    return n;
  }
  if (spec.kind === 'array') {
    if (!Array.isArray(value)) { problem(t('{0} 必须是数组', field)); return []; }
    // 运行对象仍跳过 null，但诊断必须指向原始 JSON 中的索引。
    return value.flatMap((v, i) => v === null ? [] : [normalize(v, spec.items!, undefined, [...path, i], issues, t)]);
  }
  if (spec.kind === 'object') {
    if (typeof value !== 'object' || Array.isArray(value)) { problem(t('{0} 必须是对象', field)); value = {}; }
    const result: Preset = {};
    for (const [key, child] of Object.entries(spec.fields!)) { result[key] = key === '实例ID' && !value[key] ? crypto.randomUUID().replaceAll('-', '') : normalize(value[key], child, fallback?.[key], [...path, key], issues, t); }
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(spec.fields!, key) && meaningful(value[key])) { issues.push({ level: 'error', field: fieldPathText([...path, key]), target: presetTarget([...path, key]), message: t('未识别的非空字段：{0}{1}', field ? field + '.' : '', key) }); }
    }
    return result;
  }
  if (typeof value !== spec.kind) { problem(t('{0} 应为 {1}', field, spec.kind)); return fallback ?? (spec.kind === 'string' ? '' : spec.kind === 'boolean' ? false : 0); }
  return value;
}
export function importPreset(input?: string | Preset, t: Translate = sourceText): PresetDocument {
  const raw = input === undefined ? clone(data.defaults) : typeof input === 'string' ? JSON.parse(input.replace(/^\uFEFF/, '')) : clone(input);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { throw new Error(t('预设必须是 JSON 对象')); }
  const issues: Issue[] = [];
  const normalized = normalize(raw, schema, data.defaults, [], issues, t);
  if (normalized.预设文件版本 !== 6) { issues.unshift({ level: 'error', field: '预设文件版本', target: presetTarget(['预设文件版本']), message: t('预设版本 {0} 不在 v6 兼容范围内', normalized.预设文件版本) }); }
  return { raw, normalized, issues };
}
export function exportPreset(doc: PresetDocument): string { return JSON.stringify(doc.raw, null, 2) + '\n'; }
export function effectiveValue(doc: PresetDocument, path: FieldPath): any {
  let raw: any = doc.raw, normalized: any = doc.normalized;
  for (const key of path) {
    let effectiveKey = key;
    // 运行对象移除了 null 数组项；编辑器必须继续使用原始 JSON 的索引。
    if (typeof key === 'number' && Array.isArray(raw)) {
      if (raw[key] === null) { return undefined; }
      effectiveKey = raw.slice(0, key).filter(value => value !== null).length;
    }
    raw = raw?.[key]; normalized = normalized?.[effectiveKey];
  }
  return normalized;
}
export function patchPreset(doc: PresetDocument, key: string, value: unknown): PresetDocument { return importPreset({ ...doc.raw, [key]: value }); }

export const groups = ['输出', '解码', '编码器', '画面', '字幕', '质量', '色彩', '音频', '剪辑', '流控制', '附加内容', '自定义参数', '预设信息'];
export function groupFor(key: string): string {
  if (/^(输出|计算机)/.test(key)) { return '输出'; }
  if (key.startsWith('解码')) { return '解码'; }
  if (key.startsWith('视频参数_编码器') || key.includes('视频帧服务器')) { return '编码器'; }
  if (key.includes('烧录字幕')) { return '字幕'; }
  if (/视频参数_(比特率|质量控制)/.test(key)) { return '质量'; }
  if (key.includes('色彩管理')) { return '色彩'; }
  if (key.startsWith('视频参数') || key === '滤镜排序系统') { return '画面'; }
  if (key.startsWith('音频')) { return '音频'; }
  if (key.startsWith('剪辑')) { return '剪辑'; }
  if (key.startsWith('流控制')) { return '流控制'; }
  if (/^(元数据|章节|附件)/.test(key)) { return '附加内容'; }
  if (key.startsWith('自定义')) { return '自定义参数'; }
  return '预设信息';
}
export function blankValue(spec: Schema): any {
  if (spec.kind === 'object') { return Object.fromEntries(Object.entries(spec.fields!).map(([k, v]) => [k, k === '实例ID' ? crypto.randomUUID().replaceAll('-', '') : blankValue(v)])); }
  if (spec.kind === 'array') { return []; }
  if (spec.kind === 'enum') { return Object.keys(spec.values!)[0]; }
  return spec.kind === 'boolean' ? false : spec.kind === 'number' ? 0 : '';
}
