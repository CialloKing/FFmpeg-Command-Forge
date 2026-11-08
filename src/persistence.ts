export type SaveResult = 'saved' | 'quota' | 'blocked' | 'failed' | 'conflict' | 'session';
export interface SaveState { dirty: boolean; result?: SaveResult }

interface Backend {
  storage?: Storage;
  session?: Storage;
  lock?: (work: () => void) => Promise<void>;
}
const unpack = (raw: string | null) => {
  if (raw === null) { return { token: null, workspace: undefined }; }
  let value;
  try { value = JSON.parse(raw); } catch { return { token: raw, workspace: undefined }; }
  return value?.format === 'ffmpeg-command-forge/cache' && value.version === 1 && typeof value.revision === 'string'
    ? { token: value.revision as string | null, workspace: value.workspace } : { token: raw, workspace: value };
};

// 比较与提交必须在同一把跨页面锁内；storage 事件只用于及时提示，不能代替互斥。
export function createPersistence(key: string, snapshot: () => unknown, report: (state: SaveState) => void, backend: Backend = {}) {
  const writerId = crypto.randomUUID(), draftKey = key + '.draft';
  const storage = () => backend.storage ?? localStorage;
  const session = () => backend.session ?? sessionStorage;
  const lock = backend.lock ?? (globalThis.navigator?.locks ? (work: () => void) => navigator.locks.request(key, work) : undefined);
  let state: SaveState = { dirty: false }, observed: string | null = null, conflictToken: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined, deadline: ReturnType<typeof setTimeout> | undefined;
  let pending = Promise.resolve();
  const clear = () => { clearTimeout(timer); clearTimeout(deadline); timer = deadline = undefined; };
  const notify = () => report({ ...state });
  const failure = (cause: unknown) => {
    const name = cause instanceof Error ? cause.name : '';
    state = { dirty: true, result: ['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED'].includes(name) ? 'quota' : name === 'SecurityError' ? 'blocked' : 'failed' };
  };
  const conflict = (token: string | null) => { clear(); conflictToken = token; state = { dirty: true, result: 'conflict' }; notify(); };
  function saveDraft() {
    if (!state.dirty) { return; }
    try { session().setItem(draftKey, JSON.stringify({ base: observed, workspace: snapshot() })); }
    catch (cause) { failure(cause); notify(); }
  }
  function flush(replace = false): Promise<void> {
    clear();
    const expected = replace ? conflictToken : observed;
    if (!state.dirty || state.result === 'conflict' && !replace) { return pending; }
    pending = pending.then(async () => {
      if (!state.dirty || state.result === 'conflict' && !replace) { return; }
      try {
        if (!lock) { state = { dirty: true, result: 'session' }; saveDraft(); notify(); return; }
        await lock(() => {
          const current = unpack(storage().getItem(key));
          if (current.token !== expected) { conflict(current.token); return; }
          const revision = crypto.randomUUID();
          storage().setItem(key, JSON.stringify({ format: 'ffmpeg-command-forge/cache', version: 1, revision, writerId, workspace: snapshot() }));
          observed = revision; state = { dirty: false, result: 'saved' };
          try { session().removeItem(draftKey); } catch { /* 已提交的共享副本不受草稿清理失败影响。 */ }
        });
      } catch (cause) { failure(cause); }
      notify();
    });
    return pending;
  }
  return {
    flush,
    idle: () => pending,
    saveDraft,
    load(): string | undefined {
      let current = { token: null as string | null, workspace: undefined as unknown };
      try { current = unpack(storage().getItem(key)); observed = current.token; }
      catch (cause) { failure(cause); }
      try {
        const raw = session().getItem(draftKey), draft = raw ? JSON.parse(raw) : undefined;
        if (draft?.workspace) {
          if (JSON.stringify(draft.workspace) === JSON.stringify(current.workspace)) { session().removeItem(draftKey); }
          else {
            observed = draft.base ?? null; state = { dirty: true };
            if (observed !== current.token) { conflict(current.token); }
            else if (lock) { timer = setTimeout(() => void flush(), 500); }
            else { state.result = 'session'; }
            notify(); return JSON.stringify(draft.workspace);
          }
        }
      } catch { /* 损坏或禁用的标签页草稿不妨碍共享缓存恢复。 */ }
      if (current.workspace) { state = { dirty: false, result: 'saved' }; notify(); return JSON.stringify(current.workspace); }
      return undefined;
    },
    loadLatest(apply: (text: string) => void) {
      try {
        const current = unpack(storage().getItem(key));
        if (!current.workspace) { throw new Error('No saved workspace'); }
        apply(JSON.stringify(current.workspace)); observed = current.token;
        clear(); state = { dirty: false, result: 'saved' };
        try { session().removeItem(draftKey); } catch { /* 保留下载入口。 */ }
        notify();
      } catch (cause) { failure(cause); notify(); }
    },
    overwrite: () => flush(true),
    observe(raw: string | null) {
      // 事件可能排队延迟；以当前值判断，避免旧事件把本页刚完成的保存误报为冲突。
      try { const current = unpack(storage().getItem(key)); if (current.token !== observed) { conflict(current.token); } }
      catch { conflict(raw); }
    },
    schedule() {
      state = { dirty: true, result: state.result === 'saved' ? undefined : state.result };
      notify();
      if (state.result === 'conflict') { return; }
      clearTimeout(timer); timer = setTimeout(() => void flush(), 500);
      deadline ??= setTimeout(() => void flush(), 2000);
    },
    restored() { clear(); state = { dirty: false, result: 'saved' }; notify(); }
  };
}
