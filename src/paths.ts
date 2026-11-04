export const filename = (p: string) => p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
export const dirname = (p: string) => p.slice(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
export const extension = (p: string) => { const n = filename(p); return n.includes('.') ? n.slice(n.lastIndexOf('.')) : ''; };
export const stem = (p: string) => { const n = filename(p); return n.includes('.') ? n.slice(0, n.lastIndexOf('.')) : n; };
export const withoutExtension = (p: string) => dirname(p) + stem(p);
export function join(dir: string, name: string, style = dir): string { return dir ? dir.replace(/[\\/]+$/, '') + (style.includes('\\') ? '\\' : '/') + name : name; }
export const isPlaceholder = (p: string) => /^<.*>$/.test(p);
export const filterPath = (p: string) => isPlaceholder(p) ? p : p.startsWith('\\\\') ? '\\\\' + p.slice(2).replaceAll('\\', '\\\\') : /^[A-Za-z]:/.test(p) ? p[0] + '\\:' + p.slice(2).replaceAll('\\', '\\\\') : p.replaceAll('\\', '\\\\');
export function substitute(text: string, input: string, output: string): string {
  const replacement: Record<string, string> = {
    '<\\InputFileWithOutExtension>': filterPath(withoutExtension(input)), '<\\InputFilePath>': filterPath(dirname(input)),
    '<InputFileWithOutExtension>': withoutExtension(input), '<InputFileNameWithOutExtension>': stem(input),
    '<InputFilePath>': dirname(input), '<InputFileName>': filename(input), '<InputFile>': input,
    '<OutputFile>': output, '<输入文件>': input, '<输出文件>': output
  };
  for (const [key, value] of Object.entries(replacement)) { text = text.replaceAll(key, value); }
  return text;
}
// Match .NET TimeSpan.TryParse before Double.TryParse, including its bare-integer day syntax.
export function seconds(value: string): number | undefined {
  const v = String(value).trim();
  if (!v) { return undefined; }
  if (/^[+-]?\d+$/.test(v)) { return Number(v) * 86400; }
  const m = v.match(/^(-)?(?:(\d+)\.)?(\d+):(\d{1,2})(?::(\d{1,2})(?:\.(\d{1,7}))?)?$/);
  if (m) { const [, neg, days, h, min, sec, frac] = m; return (neg ? -1 : 1) * ((Number(days || 0) * 24 + Number(h)) * 3600 + Number(min) * 60 + Number(sec || 0) + Number('0.' + (frac || '0'))); }
  const n = Number(v); return Number.isFinite(n) ? n : undefined;
}
export const formatSeconds = (n: number) => Number(n.toFixed(6)).toString();
