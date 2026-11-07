import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPersistence, type SaveState } from '../src/persistence';

test('缓存合并连续编辑，按时补存并保留失败状态', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const writes: number[] = [];
  let version = 0, failure = false, state: SaveState = { dirty: false };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    setItem(_key: string, text: string) {
      if (failure) { throw new DOMException('full', 'QuotaExceededError'); }
      writes.push(JSON.parse(text).version);
    }
  } });
  try {
    const cache = createPersistence('test', () => ({ version }), value => { state = value; });
    for (version = 1; version <= 30; version++) { cache.schedule(); }
    version = 30;
    assert.equal(state.dirty, true);
    t.mock.timers.tick(499); assert.deepEqual(writes, []);
    t.mock.timers.tick(1); assert.deepEqual(writes, [30]);
    assert.deepEqual(state, { dirty: false, result: 'saved' });

    for (version = 31; version <= 37; version++) { cache.schedule(); t.mock.timers.tick(300); }
    assert.deepEqual(writes, [30, 37], '持续编辑在两秒上限时保存');
    version = 40; cache.schedule();
    version = 41; cache.schedule(); cache.flush();
    t.mock.timers.tick(2000); assert.deepEqual(writes, [30, 37, 41], '立即保存取消旧定时器');

    failure = true; cache.schedule(); cache.flush();
    assert.deepEqual(state, { dirty: true, result: 'quota' });
    version = 42; cache.schedule(); assert.equal(state.result, 'quota');
    failure = false; t.mock.timers.tick(500);
    assert.deepEqual(state, { dirty: false, result: 'saved' });
    assert.equal(writes.at(-1), 42);
    cache.schedule(); cache.restored(); t.mock.timers.tick(2000);
    assert.equal(writes.length, 4, '恢复有效缓存后不写入旧修改');
  } finally {
    if (original) { Object.defineProperty(globalThis, 'localStorage', original); }
    else { Reflect.deleteProperty(globalThis, 'localStorage'); }
  }
});
