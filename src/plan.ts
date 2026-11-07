import type { CommandPlan, CommandStage, ExecutionContext, InputTask, Issue, PlannedTask, Preset, PresetDocument, StreamSummary } from './types';
import { clone, data } from './preset';
import { normalizeOrder, subtitleCandidates } from './filters';
import { buildGraph, summarizeStreams } from './graph';
import { audioCodec, encode, twoPass, videoCodec } from './codecs';
import { extraOutputs } from './extra';
import { add, argumentReads, presetArguments } from './arguments';
import { dirname, extension, filename, filterOptionValue, filterPath, formatSeconds, isAbsolute, isPlaceholder, isPresetPathField, isProtocol, join, pathKey, pathStyle, relativeSubdirectory, seconds, splitTrailingSerial, stem, windowsAbsolute, withoutExtension } from './paths';
import { sourceText, type Translate } from './i18n';

export function defaultContext(): ExecutionContext {
  const now = new Date(); const pad = (n: number) => String(n).padStart(2, '0');
  return { platform: 'windows', shell: 'powershell', ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', cwd: '', outputDirectory: '', inputs: [{ id: crypto.randomUUID().replaceAll('-', ''), path: '' }], pathMappings: [], resources: {}, confirmedPaths: [], clock: `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}-${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`, nonce: crypto.randomUUID().replaceAll('-', '') };
}
export function mapPath(path: string, c: ExecutionContext): string {
  if (!path || isProtocol(path)) { return path; }
  let best: { prefix: string; to: string; windows: boolean } | undefined;
  for (const { from, to } of c.pathMappings) {
    if (!from || !to) { continue; }
    const windows = windowsAbsolute(from) || !from.startsWith('/') && from.includes('\\');
    const key = (value: string) => windows ? value.replaceAll('\\', '/').toLowerCase() : value;
    const prefix = from.replace(windows ? /[\\/]+$/ : /\/+$/, '');
    if (best && prefix.length <= best.prefix.length) { continue; }
    if (key(path) === key(prefix) || key(path).startsWith(key(prefix) + '/')) { best = { prefix, to, windows }; }
  }
  if (!best) { return path; }
  const tail = path.slice(best.prefix.length).replace(best.windows ? /^[\\/]+/ : /^\/+/, '');
  return tail ? join(best.to, best.windows ? tail.replace(/[\\/]/g, c.platform === 'windows' ? '\\' : '/') : tail, c.platform === 'windows' ? '\\' : '/') : best.to;
}

// Resolve each original path against an already mapped working directory.
function resolvePath(path: string, c: ExecutionContext): string {
  if (!path || isProtocol(path) || isAbsolute(path, c.platform === 'windows') || !c.cwd || /^[a-z]:/i.test(path)) { return path; }
  if (c.platform === 'windows' && /^[\\/]/.test(path)) {
    const root = c.cwd.match(/^(?:[a-z]:|[\\/]{2}[^\\/]+[\\/][^\\/]+)/i)?.[0];
    return root ? root + path : path;
  }
  return join(c.cwd, path, c.platform === 'windows' ? '\\' : '/');
}

export function resolvedInput(task: InputTask, c: ExecutionContext): string {
  return resolvePath(mapPath(task.path.trim(), c), { ...c, cwd: mapPath(c.cwd, c) });
}
export function associatedProbe(task: InputTask, resolvedPath: string) {
  const probe = task.probe;
  return probe?.path === task.path && (probe.resolvedPath ?? task.path) === resolvedPath ? probe.data : undefined;
}
export function probeStage(input: string, taskId: string, c: ExecutionContext, t: Translate = sourceText): CommandStage { return { name: t('探测媒体信息'), kind: 'probe', executable: c.ffprobe, args: ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', input], graph: '', maps: [], taskId }; }
function clip(a: Preset): { before: string[]; after: string[] } {
  const before: string[] = [], after: string[] = [], start = a.剪辑区间_入点.trim(), end = a.剪辑区间_出点.trim(), mode = a.剪辑区间_方法;
  if (!start && !end) { return { before, after }; }
  const common = (to: string[]) => { add(to, '-ss', start); add(to, '-to', end); };
  if (mode === 1) { common(before); }
  if (mode === 2) { common(after); }
  if (mode === 3) {
    const s = seconds(start), back = seconds(a.剪辑区间_向前解码多久秒);
    if (start && s !== undefined && back !== undefined && back > 0) { const seek = Math.max(0, s - back); add(before, '-ss', formatSeconds(seek)); add(after, '-ss', formatSeconds(s - seek)); if (end) { const e = seconds(end); add(after, '-to', e === undefined ? end : formatSeconds(Math.max(0, e - seek))); } }
    else { common(before); }
  }
  if (mode === 5) { add(before, '-ss', start); const e = seconds(end), s = seconds(start); add(before, '-t', e === undefined ? end : formatSeconds(Math.max(0, e - (s ?? 0)))); }
  return { before, after };
}
function nameFor(a: Preset, input: string, c: ExecutionContext, taskId: string): string {
  let name = (a.输出命名_开头文本 || '') + (a.输出命名_替代文本 || stem(input, pathStyle(c.platform)) || 'output') + a.输出命名_结尾文本;
  const mode = a.输出_自动命名选项;
  if (mode === 1) { name = name.replace(/_\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}$/, '') + '_' + c.clock; }
  else if (mode === 2) { name += '~1'; }
  else if (mode === 3) { name += '_3fui'; }
  else if (mode === 4) {
    const parts = [a.视频参数_编码器_具体编码, a.视频参数_编码器_编码预设, a.视频参数_质量控制_参数名 && a.视频参数_质量控制_值 ? a.视频参数_质量控制_参数名.replace(/^-+/, '') + a.视频参数_质量控制_值 : '', a.视频参数_比特率_基础, a.视频参数_比特率_最低值 ? 'L' + a.视频参数_比特率_最低值 : '', a.视频参数_比特率_最高值 ? 'H' + a.视频参数_比特率_最高值 : '', a.视频参数_比特率_缓冲区 ? 'BF' + a.视频参数_比特率_缓冲区 : ''].filter(Boolean); if (parts.length) { name += '.' + parts.join('.'); }
  } else if (mode >= 5 && mode <= 10) {
    const alphabet = (mode - 5) % 3 === 0 ? '0123456789' : (mode - 5) % 3 === 1 ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' : '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const seed = c.nonce + taskId; let state = 2166136261; for (const ch of seed) { state = Math.imul(state ^ ch.charCodeAt(0), 16777619); }
    let suffix = ''; for (let i = 0; i < (mode <= 7 ? 8 : 16); i++) { state = Math.imul(state ^ (state >>> 13), 16777619); suffix += alphabet[(state >>> 0) % alphabet.length]; } name += '_' + suffix;
  }
  return name.replace(c.platform === 'windows' ? /[<>:"/\\|?*\x00-\x1f]/g : /[\/\x00]/g, '_') || 'output';
}
export const localFile = (path: string) => !!path && path !== '-' && !isPlaceholder(path) && !isProtocol(path);
export const incrementalNaming = (mode: number) => [1, 2, 11, 12].includes(mode);

function uniqueOutput(base: string, ext: string, mode: number, used: Set<string>, key: (s: string) => string, ranges: Map<string, [bigint, bigint]>): string {
  let candidate = base + ext;
  const numbered = mode === 11 || mode === 12;
  if (numbered || used.has(key(candidate))) {
    const { base: name, digits } = splitTrailingSerial(base);
    const width = numbered ? Math.max(mode === 11 ? 2 : 3, digits.length) : 0;
    const prefix = numbered ? name : base.replace(/~\d+$/, '') + '~';
    const previous = numbered ? BigInt(digits || '0') : 0n;
    // 3FUI reads the existing suffix as a signed 64-bit integer.
    let serial = previous < 9223372036854775807n ? previous + 1n : 1n;
    // 只缓存实际检查过的连续区间，保留不同任务的起点及区间之前的空洞。
    // 使用原始前后缀分组，避免把带尾空格的前缀当完整路径规范化后错误合并。
    const group = JSON.stringify([prefix, ext, width]);
    const range = ranges.get(group);
    const start = serial;
    while (true) {
      if (range && serial >= range[0] && serial <= range[1]) { serial = range[1] + 1n; }
      candidate = prefix + serial.toString().padStart(width, '0') + ext;
      if (!used.has(key(candidate))) { break; }
      serial++;
    }
    ranges.set(group, range && start <= range[1] + 1n && serial + 1n >= range[0]
      ? [start < range[0] ? start : range[0], serial > range[1] ? serial : range[1]] : [start, serial]);
  }
  used.add(key(candidate)); return candidate;
}
async function passlog(input: string, output: string, c: ExecutionContext): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input + '|' + output));
  const token = [...new Uint8Array(hash).slice(0, 6)].map(n => n.toString(16).padStart(2, '0')).join('');
  return join(dirname(input, pathStyle(c.platform)) || c.cwd || '.', `3fui-v6-passlog-${(stem(input, pathStyle(c.platform)) || 'input').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}-${token}`, c.platform === 'windows' ? input : 'posix');
}
export async function buildPlan(doc: PresetDocument, context: ExecutionContext, t: Translate = sourceText, allowOverwrite = false): Promise<CommandPlan> {
  const c = clone(context), a = clone(doc.normalized), issues: Issue[] = [...doc.issues], tasks: PlannedTask[] = [], probes: CommandStage[] = [], unconfirmed: { path: string; field: string }[] = [];
  const style = pathStyle(c.platform);
  c.cwd = mapPath(c.cwd, c);
  const executionPath = (path: string) => resolvePath(mapPath(path, c), c);
  const executablePath = (path: string) => /[\\/]/.test(path) ? executionPath(path) : mapPath(path, c);
  c.ffmpeg = executablePath(c.ffmpeg); c.ffprobe = executablePath(c.ffprobe);
  const problem = (level: Issue['level'], message: string, field?: string) => issues.push({ level, message, field });
  if (c.platform !== 'windows' && ['powershell5', 'cmd'].includes(c.shell)) { problem('error', t('Windows PowerShell 5.1 和 CMD 需要 Windows 目标系统')); }
  if (c.platform === 'windows' && ['bash', 'zsh'].includes(c.shell)) { problem('error', t('Bash/Zsh 输出面向 Linux/macOS；Windows 请使用 PowerShell 或 CMD。Git Bash 的原生进程路径转换不在兼容范围内。')); }
  if (!c.ffmpeg.trim()) { problem('missing', t('请填写 FFmpeg 程序路径')); }
  if (c.cwd && !isAbsolute(c.cwd, c.platform === 'windows')) { problem('missing', t('工作目录必须填写目标系统的绝对路径，以避免相对路径被重复解释')); }
  if (c.platform !== 'windows' && [c.cwd, c.ffmpeg, c.ffprobe].some(p => /^[A-Za-z]:[\\/]/.test(p))) { problem('missing', t('工作目录或工具程序仍是 Windows 路径，请填写目标系统路径或显式映射')); }
  if (c.platform !== 'windows' && a.输出命名_保留创建时间) { problem('error', t('目标系统的创建时间保留尚不支持；请在当前预设中明确取消该设置')); }
  if (a.音频参数_编码器_代号 && !/^$/.test(a.音频参数_编码器_代号) && !doc.issues.length) {
    if (!audioCodec(a)) { problem('error', t('未知音频私有 ID：{0}；请从音频编码器列表选择', a.音频参数_编码器_代号)); }
  }
  if (a.视频参数_编码器_具体编码 && !/^[a-z0-9_.-]+$/i.test(a.视频参数_编码器_具体编码) && !Object.hasOwn(data.video, a.视频参数_编码器_具体编码)) { problem('error', t('未知视频编码器名称含空格或特殊字符，请将附加选项填写到自定义视频参数中')); }
  // Map only explicitly declared resource paths. The original imported JSON remains untouched.
  const mapResources = (obj: Preset) => {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && isPresetPathField(k) && v) {
        const mapped = mapPath(v, c);
        obj[k] = resolvePath(mapped, c);
        if ((windowsAbsolute(v) || v.startsWith('/')) && mapped === v && (!c.confirmedPaths.includes(v) || c.platform !== 'windows' && windowsAbsolute(v))) {
          unconfirmed.push({ path: obj[k], field: k });
        }
      } else if (v && typeof v === 'object') {
        if (Array.isArray(v)) { v.filter(x => x && typeof x === 'object').forEach(mapResources); }
        else { mapResources(v); }
      }
    }
  };
  mapResources(a);
  c.resources = Object.create(null);
  for (const [key, content] of Object.entries(context.resources)) {
    const mapped = executionPath(key);
    if (c.resources[mapped] !== undefined && c.resources[mapped] !== content) { problem('error', t('模板资源映射发生冲突：{0}', mapped)); }
    else { c.resources[mapped] = content; }
  }
  normalizeOrder(a);
  const custom = a.自定义参数_完全自己写.trim();
  const phases = custom || !twoPass(a) ? ['single'] as const : ['pass1', 'pass2'] as const;
  const customArguments = ['开头参数', '之前参数', '之后参数', '最后参数', '视频参数', '音频参数'].some(name => a['自定义参数_' + name].trim());
  const managed = !custom && a.输出_输出文件参数使用方法 === 0;
  if (custom || a.输出_输出文件参数使用方法 === 1) { problem('info', t('请检查自定义输出路径，Forge 仅保护由页面生成的本地输出文件。')); }
  if (!custom && [4, 6].includes(a.剪辑区间_方法)) { for (const key of ['剪辑区间_入点', '剪辑区间_出点']) { if (a[key].includes(':') && seconds(a[key]) === undefined) { problem('error', t('{0} 的时间格式无法解析，请使用有效的 hh:mm:ss 或小数秒，避免省略剪辑区间', key), key); } } }
  const windows = c.platform === 'windows';
  const key = (path: string) => pathKey(path, windows);
  const outputMarker = '\uE000' + crypto.randomUUID() + '\uE001';
  const argumentFields = ['开头参数', '之前参数', '之后参数', '最后参数', '视频参数', '音频参数'].map(name => a['自定义参数_' + name]);
  const literalMapping = c.pathMappings.length ? (arg: string) => mapPath(arg, c) : undefined;
  const autoSubtitle = ['SRT', 'ASS', 'SSA'].some(k => a['流控制_自动混流' + k]);
  const inputs = c.inputs.map(task => {
    const input = executionPath(task.path.trim());
    const external = task.subtitle ? executionPath(task.subtitle) : undefined;
    const sidecars = autoSubtitle ? (task.sidecars || []).filter(file => a['流控制_自动混流' + extension(file, style).slice(1).toUpperCase()]).map(executionPath) : [];
    const reads = [input];
    const parsed = new Map<string, string[]>();
    let opaqueReads = false;
    for (const text of custom ? [custom] : argumentFields) {
      const args = presetArguments(text, input, outputMarker, literalMapping, style);
      parsed.set(text, args);
      const scan = argumentReads(args);
      opaqueReads ||= scan.opaque;
      for (const index of scan.indices) {
        const path = args[index];
        if (path.includes(outputMarker)) { opaqueReads = true; continue; }
        reads.push(resolvePath(path, c));
      }
    }
    if (!custom) {
      if (a.视频参数_烧录字幕_滤镜选择 && a.视频参数_烧录字幕_字幕来源是外部文件 === 1 && external) { reads.push(external); }
      if (a.章节_来源) { reads.push(a.章节_文件路径.trim()); }
      reads.push(...sidecars, ...a.附件_要写入的附件.filter((item: Preset) => item.类型).map((item: Preset) => item.文件路径.trim()));
      reads.push(...a.视频参数_超分_滤镜叠加策略组.map((item: Preset) => item.着色器文件路径).filter(Boolean));
    }
    return { task, input, external, sidecars, parsed, opaqueReads, reads: [...new Set(reads.filter(Boolean))] };
  });
  const sourceTasks = new Map(inputs.flatMap(({ reads }, i) => reads.filter(localFile).map(path => [key(path), i + 1] as const)));
  const used = new Set<string>();
  const serialRanges = new Map<string, [bigint, bigint]>();
  const fixedTasks = new Map<string, number>();
  const outputDirectory = executionPath(c.outputDirectory) || a.输出位置 || a.输出目录;
  if (!c.inputs.length) { problem('missing', t('请添加至少一个输入文件')); }
  const entries = inputs.map((entry, i) => {
    const { task } = entry;
    const input = entry.input || t('<输入文件>');
    if (!task.path.trim()) { problem('missing', t('请填写输入文件的实际执行路径')); }
    if (c.platform !== 'windows' && /^[A-Za-z]:[\\/]/.test(input)) { problem('missing', t('Windows 路径需要显式映射：{0}', input)); }
    const explicitOutput = task.output ? executionPath(task.output) : '';
    const ext = extension(explicitOutput, style).slice(1) || a.输出容器.trim().replace(/^\./, '') || extension(input, style).slice(1);
    if (!ext && managed) { problem('missing', t('请设置输出容器或指定带后缀的输出文件')); }
    const inputDirectory = isProtocol(input) ? c.cwd : dirname(input, style);
    let dir = outputDirectory || inputDirectory;
    if (outputDirectory && a.输出位置_保留子文件夹结构起始点.trim()) {
      const relative = relativeSubdirectory(inputDirectory, a.输出位置_保留子文件夹结构起始点, c.cwd, windows);
      if (relative) { dir = join(dir, relative, windows ? '\\' : '/'); }
    }
    if (c.platform !== 'windows' && /^[A-Za-z]:[\\/]/.test(dir)) { problem('missing', t('输出目录仍是 Windows 路径，请显式映射到目标系统')); }
    const candidateStem = nameFor(a, input, c, task.id);
    const naming = explicitOutput ? 0 : a.输出_自动命名选项;
    const base = join(dir, candidateStem, windows ? '\\' : '/');
    const suffix = ext ? '.' + ext : '';
    const fixed = explicitOutput || base + suffix;
    if (managed && !localFile(fixed)) { problem('error', t('任务 {0} 的输出必须是本地文件：{1}', i + 1, fixed)); }
    if (managed && !incrementalNaming(naming) && localFile(fixed)) {
      const id = key(fixed), source = sourceTasks.get(id), previous = fixedTasks.get(id);
      if (source !== undefined) { problem('error', t('任务 {0} 的输出与任务 {1} 的输入相同：{2}', i + 1, source, fixed)); }
      if (previous !== undefined) { problem('error', t('任务 {0} 与任务 {1} 使用同一输出文件：{2}', i + 1, previous, fixed)); }
      fixedTasks.set(id, i + 1);
    }
    return { ...entry, input, candidateStem, naming, base, suffix, fixed };
  });
  for (const id of sourceTasks.keys()) { used.add(id); }
  for (const id of fixedTasks.keys()) { used.add(id); }
  for (const { task, input, external, sidecars, reads, parsed, candidateStem, naming, base, suffix, fixed, opaqueReads } of entries) {
    const output = incrementalNaming(naming) ? uniqueOutput(base, suffix, naming, managed ? used : new Set(), key, managed ? serialRanges : new Map()) : fixed;
    if (c.platform !== 'windows' && /^[A-Za-z]:[\\/]/.test(output)) { problem('missing', t('指定输出文件仍是 Windows 路径，请显式映射到目标系统')); }
    if (!custom) {
      const actualExt = extension(output, style).toLowerCase(), matroska = ['.mkv', '.mka', '.mks', '.mk3d'].includes(actualExt), cover = matroska || ['.mp4', '.m4v', '.m4a', '.mov', '.3gp', '.3g2'].includes(actualExt);
      for (const item of a.附件_要写入的附件) { if (!item.类型) { continue; } if (!item.文件路径.trim()) { problem('missing', t('附件已选择类型，请补充文件路径')); } else if (item.类型 === 2 ? !cover : !matroska) { problem('error', t('输出容器无法保存该附件：{0}', item.文件路径)); } else if (item.类型 === 2 && a.流控制_启用保留其他视频流 && !videoCodec(a)?.是否禁用) { problem('error', t('附加封面图需要确定输出视频数量；请使用明确的视频流选择并关闭“保留其他视频流”')); } }
    }
    const probe = associatedProbe(task, input);
    probes.push(probeStage(input, task.id, c, t));
    if (!custom && [5, 6].includes(a.剪辑区间_方法) && (probe?.format?.duration === undefined || probe?.format?.duration === null || probe?.format?.duration === '' || !Number.isFinite(Number(probe?.format?.duration)))) { problem('missing', t('{0}：此剪辑方式需要导入 ffprobe 时长信息', filename(input, style))); }
    if (!custom && external && c.platform !== 'windows' && /^[A-Za-z]:[\\/]/.test(external)) { problem('missing', t('外部字幕仍是 Windows 路径，请显式映射到目标系统')); }
    if (!custom && a.视频参数_烧录字幕_滤镜选择 && !a.视频参数_烧录字幕_自己写滤镜取代所有设置) {
      if (a.视频参数_烧录字幕_字幕来源是外部文件 === 1 && !external) { problem('missing', t('{0}：请选择实际字幕路径；候选 {1}', filename(input, style), subtitleCandidates(a, input, style).join('、'))); }
      if (a.视频参数_烧录字幕_字幕来源是外部文件 === 2 && (!probe || !a.视频参数_烧录字幕_指定内嵌的流)) { problem('missing', t('{0}：内嵌字幕需要 ffprobe 信息和字幕流编号', filename(input, style))); }
      if (!a.视频参数_烧录字幕_字幕来源是外部文件) { problem('missing', t('烧录字幕已启用，请选择字幕来源')); }
    }
    if (!custom && autoSubtitle && !task.sidecarsConfirmed) { problem('missing', t('{0}：请确认同名字幕清单（可以为空）', filename(input, style))); }
    const assets: { path: string; content: string }[] = [];
    let mainInput = input, vapour = false;
    if (!custom) {
      for (const [kind, suffix] of [['AviSynth', 'avs'], ['VapourSynth', 'vpy']] as const) {
        if (!a['视频参数_视频帧服务器_使用' + kind]) { continue; }
        const template = a['视频参数_视频帧服务器_' + suffix + '脚本文件'];
        const content = c.resources[template] ?? c.resources[filename(template, style)];
        if (!template || content === undefined) { problem('missing', t('{0}：请导入脚本模板文件', kind)); }
        const scriptPath = withoutExtension(input, style) + '.' + task.id.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') + (kind === 'AviSynth' ? '.avs' : extension(template, style) || '.vpy');
        assets.push({ path: scriptPath, content: (content || '').replaceAll('<FilePath>', () => input) });
        if (mainInput === input) { mainInput = scriptPath; vapour = kind === 'VapourSynth'; }
      }
    }
    const stages: CommandStage[] = [];
    const log = phases.length === 2 ? await passlog(input, output, c) : '';
    const appendCustom = (args: string[], text: string) => { args.push(...(parsed.get(text) ?? [])); };
    let streams: StreamSummary | undefined;
    for (const phase of phases) {
      const args: string[] = [];
      let graph = '', maps: string[] = [], overwriteArg: number | undefined;
      let assetArg: number | undefined, mediaOutputArg: number | undefined, passlogArg: number | undefined;
      if (custom) {
        appendCustom(args, custom);
        streams = summarizeStreams(args, true);
      }
      else {
        const clipping = clip(a), g = buildGraph(a, input, output, phase === 'pass1', external, outputMarker, style), extra = phase === 'pass1' ? { inputs: [], outputs: [] } : extraOutputs(a, g, input, output, sidecars, outputMarker, style);
        appendCustom(args, a.自定义参数_开头参数);
        args.push('-hide_banner');
        if (managed && phase !== 'pass1') { overwriteArg = args.length; }
        args.push(overwriteArg === undefined ? '-y' : '-n', ...clipping.before);
        for (const [name, value] of [['-hwaccel', a.解码参数_解码器], ['-threads', a.解码参数_CPU解码线程数], ['-hwaccel_output_format', a.解码参数_解码数据格式], [a.解码参数_指定硬件的参数名, a.解码参数_指定硬件的参数]]) { add(args, name, value); }
        if (vapour) { add(args, '-f', 'vapoursynth'); }
        if (assets.length) { assetArg = args.length + 1; }
        add(args, '-i', mainInput);
        appendCustom(args, a.自定义参数_之前参数);
        args.push(...extra.inputs, ...clipping.after);
        if (g.graph) { add(args, '-filter_complex', g.graph); }
        args.push(...g.maps, ...g.outputFilters, ...encode(a, g, phase, log, appendCustom));
        if (phase !== 'single') { passlogArg = args.length - 1; }
        if (phase === 'pass1') { args.push('-an'); }
        args.push(...extra.outputs);
        appendCustom(args, a.自定义参数_之后参数);
        if (phase === 'pass1' || a.输出_输出文件参数使用方法 === 2) { args.push('-f', 'null', c.platform === 'windows' ? 'NUL' : '/dev/null'); }
        else if (managed) { mediaOutputArg = args.length; args.push(outputMarker); }
        appendCustom(args, a.自定义参数_最后参数);
        graph = g.graph; maps = g.maps;
        if (phase !== 'pass1' && a.输出_输出文件参数使用方法 !== 2) {
          streams = summarizeStreams(args, !!graph || customArguments || !managed, 'subtitleInputs' in extra ? extra.subtitleInputs : undefined, assets.length ? undefined : probe);
        }
      }
      const outputArgs: Record<number, string[]> = {};
      for (let i = 0; i < args.length; i++) {
        if (!args[i].includes(outputMarker)) { continue; }
        const parts = args[i].split(outputMarker);
        outputArgs[i] = parts;
        args[i] = parts.join(output);
      }
      if (overwriteArg !== undefined && args.some((arg, i) => arg === '-y' && i !== overwriteArg)) { problem('error', t('请移除附加参数中的 -y，并使用本次任务的覆盖设置。')); }
      if (c.platform !== 'windows' && args.some(p => /^[A-Za-z]:[\\/]/.test(p))) { problem('missing', t('命令中的资源仍有 Windows 路径，请显式映射到目标系统')); }
      if (args.some(p => /<(?:输入文件|输出文件|媒体总时长|InputFile[^>]*|OutputFile|字幕文件[^>]*)>/.test(p))) { problem('missing', t('{0}：命令仍有未解析的占位符', filename(input, style))); }
      if (args.some(p => p.includes('\0')) || c.ffmpeg.includes('\0')) { problem('error', t('参数和程序路径不能包含 NUL 字符')); }
      stages.push({ name: phase === 'pass1' ? t('两遍编码 · 第一遍') : phase === 'pass2' ? t('两遍编码 · 第二遍') : t('执行转码'), kind: phase, executable: c.ffmpeg, args, graph: graph.replaceAll(outputMarker, () => output), maps, taskId: task.id, outputArgs, overwriteArg, mediaOutputArg, assetArg, passlogArg });
    }
    const stagedOutput = managed && localFile(output) && !/%(?:0?\d+)?d/.test(output) && !/\.(?:m3u8?|mpd|ism[l]?|f4m)$/i.test(output)
      && !stages.some(stage => stage.args.some((arg, i, args) => arg === '-f' && /^(?:hls|dash|(?:s|stream_)?segment|tee|fifo|image2pipe|smoothstreaming|webm_chunk|hds)$/i.test(args[i + 1])));
    if (managed && !stagedOutput) { problem('info', t('序列或分段输出的衍生文件需自行检查，完整脚本不会授权覆盖。')); }
    for (const stage of stages) {
      for (const index of argumentReads(stage.args).indices) {
        if (index !== stage.assetArg) { reads.push(resolvePath(stage.args[index], c)); }
      }
    }
    tasks.push({ id: task.id, input, output, directory: dirname(output, style), stages, assets, preserve: { creation: a.输出命名_保留创建时间, modification: a.输出命名_保留修改时间, access: a.输出命名_保留访问时间 }, naming, candidateStem, extension: suffix, managedOutput: managed && localFile(output), stagedOutput, reads: [...new Set(reads)], opaqueReads, streams });
  }
  const allReads = new Map(tasks.flatMap((task, index) => (task.reads ?? []).filter(localFile).map(path => [key(path), index + 1] as const)));
  for (const [index, task] of tasks.entries()) {
    const source = allReads.get(key(task.output));
    if (task.managedOutput && source !== undefined) { problem('error', t('任务 {0} 的输出与任务 {1} 的输入相同：{2}', index + 1, source, task.output)); }
  }
  const opaque = tasks.some(task => task.opaqueReads || task.reads?.some(path => !localFile(path)));
  if (opaque && managed) { problem('info', t('部分输入或自定义资源无法完整枚举，覆盖授权已禁用。')); }
  for (const item of unconfirmed) {
    const spellings = [item.path, filterPath(item.path, style), filterOptionValue(item.path)];
    if (tasks.some(task => task.stages.some(stage => stage.args.some(arg => spellings.some(path => arg.includes(path)))))) {
      problem('missing', c.platform !== 'windows' && /^[A-Za-z]:/.test(item.path) ? t('Windows 资源路径需要显式映射：{0}', item.path) : t('请确认预设路径用于当前环境：{0}', item.path), item.field);
    }
  }
  const uniqueIssues = [...new Map(issues.map(i => [i.level + i.message, i])).values()];
  return { status: uniqueIssues.some(i => i.level === 'error') ? 'incompatible' : uniqueIssues.some(i => i.level === 'missing') ? 'missing' : 'ready', issues: uniqueIssues, tasks, probes, context: c, preset: a, allowOverwrite: allowOverwrite && !opaque };
}
