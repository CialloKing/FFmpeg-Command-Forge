export const filename = (p: string) => p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
export const dirname = (p: string) => p.slice(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
export const extension = (p: string) => { const n = filename(p); return n.includes('.') ? n.slice(n.lastIndexOf('.')) : ''; };
export const stem = (p: string) => { const n = filename(p); return n.includes('.') ? n.slice(0, n.lastIndexOf('.')) : n; };
export const withoutExtension = (p: string) => dirname(p) + stem(p);
export function join(dir: string, name: string, style = dir): string { return dir ? dir.replace(/[\\/]+$/, '') + (style.includes('\\') ? '\\' : '/') + name : name; }
export function splitTrailingSerial(value: string): { base: string; digits: string } {
  const digits = value.match(/\d+$/)?.[0] ?? '';
  return { base: value.slice(0, value.length - digits.length), digits };
}

export function relativeSubdirectory(directory: string, root: string, cwd: string, windows: boolean): string {
  const separators = (value: string) => windows ? value.replaceAll('\\', '/') : value;
  const volumePattern = windows ? /^(?:\/\/(?:\?\/UNC\/)?[^/]+\/[^/]+(?:\/|$)|[a-z]:\/|\/)/i : /^\//;
  const normalize = (value: string) => {
    let path = separators(value.trim());
    if (cwd && !volumePattern.test(path)) { path = join(separators(cwd), path, '/'); }
    const volume = path.match(volumePattern)?.[0] ?? '';
    const parts: string[] = [];
    for (const part of path.slice(volume.length).split('/')) {
      if (!part || part === '.') { continue; }
      if (part !== '..') { parts.push(part); }
      else if (parts.length && parts.at(-1) !== '..') { parts.pop(); }
      else if (!volume) { parts.push(part); }
    }
    return { volume: volume ? volume.replace(/\/?$/, '/') : '', parts };
  };
  // Compare normalized path components before using any suffix as an output subdirectory.
  const source = normalize(directory), base = normalize(root);
  const key = (value: string) => windows ? value.toLowerCase() : value;
  if (key(source.volume) !== key(base.volume) || source.parts.length < base.parts.length) { return ''; }
  if (base.parts.some((part, index) => key(part) !== key(source.parts[index]))) { return ''; }
  const relative = source.parts.slice(base.parts.length);
  return relative.includes('..') ? '' : relative.join(windows ? '\\' : '/');
}

export const isPlaceholder = (p: string) => /^<.*>$/.test(p);
export const filterPath = (p: string) => isPlaceholder(p) ? p : p.startsWith('\\\\') ? '\\\\' + p.slice(2).replaceAll('\\', '\\\\') : /^[A-Za-z]:/.test(p) ? p[0] + '\\:' + p.slice(2).replaceAll('\\', '\\\\') : p.replaceAll('\\', '\\\\');
export function substitute(text: string, input: string, output: string): string {
  const preview = ['<输入文件>', '<InputFile>'].includes(input.trim());
  const directory = dirname(input);
  // The original directory placeholder omits the last separator except at a root.
  const folder = directory.length > 1 ? directory.slice(0, -1) : directory;
  const name = filename(input);
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  let inputWithoutExtension = base;
  if (folder && base) {
    const style = input.includes('\\') || !input.includes('/') ? '\\' : '/';
    inputWithoutExtension = /[\\/]$/.test(folder) ? folder + base : join(folder, base, style);
  }
  const replacement: Record<string, string> = {
    '<\\InputFileWithOutExtension>': preview ? '<\\InputFileWithOutExtension>' : filterPath(inputWithoutExtension),
    '<\\InputFilePath>': preview ? '<\\InputFilePath>' : filterPath(folder),
    '<InputFileWithOutExtension>': preview ? '<InputFileWithOutExtension>' : inputWithoutExtension,
    '<InputFileNameWithOutExtension>': preview ? '<InputFileNameWithOutExtension>' : base,
    '<InputFilePath>': preview ? '<InputFilePath>' : folder,
    '<InputFileName>': preview ? '<InputFileName>' : name,
    '<InputFile>': input,
    '<OutputFile>': output, '<输入文件>': input, '<输出文件>': output
  };
  // A replacement callback keeps literal $ sequences in paths, as .NET String.Replace does.
  for (const [key, value] of Object.entries(replacement)) { text = text.replaceAll(key, () => value); }
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
