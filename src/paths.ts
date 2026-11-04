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
  const negative = v.startsWith('-'), body = negative ? v.slice(1) : v;
  const candidates: [string, string, string, string, string][] = [];
  let m: RegExpMatchArray | null;
  if (/^\d+$/.test(body)) { candidates.push([body, '0', '0', '0', '']); }
  if ((m = body.match(/^(\d+)\.(\d+):(\d+)(?::(?:(\d+)(?:\.(\d+))?|\.(\d+)))?$/))) { candidates.push([m[1], m[2], m[3], m[4] || '0', m[5] || m[6] || '']); }
  if ((m = body.match(/^(\d+):(\d+):(\d+):(?:(\d+)(?:\.(\d+))?|\.(\d+))$/))) { candidates.push([m[1], m[2], m[3], m[4] || '0', m[5] || m[6] || '']); }
  if ((m = body.match(/^(\d+):(\d+):(\d+)(?:\.(\d+))?$/))) {
    candidates.push(['0', m[1], m[2], m[3], m[4] || '']);
    if (!m[4]) { candidates.push([m[1], m[2], m[3], '0', '']); }
  }
  if ((m = body.match(/^(\d+):(\d+):\.(\d+)$/))) { candidates.push(['0', m[1], m[2], '0', m[3]]); }
  if ((m = body.match(/^(\d+):(\d+)$/))) { candidates.push(['0', m[1], m[2], '0', '']); }
  for (const [days, hours, minutes, secs, fraction] of candidates) {
    if ([days, hours, minutes, secs, fraction || '0'].some(n => Number(n) > 2147483647) || Number(days) > 10675199 || Number(hours) > 23 || Number(minutes) > 59 || Number(secs) > 59) { continue; }
    if (fraction && fraction[0] !== '0' && Number(fraction) > 9999999) { continue; }
    // .NET 10 rounds accepted fractions to 100-nanosecond ticks, away from zero.
    const f = fraction ? BigInt(fraction) : 0n, scale = fraction.length;
    const divisor = scale > 7 ? 10n ** BigInt(scale - 7) : 1n;
    const fractionTicks = scale <= 7 ? f * 10n ** BigInt(7 - scale) : (f + divisor / 2n) / divisor;
    const ticks = ((BigInt(days) * 24n + BigInt(hours)) * 3600n + BigInt(minutes) * 60n + BigInt(secs)) * 10000000n + fractionTicks;
    if (ticks > (negative ? 9223372036854775808n : 9223372036854775807n)) { continue; }
    return (negative ? -1 : 1) * Number(ticks) / 10000000;
  }
  // NumberStyles.Float does not accept JavaScript hexadecimal or binary literals.
  const n = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}
export const formatSeconds = (n: number) => Number((Math.sign(n) * Math.round(Math.abs(n) * 1e6) / 1e6).toFixed(6)).toString();
