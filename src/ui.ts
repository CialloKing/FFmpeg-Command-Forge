import { createEditorState } from './editor-state';
import { button, createControls, el, issueTarget, labeled, row, textInput } from './controls';
import { createParameterEditor } from './parameter-editor';
import { zipSync, strToU8 } from 'fflate';
import { revision, version as upstreamVersion } from '../docs/upstream.json';
import ffmpegFull from './data/ffmpeg-full-2026.11.3.json';
import { blankValue, clone, data, exportPreset, groupFor, groups, schema } from './preset';
import { associatedProbe, buildPlan, resolvedInput } from './plan';
import { renderCommand, renderPlan } from './render';
import { subtitleCandidates } from './filters';
import { filename, isPresetPathField, pathStyle } from './paths';
import { isProbeData } from './workspace';
import { createPersistence, type SaveState } from './persistence';
import { contextTarget, targetKey } from './diagnostics';
import { detectLocale, parameterLabel, presetText, translator, type Locale } from './i18n';
import type { CommandPlan, ExecutionContext, FieldPath, InputTask, IssueTarget, Preset, RenderedPlan, Shell } from './types';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const languageKey = 'ffmpeg-command-forge.language';
const browserLocale = () => detectLocale([...navigator.languages, navigator.language]);
function savedLocale(): Locale | null {
  try {
    const saved = localStorage.getItem(languageKey);
    return saved === 'zh-CN' || saved === 'en' ? saved : null;
  } catch { return null; }
}
let languagePreference = savedLocale();
let locale = languagePreference ?? browserLocale();
let t = translator(locale);
const state = createEditorState(() => t);
const { choiceInput } = createControls((text, ...values) => t(text, ...values));
const { parameterField, filterOrder, fieldHint } = createParameterEditor({
  readDocument: () => state.doc, readLocale: () => locale, translate: (text, ...values) => t(text, ...values),
  edit, openTextDialog, renderEditor, importTemplate
});
const labels: Record<Shell, string> = { powershell: 'PowerShell 7.3+', powershell5: 'Windows PowerShell 5.1', cmd: 'CMD（延迟展开关闭）', bash: 'Bash', zsh: 'Zsh' };
const cacheKey = 'ffmpeg-command-forge.workspace.v1', libraryKey = 'ffmpeg-command-forge.presets.v1';
const presetBaseline = `3FUI ${upstreamVersion}`;
const presetFormat = `v${data.defaults.预设文件版本} JSON`;
const presetHint = () => t('预设兼容基线 {0} · {1}', presetBaseline, presetFormat);
type PreviewTab = 'commands' | 'stages' | 'graph' | 'args' | 'script';
let previewTab: PreviewTab = 'commands';
let selected = '任务与环境', query = '', generation = 0, timer: ReturnType<typeof setTimeout>, currentPlan: CommandPlan | undefined, currentRendered: RenderedPlan | undefined;
let cacheState: SaveState = { dirty: false };
const persistence = createPersistence(cacheKey, workspaceSnapshot, state => {
  if (state.dirty !== cacheState.dirty || state.result !== cacheState.result) { cacheState = state; renderCacheStatus(); }
});
let library: { name: string; preset: Preset }[] = [];
function replacePreset(input?: string | Preset): void {
  state.replacePreset(input);
}
function mountApp(): void {
  document.documentElement.lang = locale;
  $<HTMLMetaElement>('meta[name=description]').content = t('离线 FFmpeg 命令生成器，预设兼容基线为 FFmpegFreeUI（3FUI）{0}，采用 v6 JSON 格式。', upstreamVersion);
  $('#app').innerHTML = `
  <header class="header">
    <div class="brand"><div class="brandmark" aria-hidden="true">⌘</div><div><div class="brand-name">FFmpeg Command Forge</div><div class="brand-subtitle">BUILD THE COMMAND. OWN THE FRAME.</div></div></div>
    <div class="toolbar">
      <button id="new" class="ghost optional">${t('新建方案')}</button>
      <button id="import" title="${presetHint()}">${t('导入预设')}</button>
      <button id="export" title="${presetHint()}">${t('导出预设')}</button>
      <button id="workspace" class="ghost optional">${t('工作区')}</button>
      <button id="more" class="ghost" aria-haspopup="dialog">${t('更多')}</button>
      <button id="language" class="ghost" aria-haspopup="dialog" aria-label="${t('语言')}" title="${t('语言')}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>
        </svg>
      </button>
      <button id="theme" class="ghost" aria-label="${t('切换明暗主题')}">◐</button>
    </div>
  </header>
  <div class="workspace">
    <nav class="sidebar" aria-label="${t('参数分类')}"></nav>
    <main class="editor"><div id="editor-head"></div><div id="editor-content"></div></main>
    <aside class="output" aria-label="${t('命令预览')}">
      <div><div class="row between"><span class="output-heading">${t('命令工作台')}</span><span class="pill green"><span class="dot"></span>${t('离线运行')}</span></div><div class="subline" id="task-summary">${t('等待配置输入文件')}</div></div>
      <div class="status-card"><div class="status-icon" id="status-icon">◌</div><div><div class="status-title" id="status-title">${t('正在构建')}</div><div class="status-caption" id="status-caption">${t('检查预设与执行环境')}</div></div></div>
      <div id="stream-summary" class="note stack" hidden></div>
      <div id="cache-status" class="note stack" role="status" hidden></div>
      <div><div class="tabs" id="preview-tabs"></div><div class="terminal"><div class="terminal-top"><span id="terminal-title">POWERSHELL</span><button id="copy-preview" class="ghost small">${t('复制预览')}</button></div><pre id="command" tabindex="0" aria-label="${t('生成的命令或脚本')}"></pre></div></div>
      <div class="stack">
        <button id="copy-final" class="primary" disabled>${t('复制最终脚本 ↗')}</button>
        <div class="download-row"><button id="download-script" disabled>${t('下载脚本')}</button><button id="download-zip" disabled>${t('下载任务包')}</button></div>
        <small>${t('最终脚本包含准备、转码和后处理。命令视图用于检查固定路径下的 FFmpeg 参数。')}</small>
      </div>
      <div id="issues"></div>
      <div class="output-footer">
        <div class="connection-line"><span class="dot" style="color:var(--accent)"></span>${t('媒体保留在本机 · 由你的 FFmpeg 执行')}</div>
        <div style="margin-top:7px">${t('预设兼容基线 {0} / {1}', presetBaseline, revision.slice(0, 7))}<br>${t('原生格式 {0}', presetFormat)}<br>${t('硬件编码与外部滤镜依赖本机环境。')}</div>
        <a href="https://github.com/CialloKing/FFmpeg-Command-Forge" target="_blank" rel="noopener noreferrer">${t('项目仓库（GitHub）')}</a>
      </div>
    </aside>
  </div>
  <div id="toast" role="status" hidden></div>
  <dialog id="dialog" aria-labelledby="dialog-title"><div class="row between"><h3 id="dialog-title"></h3><button id="dialog-close" class="ghost small" aria-label="${t('关闭')}">✕</button></div><div id="dialog-body"></div></dialog>`;
  bindApp();
  renderNav();
  renderEditor();
  renderCacheStatus();
}

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
function workspaceSnapshot() { return state.snapshot(); }
function workspaceText(): string { return JSON.stringify(workspaceSnapshot(), null, 2); }
function downloadWorkspace(): void { save(workspaceText(), 'Forge-workspace.json', 'application/json'); }
function renderCacheStatus(): void {
  const panel = document.querySelector<HTMLElement>('#cache-status');
  if (!panel) { return; }
  const { dirty, result } = cacheState;
  panel.hidden = !dirty && !result;
  panel.replaceChildren();
  if (!dirty && !result) { return; }
  if (result === 'saved') { panel.append(el('small', '', state.mappingErrors.length ? t('草稿已保存，路径映射仍需修正') : t('已保存到浏览器'))); return; }
  if (!result) { panel.append(el('small', '', t('修改等待保存'))); return; }
  const reasons = { quota: '浏览器缓存容量不足。', blocked: '浏览器阻止了本地存储。', failed: '浏览器缓存写入失败。' };
  panel.append(el('strong', '', t('当前修改尚未保存')), el('small', '', t(reasons[result])),
    button(t('下载工作区'), downloadWorkspace, 'small'));
}
function loadWorkspace(text: string): void {
  state.restore(text);
  document.documentElement.dataset.theme = state.theme;
}
try {
  const text = localStorage.getItem(cacheKey);
  if (text) { loadWorkspace(text); persistence.restored(); if (JSON.parse(text).version === 1) { persistence.schedule(); persistence.flush(); } }
} catch { /* A damaged workspace cache must not prevent a fresh session. */ }
try {
  const stored = JSON.parse(localStorage.getItem(libraryKey) || '[]');
  if (Array.isArray(stored)) { library = stored.filter(x => x && typeof x.name === 'string' && x.preset && typeof x.preset === 'object' && !Array.isArray(x.preset)); }
} catch { /* Saved presets are independent of workspace recovery. */ }
function edit(path: FieldPath, value: unknown): void {
  state.editPreset(path, value); schedule();
  // 排序面板与字段编辑共享同一预设，立即刷新以免沿用旧的生成 ID 和滤镜内容。
  document.querySelector('#filter-order')?.replaceChildren(filterOrder());
}
function updateContext(update: (context: ExecutionContext) => void): void { state.updateContext(update); schedule(); }
function updateTask(id: string, update: (task: InputTask) => void): void { if (state.updateTask(id, update)) { schedule(); } }

function schedule(save: 'deferred' | 'immediate' | false = 'deferred'): void {
  generation++; currentPlan = undefined; currentRendered = undefined;
  $('#stream-summary').hidden = true;
  $('#copy-preview').setAttribute('disabled', ''); $('#copy-final').setAttribute('disabled', ''); $('#download-script').setAttribute('disabled', ''); $('#download-zip').setAttribute('disabled', '');
  $('#status-title').textContent = t('正在构建'); $('#status-caption').textContent = t('检查预设与执行环境');
  clearTimeout(timer); timer = setTimeout(recompute, 100);
  if (save) { persistence.schedule(); if (save === 'immediate') { persistence.flush(); } }
}
async function recompute(): Promise<void> {
  const id = ++generation;
  try {
    const plan = await buildPlan(state.doc, state.context, t, state.allowOverwrite); if (id !== generation) { return; }
    if (state.mappingErrors.length) { plan.status = 'incompatible'; plan.issues.push({ level: 'error', message: mappingErrorText(), target: contextTarget(['pathMappings']) }); }
    currentPlan = plan; currentRendered = renderPlan(plan, t); renderOutput();
    for (const detail of document.querySelectorAll<HTMLElement>('[data-probe-index]')) {
      const index = Number(detail.dataset.probeIndex);
      renderProbeDetail(detail, associatedProbe(state.context.inputs[index], plan.probes[index].args.at(-1)!));
    }
  } catch (error) {
    if (id !== generation) { return; }
    currentPlan = undefined; currentRendered = undefined; $('#status-title').textContent = t('无法构建'); $('#status-caption').textContent = t('请检查参数或重新导入预设'); $('#command').textContent = String(error); $('#copy-final').setAttribute('disabled', '');
  }
}
function renderNav(): void {
  const nav = $('.sidebar'); nav.replaceChildren();
  nav.append(el('div', 'nav-caption', 'WORKSPACE'));
  for (const name of ['任务与环境', '预设库']) { const b = button(t(name), () => navigate(name), 'nav-item' + (selected === name ? ' active' : '')); nav.append(b); }
  nav.append(el('div', 'nav-caption', 'PARAMETERS'));
  for (const name of groups) { const b = button(t(name), () => navigate(name), 'nav-item' + (selected === name ? ' active' : '')); b.setAttribute('aria-label', t(name)); b.append(el('span', 'number', String(Object.keys(schema.fields!).filter(k => groupFor(k) === name).length).padStart(2, '0'))); nav.append(b); }
  nav.append(el('div', 'sidebar-foot', 'V1.0 / LOCAL FIRST\n' + t('参数属于你，执行由你掌控。')));
}
function navigate(name: string): void { selected = name; query = ''; renderEditor(); renderNav(); }
function openPresetJson(): void {
  openTextDialog(presetHint(), exportPreset(state.doc), text => { replacePreset(text); schedule('immediate'); renderEditor(); });
}
function focusIssue(target: IssueTarget): void {
  if (target.taskId && !state.context.inputs.some(task => task.id === target.taskId)) { toast(t('此问题对应的项目已变更，请查看最新诊断。')); return; }
  if (target.scope === 'preset' && !Object.hasOwn(schema.fields!, target.path[0])) { openPresetJson(); return; }
  navigate(target.scope === 'preset' ? groupFor(String(target.path[0])) : '任务与环境');
  const targets = [...document.querySelectorAll<HTMLElement>('[data-issue-target]')];
  const node = targets.find(node => node.dataset.issueTarget === targetKey(target)) ??
    (target.taskId ? targets.find(node => node.dataset.issueTarget === targetKey(contextTarget([], target.taskId))) : undefined);
  if (!node) { if (target.scope === 'preset') { openPresetJson(); } return; }
  for (let parent: HTMLElement | null = node; parent; parent = parent.parentElement) { if (parent instanceof HTMLDetailsElement) { parent.open = true; } }
  const detail = node.querySelector('details'); if (detail) { detail.open = true; }
  const control = node.querySelector<HTMLElement>('input,textarea,select,button,summary') ?? node;
  if (control === node) { node.tabIndex = -1; }
  node.scrollIntoView({ block: 'center' }); control.focus({ preventScroll: true });
  node.classList.add('issue-focus'); setTimeout(() => node.classList.remove('issue-focus'), 2000);
}
function heading(title: string, number: string): HTMLDivElement { const h = el('div', 'section-line'); h.append(el('span', '', number), el('h3', '', title)); return h; }
function renderProbeDetail(detail: HTMLElement, probe: ReturnType<typeof associatedProbe>): void {
  detail.hidden = !probe;
  detail.textContent = probe ? t('已关联此路径 · {0} 个流 · 时长 {1} 秒', probe.streams?.length ?? 0, probe.format?.duration ?? t('未知')) : '';
}
function importTemplate(key: string): void {
  pick('.avs,.vpy,.py,.txt', async file => {
    const content = await file.text();
    const path = String(state.doc.normalized[key] || file.name);
    if (!state.doc.normalized[key]) { edit([key], file.name); }
    updateContext(current => { current.resources[path] = content; }); renderEditor(); toast(t('已导入模板：{0}', file.name));
  });
}
function environment(): HTMLElement {
  const field = (key: string, label: string, node: HTMLElement, hint = '') => issueTarget(labeled(label, node, hint), contextTarget([key]));
  const content = el('div', 'stack');
  const card = el('div', 'card stack'), grid = el('div', 'grid2');
  grid.append(field('platform', t('目标系统'), choiceInput([['windows', 'Windows'], ['macos', 'macOS'], ['linux', 'Linux']], state.context.platform, v => { updateContext(current => { current.platform = v as ExecutionContext['platform']; current.shell = v === 'windows' ? 'powershell' : v === 'macos' ? 'zsh' : 'bash'; current.confirmedPaths = []; current.inputs.forEach(task => { task.probe = undefined; task.sidecarsConfirmed = false; }); }); renderEditor(); })), field('shell', t('执行终端'), choiceInput(Object.entries(labels).map(([value, label]) => [value, t(label)]), state.context.shell, v => { updateContext(current => { current.shell = v as Shell; }); })));
  grid.append(field('ffmpeg', t('FFmpeg 程序'), textInput(state.context.ffmpeg, v => { updateContext(current => { current.ffmpeg = v; }); }), t('默认从 PATH 查找，也可填写完整路径')), field('ffprobe', t('ffprobe 程序'), textInput(state.context.ffprobe, v => { updateContext(current => { current.ffprobe = v; }); })));
  grid.append(field('cwd', t('工作目录'), textInput(state.context.cwd, v => { updateContext(current => { current.cwd = v; }); }, t('例如 {0}', state.context.platform === 'windows' ? 'D:\\Media' : '/home/user/Media')), t('相对路径将在此目录下解释')), field('outputDirectory', t('本次输出目录'), textInput(state.context.outputDirectory, v => { updateContext(current => { current.outputDirectory = v; }); }, t('留空时使用预设或输入文件目录'))));
  const overwrite = el('input'); overwrite.type = 'checkbox'; overwrite.checked = state.allowOverwrite;
  overwrite.onchange = () => { state.setOverwrite(overwrite.checked); schedule(false); };
  const overwriteField = labeled(t('允许本批脚本覆盖已有输出'), overwrite, t('递增命名仍会避让已有文件。命令预览始终使用防覆盖模式。'));
  overwriteField.classList.add('boolean'); overwriteField.prepend(overwrite);
  card.append(grid, overwriteField);
  content.append(heading(t('执行环境'), '01'), card, heading(t('输入文件'), '02'));
  const note = el('p', 'note', t('粘贴实际路径，或使用“工作目录 + 相对文件名”。拖入文件只取得文件名，不会把浏览器的虚拟路径当作本机路径。')); content.append(note);
  state.context.inputs.forEach((task, index) => {
    const taskField = (key: string, label: string, node: HTMLElement, hint = '') => issueTarget(labeled(label, node, hint), contextTarget([key], task.id));
    const block = issueTarget(el('div', 'input-task'), contextTarget([], task.id)), title = row(el('span', 'task-id', 'INPUT ' + String(index + 1).padStart(2, '0')), el('span', 'grow'), button(t('移除'), () => { updateContext(current => { current.inputs = current.inputs.filter(input => input.id !== task.id); }); renderEditor(); }, 'small ghost'));
    const pathInput = textInput(task.path, v => { updateTask(task.id, current => { current.path = v; current.probe = undefined; current.sidecarsConfirmed = false; }); }, t('输入媒体文件的真实路径')); pathInput.setAttribute('aria-label', t('输入文件 {0} 路径', index + 1));
    pathInput.ondragover = e => e.preventDefault(); pathInput.ondrop = e => { e.preventDefault(); const f = e.dataTransfer?.files[0]; if (f) { updateTask(task.id, current => { current.path = f.name; current.probe = undefined; current.sidecarsConfirmed = false; }); renderEditor(); toast(t('已取得文件名，请确认执行目录或补充真实路径')); } };
    block.append(title, taskField('path', t('输入路径'), pathInput), taskField('output', t('指定输出文件（可选）'), textInput(task.output || '', v => { updateTask(task.id, current => { current.output = v; }); }), t('填写后覆盖本次自动命名')));
    const actions = el('div', 'row wrap');
    const applyProbe = (text: string) => { const probe: unknown = JSON.parse(text.replace(/^\uFEFF/, '')); if (!isProbeData(probe)) { throw new Error(t('文件不是 ffprobe 的 JSON 输出')); } updateTask(task.id, current => { current.probe = { path: current.path, resolvedPath: resolvedInput(current, state.context), data: probe }; }); renderEditor(); };
    actions.append(button(t('导入 ffprobe JSON'), () => pick('.json', async f => applyProbe(await f.text())), 'small'), button(t('复制探测命令'), () => { const stage = currentPlan?.probes.find(s => s.taskId === task.id); if (stage) { void copy(renderCommand(stage, state.context.shell, false, t)); } }, 'small ghost'), button(t('粘贴探测结果'), () => openTextDialog(t('导入 ffprobe 结果'), '', text => applyProbe(text)), 'small ghost'));
    block.append(issueTarget(actions, contextTarget(['probe'], task.id)));
    const probeDetail = el('small'); probeDetail.dataset.probeIndex = String(index);
    renderProbeDetail(probeDetail, associatedProbe(task, resolvedInput(task, state.context)));
    block.append(probeDetail);
    const a = state.doc.normalized;
    if (a.视频参数_烧录字幕_滤镜选择 && a.视频参数_烧录字幕_字幕来源是外部文件 === 1) {
      const input = textInput(task.subtitle || '', v => { updateTask(task.id, current => { current.subtitle = v; }); }, t('实际字幕路径')); const candidates = subtitleCandidates(a, task.path.trim(), pathStyle(state.context.platform));
      block.append(taskField('subtitle', t('本次烧录的外部字幕'), input, t('候选：{0}', candidates.join(' · '))));
      const candidateButtons = el('div', 'row wrap'); candidates.forEach(p => candidateButtons.append(button(filename(p, pathStyle(state.context.platform)), () => { updateTask(task.id, current => { current.subtitle = p; }); renderEditor(); }, 'small'))); block.append(candidateButtons);
    }
    if (['SRT', 'ASS', 'SSA'].some(k => a['流控制_自动混流' + k])) {
      const input = el('textarea', 'mono'); input.value = (task.sidecars || []).join('\n'); input.placeholder = t('每行一个已确认存在的同名字幕路径，可留空'); input.oninput = () => { updateTask(task.id, current => { current.sidecars = input.value.split(/\r?\n/).map(x => x.trim()).filter(Boolean); current.sidecarsConfirmed = false; }); };
      block.append(taskField('sidecars', t('同名字幕清单'), input), button(task.sidecarsConfirmed ? t('✓ 已确认此字幕清单') : t('确认字幕清单（包括空清单）'), () => { updateTask(task.id, current => { current.sidecarsConfirmed = true; }); renderEditor(); }, 'small'));
    }
    content.append(block);
  });
  const addTasks = row(button(t('+ 添加输入'), () => { updateContext(current => { current.inputs.push({ id: crypto.randomUUID().replaceAll('-', ''), path: '' }); }); renderEditor(); }), button(t('批量粘贴路径'), () => openTextDialog(t('每行一个输入文件路径'), '', text => { updateContext(current => { for (const p of text.split(/\r?\n/).map(x => x.trim()).filter(Boolean)) { current.inputs.push({ id: crypto.randomUUID().replaceAll('-', ''), path: p.replace(/^"(.*)"$/, '$1') }); } if (current.inputs[0]?.path === '') { current.inputs.shift(); } }); renderEditor(); }), 'ghost')); content.append(issueTarget(addTasks, contextTarget(['inputs'])));
  content.append(heading(t('预设路径与资源'), '03'));
  const mappingCard = el('div', 'card stack'), mappings = el('textarea', 'mono'); mappings.value = state.drafts.pathMappings; mappings.placeholder = t('例如 {0}', 'D:\\Media => /Volumes/Media');
  const mappingError = el('p', 'error-message'); mappingError.setAttribute('role', 'status');
  const updateMappingError = () => { mappingError.hidden = !state.mappingErrors.length; mappingError.textContent = mappingErrorText(); mappings.setAttribute('aria-invalid', String(!!state.mappingErrors.length)); };
  mappings.oninput = () => { state.editMappings(mappings.value); updateMappingError(); schedule(); renderCacheStatus(); };
  updateMappingError(); mappingCard.append(mappingError);
  mappingCard.append(field('pathMappings', t('显式路径映射'), mappings, t('每行一条“原目录 => 目标目录”，只转换确认过的前缀。')));
  mappingCard.append(button(t('确认预设中的路径用于当前环境'), () => {
    const values: string[] = []; const visit = (o: Preset) => Object.entries(o).forEach(([k, v]) => { if (typeof v === 'string' && isPresetPathField(k)) { values.push(v); } else if (v && typeof v === 'object') { if (Array.isArray(v)) { v.filter(x => x && typeof x === 'object').forEach(visit); } else { visit(v); } } }); visit(state.doc.normalized); updateContext(current => { current.confirmedPaths = [...new Set([...current.confirmedPaths, ...values])]; }); toast(t('已确认当前预设中的资源路径'));
  }, 'small'));
  const resources = el('div', 'stack');
  for (const kind of ['avs', 'vpy']) {
    const key = '视频参数_视频帧服务器_' + kind + '脚本文件'; const path = state.doc.normalized[key];
    if (path || state.doc.normalized['视频参数_视频帧服务器_使用' + (kind === 'avs' ? 'AviSynth' : 'VapourSynth')]) { const block = el('div', 'resource'); block.append(el('p', '', (path || t('未选择 {0} 模板', kind)) + (state.context.resources[path] !== undefined ? t(' · 内容已导入') : '')), button(t('导入模板内容'), () => importTemplate(key), 'small')); resources.append(block); }
  }
  mappingCard.append(resources); content.append(issueTarget(mappingCard, contextTarget(['resources']))); return content;
}
function presetCard(presets: { 名称: string; 数据: Preset }[], label: string): HTMLElement {
  const card = el('section', 'card preset-card');
  card.setAttribute('aria-label', label);
  const texts = presets.map(preset => presetText(locale, preset.名称, preset.数据.预设备注 ?? ''));
  let index = 0;
  const description = el('p', 'description', texts[index]?.note ?? '');
  const choice = choiceInput(texts.map(({ name }, i) => [String(i), name]), '0', value => {
    index = Number(value);
    description.textContent = texts[index]?.note ?? '';
  });
  card.append(labeled(label, choice), description, button(t('应用此预设'), () => {
    const preset = presets[index];
    if (!preset) { return; }
    replacePreset(preset.数据);
    schedule('immediate');
    toast(t('已应用：{0}', texts[index].name));
  }, 'primary'));
  return card;
}
function presetLibrary(): HTMLElement {
  const content = el('div', 'stack');
  content.append(el('div', 'banner', t('原生预设格式为 {0}（预设文件版本 = {1}）。工作目录、终端和探测结果保存在独立工作区中。', presetFormat, data.defaults.预设文件版本)));
  content.append(heading(t('内置预设'), '01'), presetCard(data.builtins, t('3FUI 内置预设')));
  const fullCard = presetCard(ffmpegFull.presets, t('ffmpeg-full 发行版预设'));
  const source = el('a', 'muted', t('查看发行版与运行要求'));
  source.href = ffmpegFull.release;
  source.target = '_blank';
  source.rel = 'noopener noreferrer';
  fullCard.append(source);
  content.append(heading(`ffmpeg-full ${ffmpegFull.version}`, '02'), fullCard, heading(t('我的预设'), '03'));
  const saved = el('div', 'card stack'), name = textInput('', () => {}, t('为当前预设命名'));
  saved.append(row(name, button(t('保存副本'), () => { if (!name.value.trim()) { toast(t('请先填写预设名称')); return; } library.push({ name: name.value.trim(), preset: clone(state.doc.raw) }); persistLibrary(); renderEditor(); }, 'small')));
  library.forEach((p, i) => { const r = el('div', 'saved-row'); r.append(el('span', 'grow', p.name), button(t('应用'), () => { replacePreset(p.preset); schedule('immediate'); toast(t('已应用：{0}', p.name)); }, 'small'), button(t('导出'), () => save(JSON.stringify(p.preset, null, 2), p.name + '.json', 'application/json'), 'small ghost'), button('×', () => { library.splice(i, 1); persistLibrary(); renderEditor(); }, 'small ghost')); saved.append(r); });
  saved.append(el('small', '', t('浏览器副本用于便利恢复。重要预设请下载 JSON 文件保存。'))); content.append(saved, heading(t('原生预设'), '04'), button(t('查看或编辑完整 JSON'), openPresetJson, 'ghost')); return content;
}
function persistLibrary(): void { try { localStorage.setItem(libraryKey, JSON.stringify(library)); } catch { toast(t('浏览器存储不可用，请导出 JSON 保存')); } }
function renderEditor(): void {
  const head = $('#editor-head'), body = $('#editor-content'); head.replaceChildren(); body.replaceChildren();
  const captions: Record<string, string> = { '任务与环境': t('从你的素材开始'), '预设库': t('让好参数成为下一次的起点'), '输出': t('定义最终交付'), '画面': t('精确控制每一帧'), '编码器': t('选择合适的编码方式') };
  head.className = 'editor-head'; head.append(el('div', 'eyebrow', selected === '任务与环境' ? '01 / CONFIGURE YOUR TASK' : selected === '预设库' ? 'PRESET LIBRARY' : 'PARAMETER EDITOR'), el('h2', '', captions[selected] || t(selected)), el('p', 'subtitle', selected === '任务与环境' ? t('配置执行环境、输入输出和媒体信息。') : selected === '预设库' ? t('预设兼容基线为 {0}（FFmpegFreeUI）。', presetBaseline) : t('参数即时生成命令，实际执行由本机 FFmpeg 完成。')));
  if (selected === '任务与环境') { body.append(environment()); return; }
  if (selected === '预设库') { body.append(presetLibrary()); return; }
  const search = el('div', 'search'); const input = textInput(query, v => { query = v; renderParameterList(); }, t('搜索参数、字段名或 FFmpeg 选项')); input.setAttribute('aria-label', t('搜索全部参数')); search.append(input); head.append(search);
  body.append(el('div', 'stack')); renderParameterList();
}
function renderParameterList(): void {
  const body = $('#editor-content'); body.replaceChildren(); const stack = el('div', 'stack');
  const keys = Object.keys(schema.fields!).filter(k => query ? `${k} ${parameterLabel(locale, k)} ${fieldHint(k)} ${groupFor(k)} ${t(groupFor(k))} ${JSON.stringify(state.doc.raw[k] ?? '')}`.toLowerCase().includes(query.toLowerCase()) : groupFor(k) === selected);
  if (!query && selected === '画面') { const order = el('div'); order.id = 'filter-order'; order.append(filterOrder()); stack.append(order); }
  const card = el('div', 'card parameter-fields');
  for (const key of keys) { card.append(parameterField(key, schema.fields![key], state.doc.raw[key] ?? data.defaults[key] ?? blankValue(schema.fields![key]), [key])); }
  stack.append(el('div', 'row between', ''), card); const count = stack.firstChild instanceof HTMLElement && stack.firstChild.className === 'row between' ? stack.firstChild : undefined;
  if (count) { count.append(el('small', '', query ? t('搜索全部参数组') : t('{0}参数', t(selected))), el('span', 'count', keys.length + ' FIELDS')); }
  if (!keys.length) { card.append(el('p', 'muted', t('没有匹配的参数。'))); }
  body.append(stack);
}
function renderStreams(plan: CommandPlan): void {
  const panel = $('#stream-summary');
  panel.replaceChildren();
  const descriptions = { mapped: '已确认匹配', pending: '映射待确认', automatic: 'FFmpeg 自动选择', omitted: '未映射', unknown: '请查看参数' };
  const rows = new Map<string, number>();
  for (const { streams } of plan.tasks) {
    if (!streams) { continue; }
    const selection = t('视频：{0} · 音频：{1} · 字幕：{2}', t(descriptions[streams.v]), t(descriptions[streams.a]), t(descriptions[streams.s]));
    const hint = streams.fallback === 'possible' ? t('若可选映射均未匹配，FFmpeg 可能自动选择。') :
      streams.fallback === 'confirmed' ? t('可选映射均未匹配，FFmpeg 将自动选择。') : '';
    const text = hint ? selection + ' · ' + hint : selection;
    rows.set(text, (rows.get(text) ?? 0) + 1);
  }
  panel.hidden = !rows.size;
  if (!rows.size) { return; }
  panel.append(el('strong', '', t('输出流')));
  for (const [text, count] of rows) {
    panel.append(el('small', '', rows.size === 1 ? text : t('{0} 个任务 · {1}', count, text)));
  }
  const a = state.doc.normalized;
  const audioConfigured = a.流控制_启用保留其他音频流 || a.流控制_将音频参数应用于指定流.length ||
    a.滤镜排序系统.some((filter: Preset) => filter.滤镜目标流类型 === 2) ||
    Object.keys(schema.fields!).some(key => key.startsWith('音频参数_') && JSON.stringify(a[key]) !== JSON.stringify(data.defaults[key]));
  if (!audioConfigured && plan.tasks.some(task => task.streams?.v === 'mapped' && task.streams.a === 'omitted' && task.streams.sourceAudio)) {
    panel.append(button(t('复制源音频'), () => {
      state.updatePreset(raw => { raw.音频参数_编码器_代号 = 'audio.copy'; raw.流控制_启用保留其他音频流 = true; });
      schedule();
      renderEditor();
    }, 'small'));
  }
}

function previewText(plan: CommandPlan, rendered: RenderedPlan): string {
  if (previewTab === 'graph') {
    return plan.tasks.flatMap(task => task.stages.filter(stage => stage.graph).map(stage => `# ${stage.name}\n${stage.graph}`)).join('\n\n') ||
      t('此任务未使用复杂滤镜图。线性滤镜可在参数视图查看。');
  }
  if (previewTab === 'args') {
    return JSON.stringify(plan.tasks.map(task => ({
      [t('输入')]: task.input,
      [t('输出')]: task.output,
      [t('阶段')]: task.stages.map(stage => ({ [t('名称')]: stage.name, [t('程序')]: stage.executable, [t('参数')]: stage.args, [t('映射')]: stage.maps }))
    })), null, 2);
  }
  if (previewTab === 'script' && !rendered.copyable) { return rendered.download.content.trimStart(); }
  return rendered[previewTab];
}

function mappingErrorText(): string { return t('路径映射第 {0} 行格式无效；预览仍使用上次有效映射，请修正后输出。', state.mappingErrors.join('、')); }
function canOutput(): boolean { return !state.mappingErrors.length && currentPlan?.status === 'ready' && !!currentRendered && !currentRendered.issues.some(issue => issue.level === 'error'); }
function renderOutput(): void {
  const plan = currentPlan!, rendered = currentRendered!, issues = [...plan.issues, ...rendered.issues], incompatible = issues.some(x => x.level === 'error'), ready = plan.status === 'ready' && !incompatible;
  $('#task-summary').textContent = t('{0} 个输入 · {1} 个执行阶段 · {2}', plan.tasks.length, plan.tasks.reduce((n, t) => n + t.stages.length, 0), t(labels[state.context.shell]));
  renderStreams(plan);
  $('#status-title').textContent = incompatible ? t('不兼容') : ready ? t('命令已就绪') : t('待补充信息');
  $('#status-caption').textContent = incompatible ? t('请处理以下兼容问题') : !ready ? t('完成路径、资源或媒体信息确认') :
    rendered.copyable ? t('复制完整脚本到所选终端执行') : t('下载 PowerShell 脚本，或解压任务包运行 CMD 启动器。');
  $('#status-icon').textContent = ready ? '✓' : incompatible ? '×' : '◌';
  $('#status-icon').style.color = ready ? 'var(--accent)' : incompatible ? 'var(--error)' : 'var(--orange)';
  const tabs = $('#preview-tabs'); tabs.replaceChildren();
  const updatePreview = () => {
    $('#command').textContent = previewText(plan, rendered);
    const fallback = previewTab === 'script' && !rendered.copyable;
    $('#terminal-title').textContent = (ready ? '' : 'PREVIEW · ') + (fallback ? 'POWERSHELL 5.1' : t(labels[state.context.shell]).toUpperCase());
    $<HTMLButtonElement>('#copy-preview').disabled = fallback || !!state.mappingErrors.length;
  };
  const labelsByTab: [PreviewTab, string][] = [['commands', t('命令')], ['stages', t('阶段')], ['graph', t('滤镜图')], ['args', t('参数')], ['script', t('完整脚本')]];
  for (const [id, name] of labelsByTab) {
    const tab = button(name, () => {
      if (!currentPlan || !currentRendered || id === previewTab) { return; }
      previewTab = id;
      tabs.querySelector('.active')?.classList.remove('active');
      tab.classList.add('active');
      updatePreview();
    }, 'tab' + (previewTab === id ? ' active' : ''));
    tabs.append(tab);
  }
  updatePreview();
  $<HTMLButtonElement>('#copy-final').disabled = !ready || !rendered.copyable;
  for (const id of ['download-script', 'download-zip']) { $<HTMLButtonElement>('#' + id).disabled = !ready; }
  const issueBox = $('#issues'); issueBox.replaceChildren();
  if (issues.length) {
    issueBox.append(el('h3', '', t('需要关注')));
    for (const issue of issues) {
      const index = issue.target?.taskId ? state.context.inputs.findIndex(task => task.id === issue.target!.taskId) : -1;
      const message = index >= 0 && state.context.inputs.length > 1 ? t('输入 {0}：{1}', index + 1, issue.message) : issue.message;
      issueBox.append(issue.target ? button(message, () => focusIssue(issue.target!), 'issue issue-link ' + issue.level) : el('div', 'issue ' + issue.level, message));
    }
  }
  else { issueBox.append(el('div', 'note accent', state.context.shell === 'cmd' ? t('CMD 完整脚本调用系统 PowerShell 完成文件准备与精确参数传递。请使用延迟展开关闭的 CMD。') : t('自动命名会在执行时检查实际文件冲突。普通命令视图使用当前候选输出路径。'))); }
}
async function copy(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); toast(t('已复制到剪贴板')); }
  catch { const pre = $('#command'); pre.textContent = text; const range = document.createRange(); range.selectNodeContents(pre); const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range); toast(t('浏览器未允许自动复制，已选中文本，请按 Ctrl+C 或 ⌘C')); }
}
function openTextDialog(title: string, text: string, apply: (value: string) => void): void {
  const dialog = $<HTMLDialogElement>('#dialog'), body = $('#dialog-body'); $('#dialog-title').textContent = title; body.replaceChildren();
  const area = el('textarea', 'mono'); area.value = text; area.setAttribute('aria-label', title); const error = el('p', 'error-message'); body.append(area, error, button(t('应用'), () => { try { apply(area.value); dialog.close(); } catch (e) { error.textContent = e instanceof Error ? e.message : String(e); } }, 'primary')); dialog.showModal();
}
function openLanguageDialog(): void {
  const dialog = $<HTMLDialogElement>('#dialog');
  const choices: [Locale | null, string][] = [[null, t('跟随浏览器')], ['zh-CN', '简体中文'], ['en', 'English']];
  const controls = choices.map(([preference, label]) => {
    const current = preference === languagePreference;
    const choice = button(label, () => { dialog.close(); selectLanguage(preference); }, current ? 'primary' : '');
    choice.lang = preference ?? locale;
    choice.setAttribute('aria-pressed', String(current));
    return choice;
  });
  const options = row(...controls);
  options.classList.add('wrap', 'language-options');
  $('#dialog-title').textContent = t('语言');
  $('#dialog-body').replaceChildren(options);
  dialog.showModal();
}
function selectLanguage(preference: Locale | null): void {
  languagePreference = preference;
  try {
    if (preference) { localStorage.setItem(languageKey, preference); }
    else { localStorage.removeItem(languageKey); }
  } catch { /* The language can still be changed for this page when storage is unavailable. */ }
  const nextLocale = preference ?? browserLocale();
  if (nextLocale === locale) { return; }
  locale = nextLocale;
  t = translator(locale);
  // Rebuild localized diagnostics from the original preset while keeping the current task in memory.
  state.localize();
  mountApp();
  $('#language').focus();
  schedule(false);
}
function newWorkspace(): void {
  state.reset(); navigate('任务与环境'); schedule('immediate'); toast(t('已创建新方案'));
}

function openWorkspaceDialog(): void {
  const dialog = $<HTMLDialogElement>('#dialog'), body = $('#dialog-body'); $('#dialog-title').textContent = t('工作区'); body.replaceChildren();
  const box = el('div', 'stack'); box.style.marginTop = '20px';
  const error = el('p', 'error-message'); error.setAttribute('role', 'alert'); error.hidden = true;
  box.append(el('p', 'muted', t('工作区包含原生预设、执行环境、已导入的探测结果和模板内容。')),
    button(t('下载工作区'), downloadWorkspace),
    button(t('导入工作区'), () => pick('.json', async file => {
      try { loadWorkspace(await file.text()); }
      catch (cause) { error.textContent = cause instanceof Error ? cause.message : String(cause); error.hidden = false; return; }
      schedule('immediate'); renderEditor(); renderNav(); dialog.close();
      toast(cacheState.result === 'saved' ? t('工作区已恢复') : t('工作区已载入，缓存未保存，请下载工作区。'));
    })), error);
  body.append(box); dialog.showModal();
}

function openMoreDialog(): void {
  const dialog = $<HTMLDialogElement>('#dialog');
  $('#dialog-title').textContent = t('更多操作');
  const actions = row(button(t('新建方案'), () => { dialog.close(); newWorkspace(); }),
    button(t('工作区'), () => { dialog.close(); openWorkspaceDialog(); }));
  actions.classList.add('wrap', 'language-options');
  $('#dialog-body').replaceChildren(actions);
  dialog.showModal();
}

function bindApp(): void {
  $('#language').onclick = openLanguageDialog;
  $('#dialog-close').onclick = () => $<HTMLDialogElement>('#dialog').close();
  $('#new').onclick = newWorkspace;
  $('#workspace').onclick = openWorkspaceDialog;
  $('#more').onclick = openMoreDialog;
  $('#import').onclick = () => pick('.json', async f => { replacePreset(await f.text()); state.updateContext(current => { current.confirmedPaths = []; }); schedule('immediate'); renderEditor(); toast(t('已导入：{0}', f.name)); });
  $('#export').onclick = () => save(exportPreset(state.doc), 'FFmpegFreeUI-v6.json', 'application/json');
  $('#theme').onclick = () => { state.setTheme(state.theme === 'dark' ? 'light' : 'dark'); document.documentElement.dataset.theme = state.theme; persistence.schedule(); };
  $('#copy-preview').onclick = () => { if (state.mappingErrors.length) { return; } const text = $('#command').textContent || ''; void copy(currentPlan?.status === 'ready' && !currentRendered?.issues.some(i => i.level === 'error') ? text : (state.context.shell === 'cmd' ? 'REM ' : '# ') + t('仅供预览，尚不可执行') + '\n' + text); };
  $('#copy-final').onclick = () => { if (canOutput() && currentRendered?.copyable) { void copy(currentRendered.script); } };
  $('#download-script').onclick = () => { if (canOutput() && currentRendered) { const { content, name } = currentRendered.download; save(content, name, 'text/plain;charset=utf-8'); } };
  $('#download-zip').onclick = () => {
    if (!canOutput() || !currentPlan || !currentRendered) { return; }
    const files: Record<string, Uint8Array> = { 'preset-v6.json': strToU8(exportPreset(state.doc)), 'README.txt': strToU8(['FFmpeg Command Forge', t('终端：{0}', t(labels[state.context.shell])), t('先检查脚本，然后在所选终端运行。输入媒体不包含在任务包内。'), ...(state.context.shell === 'cmd' ? [t('解压整个任务包后运行 forge-task.cmd。启动器需要同目录的 forge-task.ps1。')] : []), t('模板副本位于 resources，完整脚本会准备所需的临时文件。'), '', ''].join('\n') + currentPlan.tasks.map(t => `${t.input}\n=> ${t.output}`).join('\n\n')) };
    for (const { name, content } of currentRendered.bundleScripts) { files[name] = strToU8(content); }
    currentRendered.assets.forEach((asset, i) => { files['resources/' + String(i + 1).padStart(3, '0') + '-' + filename(asset.path, pathStyle(state.context.platform)).replaceAll('\\', '_')] = strToU8(asset.content); });
    save(zipSync(files), 'Forge-task.zip', 'application/zip');
  };
}

window.addEventListener('pagehide', () => persistence.flush());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { persistence.flush(); } });
document.documentElement.dataset.theme = state.theme;
mountApp();
void recompute();
