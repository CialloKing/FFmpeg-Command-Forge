import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { renderCommand, renderPlan, downloadableScript } from '../src/render';
import { defaultContext } from '../src/plan';
import type { CommandPlan, CommandStage, Shell } from '../src/types';
import { pwsh, gitBash } from './runtime';

const values = ['', '中文 path', 'a"b', "a'b", 'tail\\', '\\\\server\\path\\', 'a\\\\"b', '$x', '&|<>()^', '%FCF_TEST_VAR%', '!FCF_TEST_VAR!', 'prefix "quoted" ending\\'];
const oracle = path.resolve('tools/oracle/bin/Debug/net10.0/Oracle.exe');
function execute(script: string, shell: Shell, file = false) {
  const options = { encoding: 'utf8' as const, timeout: 20000, env: { ...process.env, FCF_TEST_VAR: 'MUST_NOT_EXPAND', MSYS2_ARG_CONV_EXCL: '*', MSYS_NO_PATHCONV: '1' } };
  if (shell === 'cmd') { return spawnSync('cmd.exe', ['/d', '/v:off', '/s', '/c', '"' + script + '"'], { ...options, windowsVerbatimArguments: true }); }
  if (shell === 'bash') { return spawnSync(gitBash(), ['-c', script], options); }
  return spawnSync(shell === 'powershell' ? pwsh : 'powershell.exe', ['-NoProfile', file ? '-File' : '-Command', script], options);
}
function parsed(stdout: string, label = ''): any { const start = stdout.search(/\[\s*\r?\n/); assert.ok(start >= 0, label + ' 未接收到 JSON: ' + JSON.stringify(stdout)); return JSON.parse(stdout.slice(start)); }
test('真实终端传递复杂参数到 Windows FFmpeg 同规则的原生探针', { skip: process.platform !== 'win32' }, () => {
  const stage: CommandStage = { name: 'argv', kind: 'single', taskId: 'test', executable: oracle, args: ['--argv', ...values], graph: '', maps: [] };
  for (const shell of ['powershell', 'powershell5', 'cmd', 'bash'] as Shell[]) {
    // Git Bash's MSYS native-process bridge changes UNC prefixes independently of POSIX shell quoting.
    const expected = shell === 'bash' ? values.filter(v => !v.startsWith('\\\\')) : values;
    const r = execute(renderCommand({ ...stage, args: ['--argv', ...expected] }, shell), shell);
    assert.equal(r.status, 0, shell + '\n' + r.stderr + '\n' + r.stdout); assert.deepEqual(parsed(r.stdout, shell).slice(1), expected, shell);
  }
  mkdirSync('.cache', { recursive: true });
  const batch = path.resolve('.cache/native-argv.cmd');
  writeFileSync(batch, '@echo off\r\nsetlocal DisableDelayedExpansion\r\nchcp 65001 >nul\r\n' + renderCommand(stage, 'cmd', true) + '\r\n', 'utf8');
  const r = execute('"' + batch + '"', 'cmd');
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(parsed(r.stdout).slice(1), values, '.cmd file');
});

test('完整 Windows 辅助脚本与预览共用同一参数计划', { skip: process.platform !== 'win32' }, () => {
  mkdirSync('.cache', { recursive: true });
  for (const shell of ['powershell', 'powershell5', 'cmd'] as Shell[]) {
    const c = defaultContext(); c.shell = shell;
    const stage: CommandStage = { name: 'argv', kind: 'single', taskId: 'test', executable: oracle, args: ['--argv', ...values], graph: '', maps: [] };
    const plan: CommandPlan = { context: c, status: 'ready', preset: {}, probes: [], issues: [], tasks: [{ id: 'test', input: 'input', output: 'output', directory: '', candidateStem: 'output', extension: '', naming: 0, stages: [stage], assets: [], preserve: { creation: false, modification: false, access: false } }] };
    const render = renderPlan(plan); assert.deepEqual(render.issues, [], shell);
    const r = execute(render.script, shell); assert.equal(r.status, 0, shell + '\n' + r.stderr); assert.deepEqual(parsed(r.stdout, shell).slice(1), values, shell);
    if (shell === 'cmd') { const batch = path.resolve('.cache/helper-argv.cmd'); writeFileSync(batch, downloadableScript(plan, render)); const b = execute('"' + batch + '"', 'cmd'); assert.equal(b.status, 0, b.stderr); assert.deepEqual(parsed(b.stdout).slice(1), values, 'helper .cmd file'); }
  }
});
