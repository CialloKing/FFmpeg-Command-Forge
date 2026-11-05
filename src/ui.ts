import { zipSync, strToU8 } from 'fflate';
import { revision, version as upstreamVersion } from '../docs/upstream.json';
import ffmpegFull from './data/ffmpeg-full-2026.11.3.json';
import { blankValue, clone, data, exportPreset, groupFor, groups, importPreset, schema } from './preset';
import { buildPlan, defaultContext, resolvedInput } from './plan';
import { downloadableScript, renderCommand, renderPlan } from './render';
import { normalizeOrder, subtitleCandidates } from './filters';
import { filename } from './paths';
import type { CommandPlan, ExecutionContext, InputTask, Preset, PresetDocument, RenderedPlan, Schema, Shell } from './types';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] { const node = document.createElement(tag); node.className = className; if (text !== undefined) { node.textContent = text; } return node; }
function button(text: string, action: () => void, cls = ''): HTMLButtonElement { const b = el('button', cls, text); b.type = 'button'; b.onclick = action; return b; }
function row(...nodes: (Node | string)[]): HTMLDivElement { const r = el('div', 'row'); r.append(...nodes); return r; }
const labels: Record<string, string> = { powershell: 'PowerShell 7.3+', powershell5: 'Windows PowerShell 5.1', cmd: 'CMD（延迟展开关闭）', bash: 'Bash', zsh: 'Zsh' };
const cacheKey = 'ffmpeg-command-forge.workspace.v1', libraryKey = 'ffmpeg-command-forge.presets.v1';
const presetBaseline = `3FUI ${upstreamVersion}`;
const presetFormat = `v${data.defaults.预设文件版本} JSON`;
const presetHint = `预设兼容基线 ${presetBaseline} · ${presetFormat}`;
let doc: PresetDocument = importPreset(), context: ExecutionContext = defaultContext(), selected = '任务与环境', query = '', previewTab = 'commands', generation = 0, timer: ReturnType<typeof setTimeout>, currentPlan: CommandPlan | undefined, currentRendered: RenderedPlan | undefined;
let theme = 'dark';
let library: { name: string; preset: Preset }[] = [];
const app = $('#app');
app.innerHTML = `<header class="header"><div class="brand"><div class="brandmark" aria-hidden="true">⌘</div><div><div class="brand-name">FFmpeg Command Forge</div><div class="brand-subtitle">BUILD THE COMMAND. OWN THE FRAME.</div></div></div><div class="toolbar"><button id="new" class="ghost optional">新建方案</button><button id="import" title="${presetHint}">导入预设</button><button id="export" title="${presetHint}">导出预设</button><button id="workspace" class="ghost optional">工作区</button><button id="theme" class="ghost" aria-label="切换明暗主题">◐</button></div></header><div class="workspace"><nav class="sidebar" aria-label="参数分类"></nav><main class="editor"><div id="editor-head"></div><div id="editor-content"></div></main><aside class="output" aria-label="命令预览"><div><div class="row between"><span class="output-heading">命令工作台</span><span class="pill green"><span class="dot"></span>离线运行</span></div><div class="subline" id="task-summary">等待配置输入文件</div></div><div class="status-card"><div class="status-icon" id="status-icon">◌</div><div><div class="status-title" id="status-title">正在构建</div><div class="status-caption" id="status-caption">检查预设与执行环境</div></div></div><div><div class="tabs" id="preview-tabs"></div><div class="terminal"><div class="terminal-top"><span id="terminal-title">POWERSHELL</span><button id="copy-preview" class="ghost small">复制预览</button></div><pre id="command" tabindex="0" aria-label="生成的命令或脚本"></pre></div></div><div class="stack"><button id="copy-final" class="primary" disabled>复制最终脚本 ↗</button><div class="download-row"><button id="download-script" disabled>下载脚本</button><button id="download-zip" disabled>下载任务包</button></div><small>最终脚本包含准备、转码和后处理。命令视图用于检查固定路径下的 FFmpeg 参数。</small></div><div id="issues"></div><div class="output-footer"><div class="connection-line"><span class="dot" style="color:var(--accent)"></span>媒体保留在本机 · 由你的 FFmpeg 执行</div><div style="margin-top:7px">预设兼容基线 ${presetBaseline} / ${revision.slice(0, 7)}<br>原生格式 ${presetFormat}<br>硬件编码与外部滤镜依赖本机环境。</div></div></aside></div><div id="toast" role="status" hidden></div><dialog id="dialog"><div class="row between"><h3 id="dialog-title"></h3><button id="dialog-close" class="ghost small" aria-label="关闭">✕</button></div><div id="dialog-body"></div></dialog>`;

function toast(message: string): void { const t = $('#toast'); t.textContent = message; t.className = 'toast'; t.hidden = false; setTimeout(() => { t.hidden = true; }, 3800); }
function save(content: string | Uint8Array, name: string, type = 'application/octet-stream'): void {
  const part = typeof content === 'string' ? content : new Uint8Array(content).buffer;
  const url = URL.createObjectURL(new Blob([part], { type })); const link = el('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function pick(accept: string, callback: (file: File) => Promise<void>, multiple = false): void {
  const input = el('input'); input.type = 'file'; input.accept = accept; input.multiple = multiple;
  input.onchange = async () => { for (const f of input.files || []) { try { await callback(f); } catch (error) { toast(error instanceof Error ? error.message : String(error)); } } };
  input.click();
}
function cached(): void {
  try { localStorage.setItem(cacheKey, JSON.stringify({ format: 'ffmpeg-command-forge/workspace', version: 1, preset: doc.raw, context, theme })); }
  catch { /* Export remains available when browser storage is blocked or full. */ }
}
function loadWorkspace(input: any): void {
  if (input?.format !== 'ffmpeg-command-forge/workspace' || input.version !== 1 || !Array.isArray(input.context?.inputs) || !input.context.inputs.every((t: any) => typeof t.id === 'string' && typeof t.path === 'string')) { throw new Error('工作区格式无效或版本不支持'); }
  const defaults = defaultContext();
  for (const key of ['platform', 'shell', 'ffmpeg', 'ffprobe', 'cwd', 'outputDirectory', 'clock', 'nonce']) { if (typeof input.context[key] !== 'string') { throw new Error('工作区执行环境字段无效：' + key); } }
  if (!['windows', 'macos', 'linux'].includes(input.context.platform) || !Object.hasOwn(labels, input.context.shell)) { throw new Error('工作区目标环境无效'); }
  if (!Array.isArray(input.context.pathMappings) || !input.context.pathMappings.every((m: any) => typeof m.from === 'string' && typeof m.to === 'string') || !Array.isArray(input.context.confirmedPaths) || typeof input.context.resources !== 'object') { throw new Error('工作区资源映射格式无效'); }
  doc = importPreset(input.preset); context = { ...defaults, ...input.context }; theme = input.theme === 'light' ? 'light' : 'dark'; document.documentElement.dataset.theme = theme;
}
try { const cachedText = localStorage.getItem(cacheKey); if (cachedText) { loadWorkspace(JSON.parse(cachedText)); } const stored = JSON.parse(localStorage.getItem(libraryKey) || '[]'); if (Array.isArray(stored)) { library = stored.filter(x => typeof x.name === 'string' && x.preset && typeof x.preset === 'object'); } }
catch { /* A malformed or unavailable cache must never prevent a fresh session. */ }
function edit(path: (string | number)[], value: any): void {
  const raw = clone(doc.raw); let target = raw;
  path.slice(0, -1).forEach((key, i) => { if (!target[key]) { target[key] = typeof path[i + 1] === 'number' ? [] : {}; } target = target[key]; });
  target[path.at(-1)!] = value; doc = importPreset(raw); schedule();
}
function schedule(): void {
  generation++; currentPlan = undefined; currentRendered = undefined;
  $('#copy-final').setAttribute('disabled', ''); $('#download-script').setAttribute('disabled', ''); $('#download-zip').setAttribute('disabled', '');
  $('#status-title').textContent = '正在构建'; $('#status-caption').textContent = '检查预设与执行环境';
  clearTimeout(timer); timer = setTimeout(recompute, 100); cached();
}
async function recompute(): Promise<void> {
  const id = ++generation;
  try {
    const plan = await buildPlan(doc, context); if (id !== generation) { return; }
    currentPlan = plan; currentRendered = renderPlan(plan); renderOutput();
  } catch (error) {
    currentPlan = undefined; currentRendered = undefined; $('#status-title').textContent = '无法构建'; $('#status-caption').textContent = '请检查参数或重新导入预设'; $('#command').textContent = String(error); $('#copy-final').setAttribute('disabled', '');
  }
}
function renderNav(): void {
  const nav = $('.sidebar'); nav.replaceChildren();
  nav.append(el('div', 'nav-caption', 'WORKSPACE'));
  for (const name of ['任务与环境', '预设库']) { const b = button(name, () => navigate(name), 'nav-item' + (selected === name ? ' active' : '')); nav.append(b); }
  nav.append(el('div', 'nav-caption', 'PARAMETERS'));
  for (const name of groups) { const b = button(name, () => navigate(name), 'nav-item' + (selected === name ? ' active' : '')); b.setAttribute('aria-label', name); b.append(el('span', 'number', String(Object.keys(schema.fields!).filter(k => groupFor(k) === name).length).padStart(2, '0'))); nav.append(b); }
  nav.append(el('div', 'sidebar-foot', 'V1.0 / LOCAL FIRST\n参数属于你，执行由你掌控。'));
}
function navigate(name: string): void { selected = name; query = ''; renderEditor(); renderNav(); }
function labeled(label: string, node: HTMLElement, hint = '', wide = false): HTMLDivElement {
  const field = el('div', 'field' + (wide ? ' wide' : '')); const control = node.querySelector('input[role="combobox"]') ?? node;
  const id = 'field-' + crypto.randomUUID(); control.id = id; const l = el('label', '', label); l.htmlFor = id; field.append(l, node); if (hint) { field.append(el('small', 'hint', hint)); } return field;
}
function textInput(value: string, onChange: (v: string) => void, placeholder = ''): HTMLInputElement { const input = el('input'); input.value = value; input.placeholder = placeholder; input.oninput = () => onChange(input.value); return input; }
type Choice = [value: string, label: string];
function choiceInput(options: Choice[], value: string, onChange: (v: string) => void, allowCustom = false): HTMLElement {
  const field = el('div', 'choice');
  const input = el('input');
  const popup = el('div', 'choice-popup');
  const list = el('div');
  const empty = el('div', 'choice-empty', '没有匹配的选项');
  const toggle = button('▾', () => {
    if (!popup.hidden) { dismiss(); return; }
    input.focus(); input.select(); showChoices('');
  }, 'choice-toggle');
  let matches: Choice[] = [];
  let active = -1;

  const displayValue = () => options.find(([id]) => id === value)?.[1] ?? value;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  list.id = 'choices-' + crypto.randomUUID();
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', '候选选项');
  input.setAttribute('aria-controls', list.id);
  toggle.setAttribute('aria-label', '切换候选列表');
  toggle.tabIndex = -1;
  toggle.onmousedown = event => event.preventDefault();
  empty.setAttribute('role', 'status');
  popup.append(list, empty);
  field.append(input, toggle, popup);
  dismiss();

  function dismiss(label = displayValue()): void {
    popup.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    input.value = label;
  }
  function update(next: string): void {
    if (next !== value) { value = next; onChange(next); }
  }
  function choose([id, label]: Choice): void {
    dismiss(label);
    update(id);
  }
  function showChoices(query: string): void {
    const terms = query.trim().toLowerCase().split(/\s+/);
    matches = options.filter(([id, label]) => terms.every(term => `${label} ${id}`.toLowerCase().includes(term)));
    active = -1;
    input.removeAttribute('aria-activedescendant');
    list.replaceChildren(...matches.map((choice, index) => {
      const option = el('div', 'choice-option', choice[1]);
      option.id = `${list.id}-${index}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      // 保持焦点在输入框上，以免候选项在点击生效前被失焦事件关闭。
      option.onmousedown = event => event.preventDefault();
      option.onclick = () => choose(choice);
      return option;
    }));
    empty.hidden = matches.length > 0;
    const bounds = input.getBoundingClientRect();
    const below = window.innerHeight - bounds.bottom;
    popup.classList.toggle('above', below < 240 && bounds.top > below);
    popup.hidden = false;
    popup.scrollTop = 0;
    input.setAttribute('aria-expanded', 'true');
  }

  input.onfocus = () => input.select();
  input.onclick = () => { if (popup.hidden) { input.select(); showChoices(''); } };
  input.onblur = () => dismiss();
  input.oninput = () => {
    if (allowCustom) { update(input.value); }
    showChoices(input.value);
  };
  input.onkeydown = event => {
    if (event.isComposing) { return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (popup.hidden) { showChoices(''); }
      if (!matches.length) { return; }
      list.children[active]?.setAttribute('aria-selected', 'false');
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const next = active < 0 && direction < 0 ? matches.length - 1 : active + direction;
      active = Math.max(0, Math.min(next, matches.length - 1));
      const option = list.children[active];
      option.setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter' && !popup.hidden) {
      event.preventDefault();
      if (active >= 0) { choose(matches[active]); }
      else if (!allowCustom && matches.length === 1) { choose(matches[0]); }
      else if (allowCustom) { dismiss(); }
    } else if (event.key === 'Escape' && !popup.hidden) {
      event.preventDefault(); dismiss();
    }
  };
  return field;
}
function heading(title: string, number: string): HTMLDivElement { const h = el('div', 'section-line'); h.append(el('span', '', number), el('h3', '', title)); return h; }
const parameterHints: Record<string, string> = { 视频参数_编码器_具体编码: '-c:v', 视频参数_编码器_编码预设: '-preset', 视频参数_帧速率: '-r', 视频参数_帧速率模式: '-fps_mode', 视频参数_分辨率: 'scale / scale_cuda', 视频参数_分辨率_裁剪滤镜参数: 'crop', 视频参数_比特率_基础: '-b:v', 视频参数_比特率_最低值: '-minrate', 视频参数_比特率_最高值: '-maxrate', 视频参数_比特率_缓冲区: '-bufsize', 视频参数_色彩管理_像素格式: '-pix_fmt', 音频参数_编码器_代号: '-c:a · 使用 3FUI 私有 ID', 音频参数_比特率: '-b:a', 音频参数_采样率: '-ar', 音频参数_位深度: '-sample_fmt', 解码参数_解码器: '-hwaccel', 解码参数_解码数据格式: '-hwaccel_output_format', 剪辑区间_入点: '-ss / trim · 建议使用 00:00:10 或 10.0', 剪辑区间_出点: '-to / trim · 建议使用 00:00:20 或 20.0', 输出_自动命名选项: '自动命名与冲突处理包含在完整脚本中', 自定义参数_完全自己写: '覆盖自动生成的 FFmpeg 参数；按原版 Windows 参数语法解析，不执行 Shell 代码' };
const familyHints: [string, string][] = [
  ['视频参数_编码器_配置文件', '-profile'], ['视频参数_编码器_场景优化', '-tune'], ['视频参数_编码器_图片', '-q:v'], ['视频参数_编码器_gpu', '-gpu'], ['视频参数_编码器_threads', '-threads'], ['解码参数_CPU', '-threads'],
  ['视频参数_分辨率自动', 'scale / scale_cuda · w / h / flags / interp_algo'], ['视频参数_抽帧', 'mpdecimate · max / keep / hi / lo / frac'], ['视频参数_插帧', 'minterpolate · fps / mi_mode / me_mode / me / mc_mode'], ['视频参数_NV_FRUC', 'fruc_vulkan · fps / perf / grid'], ['视频参数_动态模糊', 'tmix · frames / weights / scale / planes'],
  ['视频参数_超分', 'libplacebo · upscaler / downscaler / custom_shader_path'], ['视频参数_降噪', 'hqdn3d / nlmeans / atadenoise / bm3d / bilateral_cuda'], ['视频参数_锐化', 'cas / unsharp'], ['视频参数_胶片颗粒', 'noise / apply_filmgrain'], ['视频参数_平滑断层', 'deband / gradfun / libplacebo'], ['视频参数_处理扫描', 'yadif / bwdif / tinterlace / fieldmatch / pullup'], ['视频参数_画面翻转', 'transpose / hflip / vflip'],
  ['视频参数_烧录字幕', 'subtitles / ass · filename / stream_index / fontsdir / force_style'], ['视频参数_色彩管理', 'colorspace / zscale / libplacebo / eq · -colorspace / -color_primaries / -color_trc / -color_range'], ['视频参数_质量控制', '-crf / -cq / -qp / -rc'], ['视频参数_比特率_控制', '-rc / -pass / -passlogfile'], ['音频参数_质量', '-q:a / -compression_level'], ['音频参数_声道', 'aformat · channel_layouts'], ['音频参数_响度', 'loudnorm · I / LRA / TP'],
  ['流控制_', '-map / -c:s / -map_metadata / -map_chapters'], ['元数据_', '-metadata'], ['章节_', '-f ffmetadata / -map_chapters'], ['附件_', '-attach / -metadata:s:t / -disposition'], ['自定义参数_视频滤镜', '-vf / -filter:v / -filter_complex'], ['自定义参数_音频滤镜', '-af / -filter:a / -filter_complex']
];
const fieldHint = (key: string) => parameterHints[key] || familyHints.find(([prefix]) => key.startsWith(prefix))?.[1] || '';
function parameterField(key: string, spec: Schema, value: any, path: (string | number)[]): HTMLElement {
  const label = key.replace(/^(视频参数_|音频参数_|解码参数_)/, '').replaceAll('_', ' / ');
  const hint = path.length === 1 ? fieldHint(key) || key : '';
  if (spec.kind === 'object' || spec.kind === 'array') {
    const details = el('details', 'nested'); const summary = el('summary', '', label + (spec.kind === 'array' ? ` · ${(value || []).length} 项` : '')); details.append(summary);
    if (spec.kind === 'object') {
      const fields = el('div', 'parameter-fields'); for (const [k, s] of Object.entries(spec.fields!)) { fields.append(parameterField(k, s, value?.[k] ?? blankValue(s), [...path, k])); } details.append(fields);
    } else {
      const list = el('div'); const values: any[] = value || [];
      const rerender = () => { const replacement = parameterField(key, spec, values, path); (replacement as HTMLDetailsElement).open = true; details.replaceWith(replacement); };
      values.forEach((v, i) => {
        const item = el('div', 'array-item');
        if (spec.items!.kind === 'object') { for (const [k, s] of Object.entries(spec.items!.fields!)) { item.append(parameterField(k, s, v?.[k] ?? blankValue(s), [...path, i, k])); } }
        else { item.append(parameterField(`第 ${i + 1} 项`, spec.items!, v, [...path, i])); }
        const actions = el('div', 'array-actions');
        const move = (delta: number) => { if (i + delta < 0 || i + delta >= values.length) { return; } [values[i], values[i + delta]] = [values[i + delta], values[i]]; edit(path, values); rerender(); };
        actions.append(button('↑', () => move(-1), 'small'), button('↓', () => move(1), 'small'), button('删除', () => { values.splice(i, 1); edit(path, values); rerender(); }, 'small danger')); item.append(actions); list.append(item);
      });
      details.append(list, button('+ 添加一项', () => { values.push(blankValue(spec.items!)); edit(path, values); rerender(); }, 'small'));
    }
    const wrapper = el('div', 'field wide'); wrapper.append(details); return wrapper;
  }
  if (spec.kind === 'boolean') {
    const input = el('input'); input.type = 'checkbox'; input.checked = !!value; input.onchange = () => edit(path, input.checked); const field = labeled(label, input); field.className = 'field boolean'; field.prepend(input); return field;
  }
  let input: HTMLElement;
  if (spec.kind === 'enum') {
    const name = typeof value === 'number' ? Object.keys(spec.values!).find(k => spec.values![k] === value) || String(value) : String(value);
    const options: Choice[] = Object.keys(spec.values!).map(k => [k, k.replaceAll('_', ' ')]); if (!Object.hasOwn(spec.values!, name)) { options.unshift([name, '未知：' + name]); }
    input = choiceInput(options, name, v => edit(path, v));
  } else if (key === '音频参数_编码器_代号') {
    const current = String(value ?? '');
    const knownId = data.audio.find(codec => codec.私有ID.toLowerCase() === current.toLowerCase())?.私有ID;
    const options: Choice[] = data.audio.map(codec => [codec.私有ID, `${codec.显示名称}（${codec.私有ID}）`]);
    options.unshift(['', '未设置']);
    // 保留未知的导入值，避免下拉框将无法生成命令的预设误显示为未设置。
    if (current && !knownId) { options.unshift([current, '未知：' + current]); }
    input = choiceInput(options, knownId ?? current, v => edit(path, v));
  } else if (key === '视频参数_编码器_具体编码' || key === '输出容器') {
    const choices = key === '视频参数_编码器_具体编码' ? Object.keys(data.video) : ['mp4', 'mkv', 'webm', 'mov', 'mp3', 'flac', 'wav', 'opus', 'png'];
    input = choiceInput(choices.map(choice => [choice, choice]), String(value ?? ''), v => edit(path, v), true);
  } else if (/自定义参数|自己写滤镜|进阶参数集/.test(key)) {
    const area = el('textarea', 'mono'); area.value = value ?? ''; area.onchange = () => edit(path, area.value); input = area;
  } else {
    const text = textInput(String(value ?? ''), v => edit(path, spec.kind === 'number' ? Number(v || 0) : v));
    if (spec.kind === 'number') { text.type = 'number'; text.step = 'any'; }
    input = text;
  }
  const field = labeled(label, input, hint, /自定义参数|自己写滤镜|进阶参数集/.test(key));
  if (/^(视频参数_视频帧服务器_)(avs|vpy)脚本文件$/.test(key)) { field.append(button('导入模板内容', () => pick('.avs,.vpy,.py,.txt', async f => { const path = String(doc.normalized[key] || f.name); if (!doc.normalized[key]) { edit([key], f.name); } context.resources[path] = await f.text(); schedule(); toast('已导入模板：' + f.name); }), 'small')); }
  return field;
}
function filterOrder(): HTMLElement {
  const a = clone(doc.normalized); normalizeOrder(a); const order: Preset[] = a.滤镜排序系统;
  const box = el('div', 'card'); box.append(el('h3', '', '滤镜执行顺序'), el('p', 'subtitle', '同类滤镜保留已有顺序。内置滤镜内容随参数更新；自定义滤镜可在下方数组中编辑。'));
  if (!order.length) { box.append(el('div', 'empty', '尚未启用滤镜。配置画面、字幕或音频处理后会显示在这里。')); }
  order.forEach((item, i) => {
    const line = el('div', 'filter-item'); const detail = el('div', 'grow'); detail.append(el('div', '', item.显示名称 || '自定义滤镜'), el('div', 'filter-detail mono', item.自定义滤镜内容));
    const move = (delta: number) => {
      if (!order[i + delta] || order[i + delta].滤镜目标流类型 !== item.滤镜目标流类型) { return; }
      [order[i], order[i + delta]] = [order[i + delta], order[i]];
      const remaining = [...(doc.raw.滤镜排序系统 || [])];
      const items = order.map(normalized => { const originalIndex = remaining.findIndex(x => x.实例ID && x.实例ID === normalized.实例ID || (typeof x.滤镜标识符 === 'number' ? x.滤镜标识符 : schema.fields!.滤镜排序系统.items!.fields!.滤镜标识符.values![x.滤镜标识符]) === normalized.滤镜标识符 && x.自定义滤镜内容 === normalized.自定义滤镜内容); const original = originalIndex >= 0 ? remaining.splice(originalIndex, 1)[0] : {}; return { ...original, ...normalized }; });
      edit(['滤镜排序系统'], items); renderEditor();
    };
    line.append(el('span', 'filter-icon', item.滤镜目标流类型 === 2 ? 'A' : 'V'), detail, button('↑', () => move(-1), 'small'), button('↓', () => move(1), 'small')); box.append(line);
  });
  return box;
}
function environment(): HTMLElement {
  const content = el('div', 'stack');
  const card = el('div', 'card stack'), grid = el('div', 'grid2');
  grid.append(labeled('目标系统', choiceInput([['windows', 'Windows'], ['macos', 'macOS'], ['linux', 'Linux']], context.platform, v => { context.platform = v as ExecutionContext['platform']; context.shell = v === 'windows' ? 'powershell' : v === 'macos' ? 'zsh' : 'bash'; context.confirmedPaths = []; context.inputs.forEach(t => { t.probe = undefined; t.sidecarsConfirmed = false; }); schedule(); renderEditor(); })), labeled('执行终端', choiceInput(Object.entries(labels), context.shell, v => { context.shell = v as Shell; schedule(); })));
  grid.append(labeled('FFmpeg 程序', textInput(context.ffmpeg, v => { context.ffmpeg = v; schedule(); }), '默认从 PATH 查找，也可填写完整路径'), labeled('ffprobe 程序', textInput(context.ffprobe, v => { context.ffprobe = v; schedule(); })));
  grid.append(labeled('工作目录', textInput(context.cwd, v => { context.cwd = v; schedule(); }, context.platform === 'windows' ? '例如 D:\\Media' : '例如 /home/user/Media'), '相对路径将在此目录下解释'), labeled('本次输出目录', textInput(context.outputDirectory, v => { context.outputDirectory = v; schedule(); }, '留空时使用预设或输入文件目录')));
  card.append(grid); content.append(heading('执行环境', '01'), card, heading('输入文件', '02'));
  const note = el('p', 'note', '粘贴实际路径，或使用“工作目录 + 相对文件名”。拖入文件只取得文件名，不会把浏览器的虚拟路径当作本机路径。'); content.append(note);
  context.inputs.forEach((task, index) => {
    const block = el('div', 'input-task'), title = row(el('span', 'task-id', 'INPUT ' + String(index + 1).padStart(2, '0')), el('span', 'grow'), button('移除', () => { context.inputs.splice(index, 1); schedule(); renderEditor(); }, 'small ghost'));
    const pathInput = textInput(task.path, v => { task.path = v; task.probe = undefined; task.sidecarsConfirmed = false; schedule(); }, '输入媒体文件的真实路径'); pathInput.setAttribute('aria-label', `输入文件 ${index + 1} 路径`);
    pathInput.ondragover = e => e.preventDefault(); pathInput.ondrop = e => { e.preventDefault(); const f = e.dataTransfer?.files[0]; if (f) { task.path = f.name; task.probe = undefined; schedule(); renderEditor(); toast('已取得文件名，请确认执行目录或补充真实路径'); } };
    block.append(title, labeled('输入路径', pathInput), labeled('指定输出文件（可选）', textInput(task.output || '', v => { task.output = v; schedule(); }), '填写后覆盖本次自动命名'));
    const actions = el('div', 'row wrap');
    const applyProbe = (text: string) => { const probe = JSON.parse(text.replace(/^\uFEFF/, '')); if (!probe || !Array.isArray(probe.streams) && !probe.format) { throw new Error('文件不是 ffprobe 的 JSON 输出'); } task.probe = { path: task.path, resolvedPath: resolvedInput(task, context), data: probe }; schedule(); renderEditor(); };
    actions.append(button(task.probe?.path === task.path ? '✓ 重新导入 ffprobe JSON' : '导入 ffprobe JSON', () => pick('.json', async f => applyProbe(await f.text())), 'small'), button('复制探测命令', () => { const stage = currentPlan?.probes.find(s => s.taskId === task.id); if (stage) { void copy(renderCommand(stage, context.shell)); } }, 'small ghost'), button('粘贴探测结果', () => openTextDialog('导入 ffprobe 结果', '', text => applyProbe(text)), 'small ghost'));
    block.append(actions);
    if (task.probe?.path === task.path) { const p = task.probe.data; block.append(el('small', '', `已关联此路径 · ${p.streams?.length ?? 0} 个流 · 时长 ${p.format?.duration ?? '未知'} 秒`)); }
    const a = doc.normalized;
    if (a.视频参数_烧录字幕_滤镜选择 && a.视频参数_烧录字幕_字幕来源是外部文件 === 1) {
      const input = textInput(task.subtitle || '', v => { task.subtitle = v; schedule(); }, '实际字幕路径'); const candidates = subtitleCandidates(a, resolvedInput(task, context));
      block.append(labeled('本次烧录的外部字幕', input, '候选：' + candidates.join(' · ')));
      const candidateButtons = el('div', 'row wrap'); candidates.forEach(p => candidateButtons.append(button(filename(p), () => { task.subtitle = p; schedule(); renderEditor(); }, 'small'))); block.append(candidateButtons);
    }
    if (['SRT', 'ASS', 'SSA'].some(k => a['流控制_自动混流' + k])) {
      const input = el('textarea', 'mono'); input.value = (task.sidecars || []).join('\n'); input.placeholder = '每行一个已确认存在的同名字幕路径，可留空'; input.onchange = () => { task.sidecars = input.value.split(/\r?\n/).map(x => x.trim()).filter(Boolean); task.sidecarsConfirmed = false; schedule(); };
      block.append(labeled('同名字幕清单', input), button(task.sidecarsConfirmed ? '✓ 已确认此字幕清单' : '确认字幕清单（包括空清单）', () => { task.sidecarsConfirmed = true; schedule(); renderEditor(); }, 'small'));
    }
    content.append(block);
  });
  const addTasks = row(button('+ 添加输入', () => { context.inputs.push({ id: crypto.randomUUID().replaceAll('-', ''), path: '' }); schedule(); renderEditor(); }), button('批量粘贴路径', () => openTextDialog('每行一个输入文件路径', '', text => { for (const p of text.split(/\r?\n/).map(x => x.trim()).filter(Boolean)) { context.inputs.push({ id: crypto.randomUUID().replaceAll('-', ''), path: p.replace(/^"(.*)"$/, '$1') }); } if (context.inputs[0]?.path === '') { context.inputs.shift(); } schedule(); renderEditor(); }), 'ghost')); content.append(addTasks);
  content.append(heading('预设路径与资源', '03'));
  const mappingCard = el('div', 'card stack'), mappings = el('textarea', 'mono'); mappings.value = context.pathMappings.map(m => m.from + ' => ' + m.to).join('\n'); mappings.placeholder = '例如 D:\\Media => /Volumes/Media'; mappings.onchange = () => { context.pathMappings = mappings.value.split(/\r?\n/).filter(x => x.includes('=>')).map(x => { const i = x.indexOf('=>'); return { from: x.slice(0, i).trim(), to: x.slice(i + 2).trim() }; }); schedule(); };
  mappingCard.append(labeled('显式路径映射', mappings, '每行一条“原目录 => 目标目录”，只转换确认过的前缀。'));
  mappingCard.append(button('确认预设中的路径用于当前环境', () => {
    const values: string[] = []; const visit = (o: Preset) => Object.entries(o).forEach(([k, v]) => { if (typeof v === 'string' && /文件路径|文件夹|脚本文件|输出位置/.test(k)) { values.push(v); } else if (v && typeof v === 'object') { if (Array.isArray(v)) { v.filter(x => x && typeof x === 'object').forEach(visit); } else { visit(v); } } }); visit(doc.normalized); context.confirmedPaths = [...new Set([...context.confirmedPaths, ...values])]; schedule(); toast('已确认当前预设中的资源路径');
  }, 'small'));
  const resources = el('div', 'stack');
  for (const kind of ['avs', 'vpy']) {
    const key = '视频参数_视频帧服务器_' + kind + '脚本文件'; const path = doc.normalized[key];
    if (path || doc.normalized['视频参数_视频帧服务器_使用' + (kind === 'avs' ? 'AviSynth' : 'VapourSynth')]) { const block = el('div', 'resource'); block.append(el('p', '', (path || '未选择 ' + kind + ' 模板') + (context.resources[path] !== undefined ? ' · 内容已导入' : '')), button('导入模板内容', () => pick('.avs,.vpy,.py,.txt', async f => { const resourcePath = path || f.name; if (!path) { edit([key], resourcePath); } context.resources[resourcePath] = await f.text(); schedule(); renderEditor(); }), 'small')); resources.append(block); }
  }
  mappingCard.append(resources); content.append(mappingCard); return content;
}
function presetCard(presets: { 名称: string; 数据: Preset }[], label: string): HTMLElement {
  const card = el('section', 'card preset-card');
  card.setAttribute('aria-label', label);
  let preset = presets[0];
  const description = el('p', 'description', preset?.数据.预设备注 ?? '');
  const choice = choiceInput(presets.map((preset, i) => [String(i), preset.名称]), '0', value => {
    preset = presets[Number(value)];
    description.textContent = preset?.数据.预设备注 ?? '';
  });
  card.append(labeled(label, choice), description, button('应用此预设', () => {
    if (!preset) { return; }
    doc = importPreset(preset.数据);
    schedule();
    toast('已应用：' + preset.名称);
  }, 'primary'));
  return card;
}
function presetLibrary(): HTMLElement {
  const content = el('div', 'stack');
  content.append(el('div', 'banner', `原生预设格式为 ${presetFormat}（预设文件版本 = ${data.defaults.预设文件版本}）。工作目录、终端和探测结果保存在独立工作区中。`));
  content.append(heading('内置预设', '01'), presetCard(data.builtins, '3FUI 内置预设'));
  const fullCard = presetCard(ffmpegFull.presets, 'ffmpeg-full 发行版预设');
  const source = el('a', 'muted', '查看发行版与运行要求');
  source.href = ffmpegFull.release;
  source.target = '_blank';
  source.rel = 'noopener noreferrer';
  fullCard.append(source);
  content.append(heading(`ffmpeg-full ${ffmpegFull.version}`, '02'), fullCard, heading('我的预设', '03'));
  const saved = el('div', 'card stack'), name = textInput('', () => {}, '为当前预设命名');
  saved.append(row(name, button('保存副本', () => { if (!name.value.trim()) { toast('请先填写预设名称'); return; } library.push({ name: name.value.trim(), preset: clone(doc.raw) }); persistLibrary(); renderEditor(); }, 'small')));
  library.forEach((p, i) => { const r = el('div', 'saved-row'); r.append(el('span', 'grow', p.name), button('应用', () => { doc = importPreset(p.preset); schedule(); toast('已应用：' + p.name); }, 'small'), button('导出', () => save(JSON.stringify(p.preset, null, 2), p.name + '.json', 'application/json'), 'small ghost'), button('×', () => { library.splice(i, 1); persistLibrary(); renderEditor(); }, 'small ghost')); saved.append(r); });
  saved.append(el('small', '', '浏览器副本用于便利恢复。重要预设请下载 JSON 文件保存。')); content.append(saved, heading('原生预设', '04'), button('查看或编辑完整 JSON', () => openTextDialog(presetHint, exportPreset(doc), text => { doc = importPreset(text); schedule(); renderEditor(); }), 'ghost')); return content;
}
function persistLibrary(): void { try { localStorage.setItem(libraryKey, JSON.stringify(library)); } catch { toast('浏览器存储不可用，请导出 JSON 保存'); } }
function renderEditor(): void {
  const head = $('#editor-head'), body = $('#editor-content'); head.replaceChildren(); body.replaceChildren();
  const captions: Record<string, string> = { '任务与环境': '从你的素材开始', '预设库': '让好参数成为下一次的起点', '输出': '定义最终交付', '画面': '精确控制每一帧', '编码器': '选择合适的编码方式' };
  head.className = 'editor-head'; head.append(el('div', 'eyebrow', selected === '任务与环境' ? '01 / CONFIGURE YOUR TASK' : selected === '预设库' ? 'PRESET LIBRARY' : 'PARAMETER EDITOR'), el('h2', '', captions[selected] || selected), el('p', 'subtitle', selected === '任务与环境' ? '配置执行环境、输入输出和媒体信息。' : selected === '预设库' ? `预设兼容基线为 ${presetBaseline}（FFmpegFreeUI）。` : '参数即时生成命令，实际执行由本机 FFmpeg 完成。'));
  if (selected === '任务与环境') { body.append(environment()); return; }
  if (selected === '预设库') { body.append(presetLibrary()); return; }
  const search = el('div', 'search'); const input = textInput(query, v => { query = v; renderParameterList(); }, '搜索参数、字段名或 FFmpeg 选项'); input.setAttribute('aria-label', '搜索全部参数'); search.append(input); head.append(search);
  body.append(el('div', 'stack')); renderParameterList();
}
function renderParameterList(): void {
  const body = $('#editor-content'); body.replaceChildren(); const stack = el('div', 'stack');
  const keys = Object.keys(schema.fields!).filter(k => query ? `${k} ${fieldHint(k)} ${groupFor(k)} ${JSON.stringify(doc.raw[k] ?? '')}`.toLowerCase().includes(query.toLowerCase()) : groupFor(k) === selected);
  if (!query && selected === '画面') { stack.append(filterOrder()); }
  const card = el('div', 'card parameter-fields');
  for (const key of keys) { card.append(parameterField(key, schema.fields![key], doc.raw[key] ?? data.defaults[key] ?? blankValue(schema.fields![key]), [key])); }
  stack.append(el('div', 'row between', ''), card); const count = stack.firstChild instanceof HTMLElement && stack.firstChild.className === 'row between' ? stack.firstChild : undefined;
  if (count) { count.append(el('small', '', query ? '搜索全部参数组' : selected + '参数'), el('span', 'count', keys.length + ' FIELDS')); }
  if (!keys.length) { card.append(el('p', 'muted', '没有匹配的参数。')); }
  body.append(stack);
}
function renderOutput(): void {
  const plan = currentPlan!, rendered = currentRendered!, issues = [...plan.issues, ...rendered.issues], incompatible = issues.some(x => x.level === 'error'), ready = plan.status === 'ready' && !incompatible;
  $('#task-summary').textContent = `${plan.tasks.length} 个输入 · ${plan.tasks.reduce((n, t) => n + t.stages.length, 0)} 个执行阶段 · ${labels[context.shell]}`;
  $('#status-title').textContent = incompatible ? '不兼容' : ready ? '命令已就绪' : '待补充信息'; $('#status-caption').textContent = incompatible ? '请处理以下兼容问题' : ready ? '复制完整脚本到所选终端执行' : '完成路径、资源或媒体信息确认'; $('#status-icon').textContent = ready ? '✓' : incompatible ? '×' : '◌'; $('#status-icon').style.color = ready ? 'var(--accent)' : incompatible ? 'var(--error)' : 'var(--orange)';
  const tabs = $('#preview-tabs'); tabs.replaceChildren();
  for (const [id, name] of [['commands', '命令'], ['stages', '阶段'], ['graph', '滤镜图'], ['args', '参数'], ['script', '完整脚本']]) { tabs.append(button(name, () => { previewTab = id; renderOutput(); }, 'tab' + (previewTab === id ? ' active' : ''))); }
  const previews: Record<string, string> = { script: rendered.script, commands: rendered.commands, stages: rendered.stages, graph: plan.tasks.flatMap(t => t.stages.filter(s => s.graph).map(s => `# ${s.name}\n${s.graph}`)).join('\n\n') || '此任务未使用复杂滤镜图。线性滤镜可在参数视图查看。', args: JSON.stringify(plan.tasks.map(t => ({ 输入: t.input, 输出: t.output, 阶段: t.stages.map(s => ({ 名称: s.name, 程序: s.executable, 参数: s.args, 映射: s.maps })) })), null, 2) };
  $('#command').textContent = previews[previewTab]; $('#terminal-title').textContent = (ready ? '' : 'PREVIEW · ') + labels[context.shell].toUpperCase();
  for (const id of ['copy-final', 'download-script', 'download-zip']) { $<HTMLButtonElement>('#' + id).disabled = !ready; }
  const issueBox = $('#issues'); issueBox.replaceChildren();
  if (issues.length) { issueBox.append(el('h3', '', '需要关注')); issues.forEach(issue => issueBox.append(el('div', 'issue ' + issue.level, issue.message))); }
  else { issueBox.append(el('div', 'note accent', context.shell === 'cmd' ? 'CMD 完整脚本调用系统 PowerShell 完成文件准备与精确参数传递。请使用延迟展开关闭的 CMD。' : '自动命名会在执行时检查实际文件冲突。普通命令视图使用当前候选输出路径。')); }
}
async function copy(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); toast('已复制到剪贴板'); }
  catch { const pre = $('#command'); pre.textContent = text; const range = document.createRange(); range.selectNodeContents(pre); const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range); toast('浏览器未允许自动复制，已选中文本，请按 Ctrl+C 或 ⌘C'); }
}
function openTextDialog(title: string, text: string, apply: (value: string) => void): void {
  const dialog = $<HTMLDialogElement>('#dialog'), body = $('#dialog-body'); $('#dialog-title').textContent = title; body.replaceChildren();
  const area = el('textarea', 'mono'); area.value = text; area.setAttribute('aria-label', title); const error = el('p', 'error-message'); body.append(area, error, button('应用', () => { try { apply(area.value); dialog.close(); } catch (e) { error.textContent = e instanceof Error ? e.message : String(e); } }, 'primary')); dialog.showModal();
}
$('#dialog-close').onclick = () => $<HTMLDialogElement>('#dialog').close();
$('#new').onclick = () => { doc = importPreset(); context = defaultContext(); navigate('任务与环境'); schedule(); toast('已创建新方案'); };
$('#import').onclick = () => pick('.json', async f => { doc = importPreset(await f.text()); context.confirmedPaths = []; schedule(); renderEditor(); toast('已导入：' + f.name); });
$('#export').onclick = () => save(exportPreset(doc), 'FFmpegFreeUI-v6.json', 'application/json');
$('#theme').onclick = () => { theme = theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = theme; cached(); };
$('#workspace').onclick = () => {
  const dialog = $<HTMLDialogElement>('#dialog'), body = $('#dialog-body'); $('#dialog-title').textContent = '工作区'; body.replaceChildren();
  const box = el('div', 'stack'); box.style.marginTop = '20px'; box.append(el('p', 'muted', '工作区包含原生预设、执行环境、已导入的探测结果和模板内容。'), button('下载工作区', () => save(JSON.stringify({ format: 'ffmpeg-command-forge/workspace', version: 1, preset: doc.raw, context, theme }, null, 2), 'Forge-workspace.json', 'application/json')), button('导入工作区', () => pick('.json', async f => { loadWorkspace(JSON.parse(await f.text())); schedule(); renderEditor(); renderNav(); dialog.close(); toast('工作区已恢复'); }))); body.append(box); dialog.showModal();
};
$('#copy-preview').onclick = () => { const text = $('#command').textContent || ''; void copy(currentPlan?.status === 'ready' && !currentRendered?.issues.some(i => i.level === 'error') ? text : (context.shell === 'cmd' ? 'REM 仅供预览，尚不可执行\n' : '# 仅供预览，尚不可执行\n') + text); };
$('#copy-final').onclick = () => { if (currentRendered) { void copy(currentRendered.script); } };
$('#download-script').onclick = () => { if (currentPlan && currentRendered) { const script = downloadableScript(currentPlan, currentRendered); save(currentRendered.filename.endsWith('.ps1') ? '\uFEFF' + script : script, currentRendered.filename, 'text/plain;charset=utf-8'); } };
$('#download-zip').onclick = () => {
  if (!currentPlan || !currentRendered) { return; }
  const files: Record<string, Uint8Array> = { [currentRendered.filename]: strToU8((currentRendered.filename.endsWith('.ps1') ? '\uFEFF' : '') + downloadableScript(currentPlan, currentRendered)), 'preset-v6.json': strToU8(exportPreset(doc)), 'README.txt': strToU8(`FFmpeg Command Forge\n终端：${labels[context.shell]}\n先检查脚本，然后在所选终端运行。输入媒体不包含在任务包内。\nWindows CMD 辅助脚本使用系统 PowerShell。\n模板副本位于 resources，脚本将内容写入计划中的实际路径。\n\n` + currentPlan.tasks.map(t => `${t.input}\n=> ${t.output}`).join('\n\n')) };
  currentRendered.assets.forEach((asset, i) => { files['resources/' + String(i + 1).padStart(3, '0') + '-' + filename(asset.path)] = strToU8(asset.content); });
  save(zipSync(files), 'Forge-task.zip', 'application/zip');
};

document.documentElement.dataset.theme = theme; renderNav(); renderEditor(); void recompute();
