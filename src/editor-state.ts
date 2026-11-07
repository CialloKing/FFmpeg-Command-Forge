import { clone, importPreset } from './preset';
import { defaultContext } from './plan';
import { parseWorkspace } from './workspace';
import type { Translate } from './i18n';
import type { ExecutionContext, FieldPath, InputTask, Preset } from './types';

// 状态只负责数据更新；调度、存储和 DOM 由入口连接，避免模块反向依赖视图。
export function createEditorState(translate: () => Translate) {
  const read = (input?: string | Preset) => importPreset(input, translate());
  let doc = read(), context = defaultContext(), theme = 'dark', allowOverwrite = false;
  function updatePreset(update: (raw: Preset) => void): void {
    const raw = clone(doc.raw); update(raw); doc = read(raw);
  }
  return {
    get doc() { return doc; },
    get context() { return context; },
    get theme() { return theme; },
    get allowOverwrite() { return allowOverwrite; },
    updatePreset,
    replacePreset(input?: string | Preset) { doc = read(input); allowOverwrite = false; },
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
    updateContext(update: (current: ExecutionContext) => void) { update(context); },
    updateTask(id: string, update: (current: InputTask) => void): boolean {
      const task = context.inputs.find(task => task.id === id);
      if (!task) { return false; }
      update(task); return true;
    },
    setTheme(value: string) { theme = value; },
    setOverwrite(value: boolean) { allowOverwrite = value; },
    localize() { doc = read(doc.raw); },
    reset() { doc = read(); context = defaultContext(); allowOverwrite = false; },
    restore(text: string) {
      // 完整验证成功后才替换工作区，失败时保留当前编辑内容。
      const workspace = parseWorkspace(JSON.parse(text.replace(/^\uFEFF/, '')), translate());
      doc = workspace.doc; context = workspace.context; theme = workspace.theme; allowOverwrite = false;
    },
    snapshot() { return { format: 'ffmpeg-command-forge/workspace', version: 1, preset: doc.raw, context, theme }; }
  };
}
