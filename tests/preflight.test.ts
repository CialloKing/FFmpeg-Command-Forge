import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildPlan, defaultContext } from '../src/plan';
import { importPreset } from '../src/preset';
import { filename } from '../src/paths';
import { posixPreflight, posixQuote, psQuote, windowsPreflight } from '../src/preflight';
import { sourceText } from '../src/i18n';
import { gitBash, pwsh } from './runtime';

test('序号预检保持空洞、起始值、前导零和长整数语义', async () => {
  mkdirSync('.cache', { recursive: true });
  const shells = process.platform === 'win32' ? [pwsh, 'powershell.exe', gitBash()] :
    process.platform === 'darwin' ? ['bash', 'zsh'] : ['bash'];
  const occupied = ['clip02', 'clip03', 'clip09', 'clip10', 'clip99', 'clip100', 'clip999', 'clip1000', 'clip20261106192345001'];
  const inputs = ['clip00', 'clip98', 'clip01', 'clip00', 'clip08', 'clip999', 'clip20261106192345000'];
  for (const shell of shells) {
    const powershell = /powershell|pwsh/i.test(shell);
    const dir = mkdtempSync(path.resolve('.cache/serial-'));
    for (const name of occupied) { writeFileSync(path.join(dir, name + '.mkv'), 'occupied'); }
    const c = defaultContext();
    c.platform = powershell ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
    c.shell = powershell ? 'powershell' : 'bash';
    c.cwd = dir;
    if (process.platform === 'win32' && !powershell) {
      const cygpath = path.resolve(path.dirname(shell), '../usr/bin/cygpath.exe');
      c.cwd = spawnSync(cygpath, ['-u', dir], { encoding: 'utf8' }).stdout.trim();
    }
    c.inputs = inputs.map((name, index) => ({ id: String(index), path: 'inputs/' + name + '.mp4' }));
    c.outputDirectory = c.cwd;
    for (const mode of [11, 12]) {
      const plan = await buildPlan(importPreset({ 输出容器: 'mkv', 输出_自动命名选项: mode }), c);
      assert.equal(plan.status, 'ready', JSON.stringify(plan.issues));
      const used = new Set(occupied.map(name => name + '.mkv'));
      const expected = plan.tasks.map(task => {
        const candidate = filename(task.output), [, prefix, digits] = /^(.*?)(\d+)\.mkv$/.exec(candidate)!;
        let number = BigInt(digits);
        let name = candidate;
        while (used.has(name)) { number++; name = prefix + number.toString().padStart(digits.length, '0') + '.mkv'; }
        used.add(name);
        return name;
      });
      const script = powershell
        ? `Set-Location -LiteralPath ${psQuote(c.cwd)}\n` + windowsPreflight(plan, sourceText).join('\n') +
          '\n@(' + plan.tasks.map((_, i) => `[IO.Path]::GetFileName($forgeOutputs[${i}])`).join(',') + ') | ConvertTo-Json -Compress'
        : `cd -- ${posixQuote(c.cwd)}\n` + posixPreflight(plan, sourceText).join('\n') +
          '\nprintf "%s\\n" ' + plan.tasks.map((_, i) => `"$forge_path_${i}"`).join(' ');
      const file = path.join(dir, powershell ? 'preflight.ps1' : 'preflight.sh');
      writeFileSync(file, (powershell ? '\uFEFF' : '') + script);
      const command = process.platform === 'win32' && !powershell ? file.replaceAll('\\', '/') : file;
      const r = spawnSync(shell, powershell ? ['-NoProfile', '-File', file] : [command], { encoding: 'utf8', timeout: 15000 });
      assert.ifError(r.error);
      assert.equal(r.status, 0, shell + '\n' + r.stderr);
      const actual = powershell ? JSON.parse(r.stdout) : r.stdout.trim().split(/\r?\n/).map(filename);
      assert.deepEqual(actual, expected, shell + '/' + mode);
    }
  }
});
