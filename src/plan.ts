import type { CommandPlan, CommandStage, ExecutionContext, InputTask, Issue, PlannedTask, Preset, PresetDocument } from './types';
import { clone, data } from './preset';
import { normalizeOrder, subtitleCandidates } from './filters';
import { buildGraph } from './graph';
import { audioCodec, encode, twoPass, videoCodec } from './codecs';
import { extraOutputs } from './extra';
import { add, parseArguments, raw } from './arguments';
import { dirname, extension, filename, filterPath, formatSeconds, join, seconds, stem, substitute, withoutExtension } from './paths';

export function defaultContext(): ExecutionContext {
  const now = new Date(); const pad = (n: number) => String(n).padStart(2, '0');
  return { platform: 'windows', shell: 'powershell', ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', cwd: '', outputDirectory: '', inputs: [{ id: crypto.randomUUID().replaceAll('-', ''), path: '' }], pathMappings: [], resources: {}, confirmedPaths: [], clock: `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}-${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`, nonce: crypto.randomUUID().replaceAll('-', '') };
}
export function mapPath(path: string, c: ExecutionContext): string {
  const mapping = [...c.pathMappings].filter(m => m.from).sort((a, b) => b.from.length - a.from.length).find(m => path === m.from || path.startsWith(m.from.replace(/[\\/]+$/, '') + '/') || path.startsWith(m.from.replace(/[\\/]+$/, '') + '\\'));
  if (!mapping) { return path; }
  const sep = c.platform === 'windows' ? '\\' : '/';
  return mapping.to.replace(/[\\/]+$/, '') + path.slice(mapping.from.replace(/[\\/]+$/, '').length).replace(/[\\/]/g, sep);
}
export function resolvedInput(task: InputTask, c: ExecutionContext): string {
  const mapped = mapPath(task.path.trim(), c);
  return !mapped || /^(?:[A-Za-z]:[\\/]|[\\/]|[a-z][a-z0-9+.-]*:)/i.test(mapped) || !c.cwd ? mapped : join(mapPath(c.cwd, c), mapped, c.platform === 'windows' ? '\\' : '/');
}
export function probeStage(input: string, taskId: string, c: ExecutionContext): CommandStage { return { name: '探测媒体信息', kind: 'probe', executable: c.ffprobe, args: ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', input], graph: '', maps: [], taskId }; }
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
  let name = (a.输出命名_开头文本 || '') + (a.输出命名_替代文本 || stem(input) || 'output') + a.输出命名_结尾文本;
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
function uniqueOutput(base: string, ext: string, mode: number, used: Set<string>, platform: string): string {
  const key = (s: string) => platform === 'windows' ? s.toLowerCase() : s;
  let candidate = base + ext, i = 1;
  if ([11, 12].includes(mode)) { const trailing = base.match(/\d+$/)?.[0] || ''; const width = Math.max(mode === 11 ? 2 : 3, trailing.length); i = trailing ? Number(trailing) + 1 : 1; base = base.slice(0, base.length - trailing.length); candidate = base + String(i).padStart(width, '0') + ext; while (used.has(key(candidate))) { candidate = base + String(++i).padStart(width, '0') + ext; } }
  else if ([1, 2].includes(mode)) { const name = base.replace(/~\d+$/, ''); while (used.has(key(candidate))) { candidate = name + '~' + i++ + ext; } }
  used.add(key(candidate)); return candidate;
}
async function passlog(input: string, output: string, c: ExecutionContext): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input + '|' + output));
  const token = [...new Uint8Array(hash).slice(0, 6)].map(n => n.toString(16).padStart(2, '0')).join('');
  return join(dirname(input) || c.cwd || '.', `3fui-v6-passlog-${(stem(input) || 'input').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}-${token}`, input);
}
export async function buildPlan(doc: PresetDocument, context: ExecutionContext): Promise<CommandPlan> {
  const c = clone(context), a = clone(doc.normalized), issues: Issue[] = [...doc.issues], tasks: PlannedTask[] = [], probes: CommandStage[] = [], unconfirmed: { path: string; field: string }[] = [];
  c.cwd = mapPath(c.cwd, c); c.ffmpeg = mapPath(c.ffmpeg, c); c.ffprobe = mapPath(c.ffprobe, c);
  const problem = (level: Issue['level'], message: string, field?: string) => issues.push({ level, message, field });
  if (c.platform !== 'windows' && ['powershell5', 'cmd'].includes(c.shell)) { problem('error', 'Windows PowerShell 5.1 和 CMD 需要 Windows 目标系统'); }
  if (c.platform === 'windows' && ['bash', 'zsh'].includes(c.shell)) { problem('error', 'Bash/Zsh 输出面向 Linux/macOS；Windows 请使用 PowerShell 或 CMD。Git Bash 的原生进程路径转换不在兼容范围内。'); }
  if (!c.ffmpeg.trim()) { problem('missing', '请填写 FFmpeg 程序路径'); }
  if (c.cwd && !/^(?:[A-Za-z]:[\\/]|[\\/])/.test(c.cwd)) { problem('missing', '工作目录必须填写目标系统的绝对路径，以避免相对路径被重复解释'); }
  if (c.platform !== 'windows' && [c.cwd, c.ffmpeg, c.ffprobe].some(p => /^[A-Za-z]:[\\/]/.test(p))) { problem('missing', '工作目录或工具程序仍是 Windows 路径，请填写目标系统路径或显式映射'); }
  if (c.platform !== 'windows' && a.输出命名_保留创建时间) { problem('error', '目标系统的创建时间保留尚不支持；请在当前预设中明确取消该设置'); }
  if (a.音频参数_编码器_代号 && !/^$/.test(a.音频参数_编码器_代号) && !doc.issues.length) {
    if (!audioCodec(a)) { problem('error', `未知音频私有 ID：${a.音频参数_编码器_代号}；请从音频编码器列表选择`); }
  }
  if (a.视频参数_编码器_具体编码 && !/^[a-z0-9_.-]+$/i.test(a.视频参数_编码器_具体编码) && !Object.hasOwn(data.video, a.视频参数_编码器_具体编码)) { problem('error', '未知视频编码器名称含空格或特殊字符，请将附加选项填写到自定义视频参数中'); }
  // Map only explicitly declared resource paths. The original imported JSON remains untouched.
  const mapResources = (obj: Preset) => { for (const [k, v] of Object.entries(obj)) { if (typeof v === 'string' && /文件路径|文件夹|脚本文件|输出位置/.test(k) && v) { obj[k] = mapPath(v, c); if (/^(?:[A-Za-z]:[\\/]|[\\/])/.test(v) && (!c.confirmedPaths.includes(v) || c.platform !== 'windows' && /^[A-Za-z]:/.test(v)) && obj[k] === v) { unconfirmed.push({ path: v, field: k }); } } else if (v && typeof v === 'object') { if (Array.isArray(v)) { v.filter(x => x && typeof x === 'object').forEach(mapResources); } else { mapResources(v); } } } };
  mapResources(a);
  for (const [key, content] of Object.entries(context.resources)) {
    const mapped = mapPath(key, c);
    if (c.resources[mapped] !== undefined && c.resources[mapped] !== content) { problem('error', `模板资源映射发生冲突：${mapped}`); }
    else { c.resources[mapped] = content; }
  }
  normalizeOrder(a);
  if (!a.自定义参数_完全自己写.trim() && [4, 6].includes(a.剪辑区间_方法)) { for (const key of ['剪辑区间_入点', '剪辑区间_出点']) { if (a[key].includes(':') && seconds(a[key]) === undefined) { problem('error', `${key} 的时间格式无法解析，请使用有效的 hh:mm:ss 或小数秒，避免省略剪辑区间`, key); } } }
  const used = new Set<string>();
  if (!c.inputs.length) { problem('missing', '请添加至少一个输入文件'); }
  for (const task of c.inputs) {
    const input = resolvedInput(task, c) || '<输入文件>';
    if (!task.path.trim()) { problem('missing', '请填写输入文件的实际执行路径'); }
    if (c.platform !== 'windows' && /^[A-Za-z]:[\\/]/.test(input)) { problem('missing', `Windows 路径需要显式映射：${input}`); }
    const ext = a.输出容器.trim().replace(/^\./, '') || extension(input).slice(1);
    const noOutput = a.输出_输出文件参数使用方法 !== 0 || a.自定义参数_完全自己写.trim();
    if (!ext && !noOutput) { problem('missing', '请设置输出容器或指定带后缀的输出文件'); }
    let dir = c.outputDirectory || a.输出位置 || a.输出目录 || dirname(input);
    if (a.输出位置_保留子文件夹结构起始点) {
      const root = a.输出位置_保留子文件夹结构起始点.replace(/[\\/]+$/, '');
      const sourceDir = dirname(input).replace(/[\\/]+$/, '');
      const normalize = (s: string) => c.platform === 'windows' ? s.toLowerCase().replaceAll('\\', '/') : s;
      if (normalize(sourceDir).startsWith(normalize(root) + '/')) { dir = join(dir, sourceDir.slice(root.length + 1), c.platform === 'windows' ? '\\' : '/'); }
      else if (normalize(sourceDir) !== normalize(root)) { problem('missing', `输入文件不在保留目录结构的起始目录内：${input}`); }
    }
    dir = mapPath(dir, c);
    if (c.platform !== 'windows' && /^[A-Za-z]:[\\/]/.test(dir)) { problem('missing', '输出目录仍是 Windows 路径，请显式映射到目标系统'); }
    if (dir && !/^(?:[A-Za-z]:[\\/]|[\\/])/.test(dir) && c.cwd) { dir = join(c.cwd, dir, c.platform === 'windows' ? '\\' : '/'); }
    const candidateStem = nameFor(a, input, c, task.id);
    const output = task.output ? mapPath(task.output, c) : uniqueOutput(join(dir, candidateStem, c.platform === 'windows' ? '\\' : '/'), ext ? '.' + ext : '', a.输出_自动命名选项, used, c.platform);
    if (c.platform !== 'windows' && /^[A-Za-z]:[\\/]/.test(output)) { problem('missing', '指定输出文件仍是 Windows 路径，请显式映射到目标系统'); }
    if (!a.自定义参数_完全自己写.trim()) {
      const actualExt = extension(output).toLowerCase(), matroska = ['.mkv', '.mka', '.mks', '.mk3d'].includes(actualExt), cover = matroska || ['.mp4', '.m4v', '.m4a', '.mov', '.3gp', '.3g2'].includes(actualExt);
      for (const item of a.附件_要写入的附件) { if (!item.类型) { continue; } if (!item.文件路径.trim()) { problem('missing', '附件已选择类型，请补充文件路径'); } else if (item.类型 === 2 ? !cover : !matroska) { problem('error', `输出容器无法保存该附件：${item.文件路径}`); } else if (item.类型 === 2 && a.流控制_启用保留其他视频流 && !videoCodec(a)?.是否禁用) { problem('error', '附加封面图需要确定输出视频数量；请使用明确的视频流选择并关闭“保留其他视频流”'); } }
    }
    if (input === output && !noOutput) { problem('error', '输入路径和输出路径不能相同，请修改输出文件名'); }
    const probe = task.probe?.path === task.path && (!task.probe.resolvedPath || task.probe.resolvedPath === input) ? task.probe.data : undefined;
    probes.push(probeStage(input, task.id, c));
    const custom = a.自定义参数_完全自己写.trim();
    if (!custom && [5, 6].includes(a.剪辑区间_方法) && (probe?.format?.duration === undefined || probe?.format?.duration === null || probe?.format?.duration === '' || !Number.isFinite(Number(probe?.format?.duration)))) { problem('missing', `${filename(input)}：此剪辑方式需要导入 ffprobe 时长信息`); }
    let external = task.subtitle ? mapPath(task.subtitle, c) : undefined;
    if (!custom && external && c.platform !== 'windows' && /^[A-Za-z]:[\\/]/.test(external)) { problem('missing', '外部字幕仍是 Windows 路径，请显式映射到目标系统'); }
    if (!custom && a.视频参数_烧录字幕_滤镜选择 && !a.视频参数_烧录字幕_自己写滤镜取代所有设置) {
      if (a.视频参数_烧录字幕_字幕来源是外部文件 === 1 && !external) { problem('missing', `${filename(input)}：请选择实际字幕路径；候选 ${subtitleCandidates(a, input).join('、')}`); }
      if (a.视频参数_烧录字幕_字幕来源是外部文件 === 2 && (!probe || !a.视频参数_烧录字幕_指定内嵌的流)) { problem('missing', `${filename(input)}：内嵌字幕需要 ffprobe 信息和字幕流编号`); }
      if (!a.视频参数_烧录字幕_字幕来源是外部文件) { problem('missing', '烧录字幕已启用，请选择字幕来源'); }
    }
    const autoSubtitle = ['SRT', 'ASS', 'SSA'].some(k => a['流控制_自动混流' + k]);
    if (!custom && autoSubtitle && !task.sidecarsConfirmed) { problem('missing', `${filename(input)}：请确认同名字幕清单（可以为空）`); }
    const sidecars = autoSubtitle ? (task.sidecars || []).filter(file => a['流控制_自动混流' + extension(file).slice(1).toUpperCase()]).map(p => mapPath(p, c)) : [];
    const assets: { path: string; content: string }[] = [];
    let mainInput = input, vapour = false;
    if (!custom) {
      for (const [kind, suffix] of [['AviSynth', 'avs'], ['VapourSynth', 'vpy']] as const) {
        if (!a['视频参数_视频帧服务器_使用' + kind]) { continue; }
        const template = a['视频参数_视频帧服务器_' + suffix + '脚本文件'];
        const content = c.resources[template] ?? c.resources[filename(template)];
        if (!template || content === undefined) { problem('missing', `${kind}：请导入脚本模板文件`); }
        const scriptPath = withoutExtension(input) + '.' + task.id.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') + (kind === 'AviSynth' ? '.avs' : extension(template) || '.vpy');
        assets.push({ path: scriptPath, content: (content || '').replaceAll('<FilePath>', input) });
        if (mainInput === input) { mainInput = scriptPath; vapour = kind === 'VapourSynth'; }
      }
    }
    const stages: CommandStage[] = [], log = await passlog(input, output, c);
    for (const phase of custom ? ['single'] : twoPass(a) ? ['pass1', 'pass2'] : ['single']) {
      let args: string[] = [], graph = '', maps: string[] = [];
      if (custom) { raw(args, substitute(custom, input, output)); }
      else {
        const clipping = clip(a), g = buildGraph(a, input, output, phase === 'pass1', external), extra = phase === 'pass1' ? { inputs: [], outputs: [] } : extraOutputs(a, g, input, output, sidecars);
        raw(args, substitute(a.自定义参数_开头参数, input, output)); args.push('-hide_banner', '-y', ...clipping.before);
        for (const [name, value] of [['-hwaccel', a.解码参数_解码器], ['-threads', a.解码参数_CPU解码线程数], ['-hwaccel_output_format', a.解码参数_解码数据格式], [a.解码参数_指定硬件的参数名, a.解码参数_指定硬件的参数]]) { add(args, name, value); }
        if (vapour) { add(args, '-f', 'vapoursynth'); } add(args, '-i', mainInput);
        raw(args, substitute(a.自定义参数_之前参数, input, output)); args.push(...extra.inputs, ...clipping.after);
        if (g.graph) { add(args, '-filter_complex', g.graph); } args.push(...g.maps, ...g.outputFilters, ...encode(a, g, phase, input, output, log));
        if (phase === 'pass1') { args.push('-an'); }
        args.push(...extra.outputs); raw(args, substitute(a.自定义参数_之后参数, input, output));
        if (phase === 'pass1' || a.输出_输出文件参数使用方法 === 2) { args.push('-f', 'null', c.platform === 'windows' ? 'NUL' : '/dev/null'); }
        else if (a.输出_输出文件参数使用方法 !== 1) { args.push(output); }
        raw(args, substitute(a.自定义参数_最后参数, input, output));
        graph = g.graph; maps = g.maps;
      }
      args = args.map(p => mapPath(p, c));
      if (c.platform !== 'windows' && args.some(p => /^[A-Za-z]:[\\/]/.test(p))) { problem('missing', '命令中的资源仍有 Windows 路径，请显式映射到目标系统'); }
      if (args.some(p => /<(?:输入文件|输出文件|媒体总时长|InputFile[^>]*|OutputFile|字幕文件[^>]*)>/.test(p))) { problem('missing', `${filename(input)}：命令仍有未解析的占位符`); }
      if (args.some(p => p.includes('\0')) || c.ffmpeg.includes('\0')) { problem('error', '参数和程序路径不能包含 NUL 字符'); }
      stages.push({ name: phase === 'pass1' ? '两遍编码 · 第一遍' : phase === 'pass2' ? '两遍编码 · 第二遍' : '执行转码', kind: phase as CommandStage['kind'], executable: c.ffmpeg, args, graph, maps, taskId: task.id });
    }
    tasks.push({ id: task.id, input, output, directory: dirname(output), stages, assets, preserve: { creation: a.输出命名_保留创建时间, modification: a.输出命名_保留修改时间, access: a.输出命名_保留访问时间 }, naming: task.output ? 0 : a.输出_自动命名选项, candidateStem, extension: ext ? '.' + ext : '' });
  }
  for (const item of unconfirmed) { if (tasks.some(t => t.stages.some(s => s.args.some(arg => arg.includes(item.path) || arg.includes(filterPath(item.path)) || arg.includes(filterPath(item.path).replaceAll("'", "\\'")))))) { problem('missing', c.platform !== 'windows' && /^[A-Za-z]:/.test(item.path) ? `Windows 资源路径需要显式映射：${item.path}` : `请确认预设路径用于当前环境：${item.path}`, item.field); } }
  const uniqueIssues = [...new Map(issues.map(i => [i.level + i.message, i])).values()];
  return { status: uniqueIssues.some(i => i.level === 'error') ? 'incompatible' : uniqueIssues.some(i => i.level === 'missing') ? 'missing' : 'ready', issues: uniqueIssues, tasks, probes, context: c, preset: a };
}
