export interface WorkOptions {
  signal?: AbortSignal;
  yield?: () => Promise<void>;
  budgetMs?: number;
}
export function createCheckpoint(options: WorkOptions = {}) {
  let started = performance.now();
  return (): Promise<void> | undefined => {
    options.signal?.throwIfAborted();
    if (options.yield && performance.now() - started >= (options.budgetMs ?? 8)) {
      return options.yield().then(() => { options.signal?.throwIfAborted(); started = performance.now(); });
    }
  };
}
export async function mapScheduled<T, U>(values: T[], map: (value: T, index: number) => U, checkpoint: ReturnType<typeof createCheckpoint>): Promise<U[]> {
  const result: U[] = [];
  for (let index = 0; index < values.length; index++) {
    const pause = checkpoint(); if (pause) { await pause; }
    result.push(map(values[index], index));
  }
  return result;
}
export function finish<T>(work: Generator<void, T>): T {
  let step = work.next();
  while (!step.done) { step = work.next(); }
  return step.value;
}
export async function finishAsync<T>(work: Generator<void, T>, options: WorkOptions): Promise<T> {
  const checkpoint = createCheckpoint(options);
  try {
    const first = checkpoint(); if (first) { await first; }
    let step = work.next();
    while (!step.done) {
      const pause = checkpoint(); if (pause) { await pause; }
      step = work.next();
    }
    options.signal?.throwIfAborted(); return step.value;
  } finally { work.return(undefined as T); }
}
