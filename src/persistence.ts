export type SaveResult = 'saved' | 'quota' | 'blocked' | 'failed';
export interface SaveState { dirty: boolean; result?: SaveResult }

// 快照在写入时读取，避免延迟任务把旧工作区重新写回缓存。
export function createPersistence(key: string, snapshot: () => unknown, report: (state: SaveState) => void) {
  let state: SaveState = { dirty: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { clearTimeout(timer); clearTimeout(deadline); timer = deadline = undefined; };
  const notify = () => report({ ...state });
  function flush(): SaveResult | undefined {
    clear();
    if (!state.dirty) { return state.result; }
    try {
      localStorage.setItem(key, JSON.stringify(snapshot()));
      state = { dirty: false, result: 'saved' };
    } catch (cause) {
      const name = cause instanceof Error ? cause.name : '';
      state = { dirty: true, result: ['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED'].includes(name) ? 'quota' : name === 'SecurityError' ? 'blocked' : 'failed' };
    }
    notify(); return state.result;
  }
  return {
    flush,
    schedule() {
      state = { dirty: true, result: state.result === 'saved' ? undefined : state.result };
      clearTimeout(timer); timer = setTimeout(flush, 500);
      deadline ??= setTimeout(flush, 2000);
      notify();
    },
    restored() { clear(); state = { dirty: false, result: 'saved' }; notify(); }
  };
}
