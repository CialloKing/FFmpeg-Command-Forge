import type { Preset, ProbeData, StreamSummary, StreamType } from './types';
import { audioCodec, audioExtra, videoCodec, videoExtra, type GraphResult } from './codecs';
import { filterFragment } from './filters';
import { formatSeconds, seconds, substitute, extension } from './paths';

export function streamList(values: string[], type: string): string[] { return [...new Set(values.flatMap(v => v.split(',')).map(v => v.trim()).filter(Boolean).map(v => v.includes(':') ? v : `0:${type}:${v}`))]; }
export const optionalMap = (s: string) => s.replace(/\?+$/, '') + '?';
export const selector = (s: string, type: string) => { const parts = s.replace(/\?+$/, '').split(':').filter(Boolean); return parts.at(-2)?.toLowerCase() === type && /^\d+$/.test(parts.at(-1)!) ? type + ':' + parts.at(-1) : type; };

const streamCodes = new Map([['video', 'v'], ['audio', 'a'], ['subtitle', 's'], ['attachment', 't'], ['data', 'd']]);

export function summarizeStreams(args: string[], unknown: boolean, subtitleInputs?: ReadonlySet<number>, probe?: ProbeData): StreamSummary {
  if (unknown) { return { v: 'unknown', a: 'unknown', s: 'unknown' }; }
  const maps = args.flatMap((value, i) => value === '-map' ? [args[i + 1]] : []);
  const source = probe?.streams?.every(stream => typeof stream.codec_type === 'string') ? probe.streams : undefined;
  const kind = (stream: Record<string, unknown>) => streamCodes.get(String(stream.codec_type)) ?? '';
  const sourceAudio = source?.some(stream => kind(stream) === 'a');
  const selected = new Set<string>(), pending = new Set<string>();
  let matched = false, ambiguous = false;
  for (const map of maps) {
    const selector = /^(\d+)(?::([vastd])(?::(\d+))?|:(\d+))?(\?)?$/.exec(map);
    if (!selector) { ambiguous = true; continue; }
    const [, input, type, ordinal, index, optional] = selector;
    if (Number(input) !== 0 || !source || (index !== undefined && !source.every(stream => Number.isInteger(stream.index)))) {
      const inferred = type || (index === '0' && subtitleInputs?.has(Number(input)) ? 's' : '');
      if (inferred) { pending.add(inferred); }
      else { ambiguous = true; }
      continue;
    }
    let matches = index === undefined ? source.filter(stream => !type || kind(stream) === type) :
      source.filter(stream => stream.index === Number(index));
    if (ordinal !== undefined) { matches = matches.slice(Number(ordinal), Number(ordinal) + 1); }
    if (!matches.length && !optional) { ambiguous = true; }
    if (matches.length) { matched = true; }
    for (const stream of matches) { selected.add(kind(stream)); }
  }
  // An entirely ignored optional mapping is equivalent to leaving stream selection to FFmpeg.
  const fallback = maps.length > 0 && maps.every(map => map?.endsWith('?')) && !matched
    ? (pending.size || ambiguous ? 'possible' : 'confirmed')
    : undefined;
  const status = (type: StreamType) => {
    if (args.includes('-' + type + 'n')) { return 'omitted'; }
    if (!maps.length || fallback === 'confirmed') { return 'automatic'; }
    if (selected.has(type)) { return 'mapped'; }
    if (pending.has(type)) { return 'pending'; }
    return ambiguous || !matched && pending.size ? 'unknown' : 'omitted';
  };
  return { v: status('v'), a: status('a'), s: status('s'), fallback, sourceAudio };
}

export function subtitleCodec(codec: string, a: Preset, output: string, auto = false): string {
  const ext = (extension(output) || a.输出容器).replace(/^\./, '').toLowerCase();
  if (['mp4', 'mov', 'm4v', 'm4a', '3gp', '3g2', 'mj2'].includes(ext)) { return codec === 'copy' && !auto ? codec : codec ? 'mov_text' : ''; }
  if (ext === 'webm') { return codec === 'copy' && !auto ? codec : codec ? 'webvtt' : ''; }
  if (['mkv', 'mka', 'mks'].includes(ext) && codec.toLowerCase() === 'mov_text') { return 'copy'; }
  return codec;
}
function structural(text: string): { complex: boolean; labels: string[] } {
  let single = false, double = false, escaped = false, complex = false, label = -1;
  const labels: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\') { escaped = true; continue; }
    if (label >= 0) { if (c === ']') { labels.push(text.slice(label + 1, i).trim()); label = -1; } continue; }
    if (c === "'" && !double) { single = !single; continue; }
    if (c === '"' && !single) { double = !double; continue; }
    if (single || double) { continue; }
    if ('[];'.includes(c)) { complex = true; }
    if (c === '[') { label = i; }
  }
  const count = new Map<string, number>(); for (const s of labels.filter(s => s && !s.includes(':') && !/^\d+$/.test(s))) { count.set(s, (count.get(s) || 0) + 1); }
  return { complex, labels: [...count].filter(([, n]) => n === 1).map(([s]) => s) };
}
const clean = (s: string) => s.trim().replace(/^(,\s*)+|(\s*,)+$/g, '');
function trimFilter(a: Preset, audio: boolean): string {
  if (![4, 6].includes(a.剪辑区间_方法)) { return ''; }
  const convert = (s: string) => { const n = seconds(s); return n !== undefined ? formatSeconds(n) : s.includes(':') ? '' : s.trim(); };
  const start = convert(a.剪辑区间_入点), end = convert(a.剪辑区间_出点);
  if (!start && !end) { return ''; }
  if (a.剪辑区间_方法 === 6) { const expression = start && end ? `not(between(t,${start},${end}))` : start ? `lt(t,${start})` : `gt(t,${end})`; return audio ? `aselect='${expression}',asetpts=N/SR/TB` : `select='${expression}',setpts=N/FRAME_RATE/TB`; }
  return `${audio ? 'atrim' : 'trim'}=${[start ? 'start=' + start : '', end ? 'end=' + end : ''].filter(Boolean).join(':')},${audio ? 'asetpts' : 'setpts'}=PTS-STARTPTS`;
}
export function buildGraph(a: Preset, input: string, output: string, firstPass = false, external?: string, outputReference = output): GraphResult {
  const graph: string[] = [], maps: string[][] = [], kept: string[][] = [], outputFilters: string[][] = [];
  const r: GraphResult = { graph: '', maps: [], outputFilters: [], video: [], audio: [], videoCount: 0, audioCount: 0, subtitleCount: 0, requestVideo: false, requestAudio: false, videoFiltered: false, audioFiltered: false };
  const linear = (chain: string[], from: string, out: string, prefix: string) => { let current = from; chain.forEach((f, i) => { const next = i === chain.length - 1 ? out : prefix + 'step' + i; graph.push(`[${current}]${f}[${next}]`); current = next; }); };
  const complexChain = (chain: string[], out: string, prefix: string): string[] | undefined => {
    if (chain.length === 1 && structural(chain[0]).complex) { graph.push(chain[0]); return structural(chain[0]).labels; }
    if (!structural(chain[0]).complex || chain.slice(1).some(f => structural(f).complex)) { return undefined; }
    const labels = structural(chain[0]).labels;
    if (!labels.length) { graph.push(chain.join(',')); return []; }
    if (labels.length !== 1) { const complex = chain.filter(f => structural(f).complex); graph.push(...complex); return complex.flatMap(f => structural(f).labels); }
    graph.push(chain[0]); let current = labels[0];
    chain.slice(1).forEach((f, i) => { const next = i === chain.length - 2 ? out : prefix + 'step' + (i + 1); graph.push(`[${current}]${f}[${next}]`); current = next; }); return [out];
  };
  const mapLabels = (labels: string[], type: string, enc: string[]) => { if (!labels.length) { enc.push(type + ':0'); } else { [...new Set(labels)].forEach((label, i) => { maps.push(['-map', `[${label}]?`]); enc.push(type + ':' + i); }); } };
  for (const type of ['v', 'a'] as const) {
    if (type === 'a' && firstPass) { continue; }
    const isAudio = type === 'a', label = isAudio ? '音频' : '视频', codec = isAudio ? audioCodec(a) : videoCodec(a), extra = isAudio ? audioExtra(a) : videoExtra(a);
    const streams = streamList(a[`流控制_将${label}参数应用于指定流`], type);
    const chain: string[] = a.滤镜排序系统.filter((x: Preset) => x.滤镜目标流类型 === (isAudio ? 2 : 1)).map((x: Preset) => clean(x.是自定义滤镜 || [101, 102].includes(x.滤镜标识符) ? substitute(x.自定义滤镜内容, input, outputReference) : filterFragment(a, x.滤镜标识符, input, outputReference, external))).filter(Boolean);
    const trim = !isAudio || streams.length || chain.length || a.音频参数_编码器_代号 ? trimFilter(a, isAudio) : '';
    if (trim) { chain.unshift(trim); }
    if (!streams.length && (chain.length || a[isAudio ? '音频参数_编码器_代号' : '视频参数_编码器_具体编码'] || extra)) { streams.push(`0:${type}:0`); }
    const keep = a[`流控制_启用保留其他${label}流`];
    const request = !codec?.是否禁用 && !!(chain.length || streams.length || keep || extra || codec?.命令行编码器名);
    const enc: string[] = [], simple = chain.length > 0 && !keep && chain.every(f => !structural(f).complex), complex = chain.some(f => structural(f).complex);
    if (request && !keep && chain.length && complex) {
      const labels = complexChain(chain, type + 'out0', type + '0');
      if (labels !== undefined) { mapLabels(labels, type, enc); }
      else { streams.forEach((s, i) => { const l = type + 'out' + i; linear(chain, s, l, type + i); maps.push(['-map', `[${l}]?`]); enc.push(type + ':' + i); }); }
    } else if (request && !keep) {
      streams.forEach((s, i) => { if (chain.length && !simple) { const l = type + 'out' + i; linear(chain, s, l, type + i); maps.push(['-map', `[${l}]?`]); } else { maps.push(['-map', optionalMap(s)]); } enc.push(type + ':' + i); });
      if (simple) { outputFilters.push(['-filter:' + type, chain.join(',')]); }
    } else if (request && !chain.length) { enc.push(...streams.map(s => selector(s, type))); }
    if (request && keep) {
      const keepStart = maps.length;
      if (chain.length) {
        const labels = complex ? complexChain(chain, type + 'keep0', type + 'keep') : undefined;
        if (labels !== undefined) { mapLabels(labels, type, enc); }
        else { streams.forEach((s, i) => { const l = type + 'keep' + i; linear(chain, s, l, l); maps.push(['-map', `[${l}]?`]); enc.push(type + ':' + i); }); }
      }
      maps.push(['-map', `0:${type}?`]);
      if (chain.length) { for (const s of streams) { maps.push(['-map', optionalMap('-' + s)]); } }
      if (!chain.length || codec && !codec.是否复制流 && !codec.是否禁用 && codec.命令行编码器名) { maps.push(['-c:' + type, 'copy']); }
      kept.push(...maps.splice(keepStart));
    }
    const uniqueEnc = [...new Map(enc.filter(Boolean).map(s => [s.toLowerCase(), s])).values()];
    Object.assign(r, isAudio ? { audio: uniqueEnc, requestAudio: request, audioFiltered: chain.length > 0, audioCount: request ? keep ? -1 : enc.length || streams.length : 0 } : { video: uniqueEnc, requestVideo: request, videoFiltered: chain.length > 0, videoCount: request ? keep ? -1 : enc.length || streams.length : 0 });
  }
  if (!firstPass) {
    const streams = streamList(a.流控制_将字幕参数应用于指定流, 's'), keep = a.流控制_启用保留其他字幕流;
    if (!keep) { streams.forEach(s => maps.push(['-map', optionalMap(s)])); }
    maps.push(...kept);
    if (keep) { maps.push(['-map', '0:s?'], ['-c:s', 'copy']); }
    const codec = subtitleCodec(['', 'copy', 'mov_text', 'srt', 'ass', 'ssa'][a.流控制_如何操作指定的字幕] || '', a, output);
    if (codec && streams.length) { if (keep) { for (const s of [...new Set(streams.map(s => selector(s, 's')))]) { maps.push(['-c:' + s, codec]); } } else { maps.push(['-c:s', codec]); } }
    r.subtitleCount = keep ? -1 : streams.length;
  }
  else { maps.push(...kept); }
  r.graph = graph.join(';'); r.maps = [...new Map(maps.map(pair => [JSON.stringify(pair), pair])).values()].flat(); r.outputFilters = [...new Map(outputFilters.map(pair => [JSON.stringify(pair), pair])).values()].flat();
  return r;
}
