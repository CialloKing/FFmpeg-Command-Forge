import { clone, importPreset } from './preset';
import { defaultContext } from './plan';
import { parseMappingDraft, parseWorkspace } from './workspace';
import type { Translate } from './i18n';
import type { ExecutionContext, FieldPath, InputTask, Preset } from './types';

// 状态只负责数据更新；调度、存储和 DOM 由入口连接，避免模块反向依赖视图。
export function createEditorState(translate: () => Translate) {
  const read = (input?: string | Preset) => importPreset(input, translate());
  let doc = read(), context = defaultContext(), theme = 'dark', allowOverwrite = false;
  let baseline = read(doc.raw);
  let drafts = { pathMappings: '' }, mappingErrors: number[] = [];
  let revision = 0, importSequence = 0;
  const checkpoint = () => clone({ preset: doc.raw, baselinePreset: baseline.raw, context, drafts });
  let undoEntry: { label: string; before: ReturnType<typeof checkpoint> } | undefined;
  const changed = () => { revision++; undoEntry = undefined; allowOverwrite = false; };
  function restoreCheckpoint(before: ReturnType<typeof checkpoint>): void {
    doc = read(before.preset); baseline = read(before.baselinePreset); context = before.context; drafts = before.drafts;
    mappingErrors = parseMappingDraft(drafts.pathMappings).invalidLines;
  }
  function updatePreset(update: (raw: Preset) => void): void {
    const raw = clone(doc.raw); update(raw); const next = read(raw);
    if (JSON.stringify(raw) === JSON.stringify(doc.raw)) { return; }
    doc = next; changed();
  }
  return {
    get doc() { return doc; },
    get baseline() { return baseline; },
    get context() { return context; },
    get theme() { return theme; },
    get allowOverwrite() { return allowOverwrite; },
    get drafts() { return drafts; },
    get mappingErrors() { return mappingErrors; },
    get undoLabel() { return undoEntry?.label; },
    perform(label: string, action: () => void) {
      const before = checkpoint(), previous = undoEntry, previousRevision = revision, previousTheme = theme, previousOverwrite = allowOverwrite;
      try { action(); undoEntry = { label, before }; }
      catch (cause) {
        // 失败操作不能破坏数据、已有撤销记录或仍有效的导入令牌。
        if (revision !== previousRevision) { restoreCheckpoint(before); }
        undoEntry = previous; revision = previousRevision; theme = previousTheme; allowOverwrite = previousOverwrite;
        throw cause;
      }
    },
    undo(): boolean {
      if (!undoEntry) { return false; }
      restoreCheckpoint(undoEntry.before); allowOverwrite = false; changed(); return true;
    },
    beginImport() { return { revision, sequence: ++importSequence }; },
    acceptsImport(token: { revision: number; sequence: number }) { return token.revision === revision && token.sequence === importSequence; },
    editMappings(text: string) {
      if (text === drafts.pathMappings) { return; }
      drafts.pathMappings = text;
      const parsed = parseMappingDraft(text); mappingErrors = parsed.invalidLines;
      // 不完整的输入仍可保存，但不能部分应用路径变换。
      if (!mappingErrors.length) { context.pathMappings = parsed.mappings; }
      changed();
    },
    updatePreset,
    replacePreset(input?: string | Preset) { const next = read(input); baseline = read(next.raw); doc = next; changed(); },
    editPresetJson(text: string) { const next = read(text); if (JSON.stringify(next.raw) !== JSON.stringify(doc.raw)) { doc = next; changed(); } },
    resetField(path: FieldPath, defaults: boolean) {
      const source = defaults ? read().raw : baseline.raw;
      const value = path.reduce<any>((value, key) => value?.[key], source);
      updatePreset(raw => {
        let target = raw;
        for (const key of path.slice(0, -1)) {
          if (!target[key] || typeof target[key] !== 'object') { if (value === undefined) { return; } target[key] = {}; }
          target = target[key];
        }
        if (value === undefined) { delete target[path.at(-1)!]; } else { target[path.at(-1)!] = clone(value); }
      });
    },
    editPreset(path: FieldPath, value: unknown) {
      updatePreset(raw => {
        let target = raw;
        path.slice(0, -1).forEach((key, index) => {
          if (!target[key] || typeof target[key] !== 'object') { target[key] = typeof path[index + 1] === 'number' ? [] : {}; }
          target = target[key];
        });
        target[path.at(-1)!] = value;
      });
    },
    updateContext(update: (current: ExecutionContext) => void) {
      const next = clone(context); update(next);
      if (JSON.stringify(next) === JSON.stringify(context)) { return; }
      context = next; changed();
    },
    updateTask(id: string, update: (current: InputTask) => void): boolean {
      const task = context.inputs.find(task => task.id === id);
      if (!task) { return false; }
      const next = clone(task); update(next);
      if (JSON.stringify(next) !== JSON.stringify(task)) {
        for (const key of Object.keys(task)) { delete (task as unknown as Record<string, unknown>)[key]; }
        Object.assign(task, next); changed();
      }
      return true;
    },
    setTheme(value: string) { theme = value; },
    // 授权不是方案编辑；不能使刚授予的权限或待导入结果立即失效。
    setOverwrite(value: boolean) { allowOverwrite = value; },
    localize() { doc = read(doc.raw); },
    reset() { doc = read(); baseline = read(doc.raw); context = defaultContext(); drafts = { pathMappings: '' }; mappingErrors = []; allowOverwrite = false; changed(); },
    restore(text: string) {
      // 完整验证成功后才替换工作区，失败时保留当前编辑内容。
      const workspace = parseWorkspace(JSON.parse(text.replace(/^\uFEFF/, '')), translate());
      doc = workspace.doc; baseline = workspace.baseline; context = workspace.context; theme = workspace.theme; drafts = workspace.drafts;
      mappingErrors = parseMappingDraft(drafts.pathMappings).invalidLines; allowOverwrite = false; changed();
    },
    snapshot() { return { format: 'ffmpeg-command-forge/workspace', version: 3, preset: doc.raw, baselinePreset: baseline.raw, context, drafts, theme }; }
  };
}
