import { clone, importPreset } from './preset';
import { defaultContext } from './plan';
import { parseMappingDraft, parseWorkspace } from './workspace';
import type { Translate } from './i18n';
import type { ExecutionContext, FieldPath, InputTask, Preset } from './types';

// 状态只负责数据更新；调度、存储和 DOM 由入口连接，避免模块反向依赖视图。
export function createEditorState(translate: () => Translate) {
  const read = (input?: string | Preset) => importPreset(input, translate());
  let doc = read(), context = defaultContext(), theme = 'dark', allowOverwrite = false;
  let drafts = { pathMappings: '' }, mappingErrors: number[] = [];
  let revision = 0, importSequence = 0;
  const changed = () => { revision++; };
  function updatePreset(update: (raw: Preset) => void): void {
    const raw = clone(doc.raw); update(raw); doc = read(raw); changed();
  }
  return {
    get doc() { return doc; },
    get context() { return context; },
    get theme() { return theme; },
    get allowOverwrite() { return allowOverwrite; },
    get drafts() { return drafts; },
    get mappingErrors() { return mappingErrors; },
    beginImport() { return { revision, sequence: ++importSequence }; },
    acceptsImport(token: { revision: number; sequence: number }) { return token.revision === revision && token.sequence === importSequence; },
    editMappings(text: string) {
      drafts.pathMappings = text;
      const parsed = parseMappingDraft(text); mappingErrors = parsed.invalidLines;
      // 不完整的输入仍可保存，但不能部分应用路径变换。
      if (!mappingErrors.length) { context.pathMappings = parsed.mappings; }
      changed();
    },
    updatePreset,
    replacePreset(input?: string | Preset) { doc = read(input); allowOverwrite = false; changed(); },
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
    updateContext(update: (current: ExecutionContext) => void) { update(context); changed(); },
    updateTask(id: string, update: (current: InputTask) => void): boolean {
      const task = context.inputs.find(task => task.id === id);
      if (!task) { return false; }
      update(task); changed(); return true;
    },
    setTheme(value: string) { theme = value; },
    setOverwrite(value: boolean) { allowOverwrite = value; changed(); },
    localize() { doc = read(doc.raw); },
    reset() { doc = read(); context = defaultContext(); drafts = { pathMappings: '' }; mappingErrors = []; allowOverwrite = false; changed(); },
    restore(text: string) {
      // 完整验证成功后才替换工作区，失败时保留当前编辑内容。
      const workspace = parseWorkspace(JSON.parse(text.replace(/^\uFEFF/, '')), translate());
      doc = workspace.doc; context = workspace.context; theme = workspace.theme; drafts = workspace.drafts;
      mappingErrors = parseMappingDraft(drafts.pathMappings).invalidLines; allowOverwrite = false; changed();
    },
    snapshot() { return { format: 'ffmpeg-command-forge/workspace', version: 2, preset: doc.raw, context, drafts, theme }; }
  };
}
