import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { translator } from '../src/i18n';
import { buildPlan, defaultContext } from '../src/plan';
import { importPreset } from '../src/preset';
import { renderPlan } from '../src/render';
import { pwsh } from './runtime';

const exec = promisify(execFile);

test('并发两遍任务使用独立日志，同名成品只提交一次', async () => {
  mkdirSync('.cache', { recursive: true });
  const dir = mkdtempSync(path.resolve('.cache/concurrent-'));
  const input = path.join(dir, 'source.mkv'), output = path.join(dir, 'output.mkv');
  writeFileSync(input, 'source');
  const c = defaultContext();
  if (process.platform !== 'win32') {
    c.platform = process.platform === 'darwin' ? 'macos' : 'linux';
    c.shell = process.platform === 'darwin' ? 'zsh' : 'bash';
  }
  c.cwd = dir;
  c.inputs = [{ id: 'same-task', path: input, output }];
  const preset = importPreset({ 视频参数_编码器_具体编码: 'libx264', 视频参数_比特率_控制方式: 'TPE', 视频参数_比特率_基础: '200k' });
  // Hold the first pass until both scripts have passed preflight and written their own logs.
  const first = `
    const fs = require('node:fs'), path = require('node:path');
    const [log, dir, id, other] = process.argv.slice(1);
    fs.writeFileSync(log, id);
    fs.writeFileSync(path.join(dir, id), '');
    const deadline = Date.now() + 12000;
    const timer = setInterval(() => {
      if (fs.existsSync(path.join(dir, other))) clearInterval(timer);
      else if (Date.now() > deadline) process.exit(9);
    }, 20);
  `.trim();
  const second = `
    const fs = require('node:fs');
    const [log, output, id] = process.argv.slice(1);
    if (fs.readFileSync(log, 'utf8') !== id) process.exit(8);
    fs.writeFileSync(output, id);
  `.trim();
  const t = translator('en');
  const ids = ['first', 'second'];
  const scripts = await Promise.all(ids.map(async (id, i) => {
    const plan = await buildPlan(preset, c, t);
    assert.equal(plan.status, 'ready');
    const [pass1, pass2] = plan.tasks[0].stages;
    Object.assign(pass1, { executable: process.execPath, args: ['-e', first, 'passlog', dir, id, ids[1 - i]], passlogArg: 2, outputArgs: {} });
    Object.assign(pass2, { executable: process.execPath, args: ['-e', second, 'passlog', output, id], passlogArg: 2, mediaOutputArg: 3, outputArgs: {} });
    const file = renderPlan(plan, t).download;
    const script = path.join(dir, id + '-' + file.name);
    writeFileSync(script, file.content);
    return script;
  }));
  const results = await Promise.allSettled(scripts.map(script => c.platform === 'windows'
    ? exec(pwsh, ['-NoProfile', '-File', script], { cwd: dir, timeout: 20000 })
    : exec(c.shell, [script], { cwd: dir, timeout: 20000 })));
  const winner = results.findIndex(result => result.status === 'fulfilled');
  assert.ok(winner >= 0, JSON.stringify(results));
  const loser = results[1 - winner];
  assert.equal(loser.status, 'rejected', JSON.stringify(results));
  assert.match(loser.reason.stderr, /Encoded file kept at/);
  assert.equal(readFileSync(output, 'utf8'), ids[winner]);
  assert.equal(readFileSync(input, 'utf8'), 'source');
});
