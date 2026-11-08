import { effectiveValue, schema } from './preset';
import type { FieldPath, PresetDocument, Schema } from './types';

function comparable(doc: PresetDocument, path: FieldPath, spec: Schema | undefined): unknown {
  const raw = path.reduce<any>((value, key) => value?.[key], doc.raw);
  const value = effectiveValue(doc, path);
  if (!spec) { return raw; }
  if (spec.kind === 'array' && Array.isArray(value)) {
    const items = Array.isArray(raw) ? raw : value;
    return items.flatMap((item, index) => item === null ? [] : [comparable(doc, [...path, index], spec.items)]);
  }
  if (spec.kind === 'object' && value && typeof value === 'object') {
    const keys = [...new Set([...Object.keys(spec.fields!), ...Object.keys(raw ?? {})])].sort();
    // 实例标识用于编辑定位，不改变参数语义；缺省标识每次规范化都会重新生成。
    return Object.fromEntries(keys.filter(key => key !== '实例ID').map(key => [key, comparable(doc, [...path, key], spec.fields![key])]));
  }
  return value;
}
export function sameField(current: PresetDocument, reference: PresetDocument, path: FieldPath): boolean {
  if (path.at(-1) === '实例ID') { return true; }
  let spec: Schema | undefined = schema;
  for (const key of path) { spec = typeof key === 'number' ? spec?.items : spec?.fields?.[key]; }
  return JSON.stringify(comparable(current, path, spec)) === JSON.stringify(comparable(reference, path, spec));
}
export function changedFields(current: PresetDocument, reference: PresetDocument): string[] {
  return [...new Set([...Object.keys(schema.fields!), ...Object.keys(current.raw), ...Object.keys(reference.raw)])]
    .filter(key => !sameField(current, reference, [key]));
}
