import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildPlan, defaultContext } from '../src/plan';
import { importPreset } from '../src/preset';
import { importProbeReport, parseReport, reportScripts, reportText } from '../src/reports';
import type { Shell } from '../src/types';
import { gitBash, pwsh } from './runtime';

test('批量探测脚本真实执行并隔离失败项目，报告严格绑定任务与路径', async () => {
  mkdirSync('.cache', { recursive: true });
  const dir = mkdtempSync(path.resolve('.cache/reports-'));
  const input = "中文 author's & ! %.mkv";
  const media = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=32x32:d=0.2', '-c:v', 'libx264', path.join(dir, input)], { encoding: 'utf8' });
  assert.equal(media.status, 0, media.stderr);
  const windows = process.platform === 'win32';
  const shells: Shell[] = windows ? ['powershell', 'powershell5', 'cmd', 'bash'] : process.platform === 'darwin' ? ['bash', 'zsh'] : ['bash'];
  for (const shell of shells) {
    const c = defaultContext(); c.shell = shell;
    c.platform = shell === 'bash' || shell === 'zsh' ? process.platform === 'darwin' ? 'macos' : 'linux' : 'windows';
    const posixDir = dir.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => '/' + drive.toLowerCase());
    // MSYS 不作为原生 POSIX 路径验收；用调用目录下的相对路径验证报告封装。
    c.cwd = windows && c.platform === 'linux' ? '' : dir;
    c.inputs = [{ id: 'ok', path: input }, { id: 'fail', path: 'missing.mkv' }];
    const plan = await buildPlan(importPreset({ 输出容器: 'mkv' }), c);
    const scripts = reportScripts(plan, 'probes');
    for (const script of scripts) { writeFileSync(path.join(dir, script.name), script.content); }
    let exe: string, args: string[];
    if (shell === 'cmd') { exe = 'cmd.exe'; args = ['/d', '/v:off', '/c', path.join(dir, scripts[0].name)]; }
    else if (shell === 'powershell' || shell === 'powershell5') { exe = shell === 'powershell5' ? 'powershell.exe' : pwsh; args = ['-NoProfile', '-File', path.join(dir, scripts[0].name)]; }
    else { exe = windows ? gitBash() : shell; args = windows ? ['-lc', `${shell} '${posixDir}/${scripts[0].name}'`] : [path.join(dir, scripts[0].name)]; }
    const before = new Set(readdirSync(dir));
    const result = spawnSync(exe, args, { cwd: dir, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const folder = readdirSync(dir).find(name => name.startsWith('forge-probe.') || name.startsWith('forge-probe-') ? !before.has(name) : false)!;
    const raw = JSON.parse(readFileSync(path.join(dir, folder, 'report.json'), 'utf8'));
    const report = parseReport(raw, 'probes');
    const imported = importProbeReport(report, c);
    assert.equal(imported.updates.length, 1); assert.equal(imported.failed, 1);
    assert.ok(JSON.parse(reportText(report.results[0].stdoutBase64)).streams.length);
    c.inputs[0].path = 'changed.mkv';
    assert.equal(importProbeReport(report, c).updates.length, 0);
    assert.throws(() => parseReport({ ...raw, results: [raw.results[0], raw.results[0]] }, 'probes'));
  }
});
