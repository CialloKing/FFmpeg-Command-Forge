import type { CommandPlan, CommandStage, ExecutionContext, Issue, PlannedTask, RenderedPlan, Shell } from './types';
import { windowsQuote } from './arguments';
import { extension, splitTrailingSerial, withoutExtension } from './paths';

export const posixQuote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
export const psQuote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
export function cmdQuote(s: string, batch = false): string {
  let result = windowsQuote(s).replace(/["&|<>()^]/g, '^$&');
  return result.replaceAll('%', batch ? '%%' : '^%');
}
export function renderCommand(stage: CommandStage, shell: Shell, batch = false): string {
  const { executable, args } = stage;
  if (shell === 'bash' || shell === 'zsh') { return [executable, ...args].map(posixQuote).join(' '); }
  if (shell === 'cmd') { return windowsQuote(executable).replaceAll('%', batch ? '%%' : '^%') + (args.length ? ' ' + args.map(a => cmdQuote(a, batch)).join(' ') : ''); }
  if (shell === 'powershell5') { return processStatement(executable, psQuote(args.map(windowsQuote).join(' '))); }
  return `& { $PSNativeCommandArgumentPassing = 'Standard'; & ${[executable, ...args].map(psQuote).join(' ')}; if ($LASTEXITCODE -ne 0) { throw ('进程失败：' + $LASTEXITCODE) } }`;
}
function processStatement(executable: string, argumentExpression: string): string {
  return `$forgeStart = New-Object System.Diagnostics.ProcessStartInfo; $forgeStart.FileName = ${psQuote(executable)}; $forgeStart.Arguments = ${argumentExpression}; $forgeStart.UseShellExecute = $false; $forgeStart.CreateNoWindow = $true; $forgeStart.RedirectStandardOutput = $true; $forgeStart.RedirectStandardError = $true; $forgeProcess = [System.Diagnostics.Process]::Start($forgeStart); $forgeStdout = $forgeProcess.StandardOutput.BaseStream.CopyToAsync([Console]::OpenStandardOutput()); $forgeStderr = $forgeProcess.StandardError.BaseStream.CopyToAsync([Console]::OpenStandardError()); $forgeProcess.WaitForExit(); [void]$forgeStdout.GetAwaiter().GetResult(); [void]$forgeStderr.GetAwaiter().GetResult(); $forgeCode = $forgeProcess.ExitCode; $forgeProcess.Dispose(); if ($forgeCode -ne 0) { throw ('进程失败：' + $forgeCode) }`;
}
function psOutputExpression(value: string, output: string): string {
  const chunks = value.split(output);
  return chunks.length === 1 ? psQuote(value) : '(' + chunks.map(psQuote).join(' + $forgeOutput + ') + ')';
}
function needsOutput(task: PlannedTask): boolean { return task.stages.some(s => s.args.some(a => a.includes(task.output))); }
function windowsStatements(plan: CommandPlan, legacy: boolean): string[] {
  const lines = ["$ErrorActionPreference = 'Stop'", `$forgeReserved = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::${plan.context.platform === 'windows' ? 'OrdinalIgnoreCase' : 'Ordinal'})`];
  if (plan.context.cwd) { lines.push(`Set-Location -LiteralPath ${psQuote(plan.context.cwd)}`); }
  for (const task of plan.tasks) {
    const usesOutput = needsOutput(task);
    lines.push(`Write-Host ${psQuote('任务：' + task.input)}`);
    if (usesOutput && task.directory) { lines.push(`[System.IO.Directory]::CreateDirectory(${psQuote(task.directory)}) | Out-Null`); }
    lines.push(`$forgeOutput = ${psQuote(task.output)}`);
    if (usesOutput && [1, 2, 11, 12].includes(task.naming)) {
      const numbered = task.naming >= 11, pathStem = withoutExtension(task.output);
      const { base: numberedBase, digits } = splitTrailingSerial(pathStem);
      const base = numbered ? numberedBase : pathStem.replace(/~\d+$/, '');
      const width = Math.max(task.naming === 11 ? 2 : 3, digits.length);
      const start = numbered ? `[bigint]${psQuote(digits || '1')}` : '1';
      const suffix = numbered ? `$forgeNumber.ToString(${psQuote('0'.repeat(width))})` : "'~' + $forgeNumber.ToString()";
      // Windows PowerShell 5.1 does not support the increment operator on BigInteger.
      const increment = numbered ? '$forgeNumber = [bigint]::Add($forgeNumber, [bigint]1)' : '$forgeNumber++';
      lines.push(`$forgeNumber = ${start}; while ((Test-Path -LiteralPath $forgeOutput) -or $forgeReserved.Contains($forgeOutput)) { $forgeOutput = ${psQuote(base)} + ${suffix} + ${psQuote(extension(task.output))}; ${increment} }`);
      lines.push('[void]$forgeReserved.Add($forgeOutput)');
    }
    if (usesOutput) { lines.push('Write-Host (\'输出：\' + $forgeOutput)'); }
    for (const asset of task.assets) {
      const base64 = b64(new TextEncoder().encode(asset.content));
      lines.push(`[System.IO.File]::WriteAllBytes(${psQuote(asset.path)}, [System.Convert]::FromBase64String(${psQuote(base64)}))`);
    }
    for (const stage of task.stages) {
      if (legacy) {
        // Rebuild Windows quoting after resolving output collisions. No string is interpreted as shell code.
        const argv = stage.args.map(a => psOutputExpression(a, task.output)).join(', ');
        lines.push(`$forgeArgs = @(${argv})`);
        lines.push(String.raw`$forgeQuoted = @($forgeArgs | ForEach-Object { '"' + ([regex]::Replace([regex]::Replace($_, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1')) + '"' })`);
        lines.push(processStatement(stage.executable, "($forgeQuoted -join ' ' )"));
      } else {
        lines.push(`$PSNativeCommandArgumentPassing = 'Standard'; & ${psQuote(stage.executable)} ${stage.args.map(a => psOutputExpression(a, task.output)).join(' ')}; if ($LASTEXITCODE -ne 0) { throw ('进程失败：' + $LASTEXITCODE) }`);
      }
    }
    if (usesOutput && Object.values(task.preserve).some(Boolean)) {
      lines.push(`$forgeSource = Get-Item -LiteralPath ${psQuote(task.input)}; $forgeTarget = Get-Item -LiteralPath $forgeOutput`);
      for (const [key, property] of [['creation', 'CreationTimeUtc'], ['modification', 'LastWriteTimeUtc'], ['access', 'LastAccessTimeUtc']] as const) { if (task.preserve[key]) { lines.push(`$forgeTarget.${property} = $forgeSource.${property}`); } }
    }
  }
  return lines;
}
function b64(bytes: Uint8Array): string { let result = ''; for (let i = 0; i < bytes.length; i += 8192) { result += String.fromCharCode(...bytes.subarray(i, i + 8192)); } return btoa(result); }
function posixScript(plan: CommandPlan): string {
  const lines = [`#!/usr/bin/env ${plan.context.shell === 'zsh' ? 'zsh' : 'bash'}`, '# FFmpeg Command Forge · 任何阶段失败都会停止，保留已有输出。', '('];
  const fail = ' || { forge_exit_code=$?; exit "$forge_exit_code"; }';
  if (plan.context.cwd) { lines.push(`cd ${posixQuote(plan.context.cwd)}${fail}`); }
  // This value is scoped to the subshell; Zsh reserves names such as "status".
  lines.push('forge_reserved=()');
  if (plan.tasks.some(task => task.naming >= 11 && needsOutput(task))) {
    // Carry across decimal digits without depending on the shell's integer width.
    lines.push('forge_increment_serial() {',
      '  local prefix=$1 suffix= digit',
      '  while [ "${prefix%9}" != "$prefix" ]; do',
      '    prefix=${prefix%9}',
      '    suffix=0$suffix',
      '  done',
      '  digit=${prefix#"${prefix%?}"}',
      '  printf \'%s%s%s\' "${prefix%?}" "$(( ${digit:-0} + 1 ))" "$suffix"',
      '}');
  }
  for (const task of plan.tasks) {
    const usesOutput = needsOutput(task);
    lines.push(`printf '%s\n' ${posixQuote('任务：' + task.input)}`);
    if (usesOutput && task.directory) { lines.push(`mkdir -p ${posixQuote(task.directory)}${fail}`); }
    lines.push(`forge_output=${posixQuote(task.output)}`);
    if (usesOutput && [1, 2, 11, 12].includes(task.naming)) {
      const numbered = task.naming >= 11, pathStem = withoutExtension(task.output);
      const { base: numberedBase, digits } = splitTrailingSerial(pathStem);
      const base = numbered ? numberedBase : pathStem.replace(/~\d+$/, '') + '~';
      const width = Math.max(task.naming === 11 ? 2 : 3, digits.length);
      const start = numbered ? (digits || '1').padStart(width, '0') : '1';
      lines.push(`forge_number=${start}`, 'while :; do', '  forge_taken=0', '  for forge_previous in "${forge_reserved[@]}"; do [ "$forge_previous" = "$forge_output" ] && forge_taken=1; done', '  if [ ! -e "$forge_output" ] && [ "$forge_taken" -eq 0 ]; then break; fi');
      lines.push(`  forge_output=${posixQuote(base)}"$forge_number"${posixQuote(extension(task.output))}`);
      lines.push(numbered ? '  forge_number=$(forge_increment_serial "$forge_number")' : '  forge_number=$((forge_number + 1))', 'done', 'forge_reserved+=("$forge_output")');
    }
    if (usesOutput) { lines.push('printf \'输出：%s\n\' "$forge_output"'); }
    for (const asset of task.assets) { lines.push(`printf '%s' ${posixQuote(asset.content)} > ${posixQuote(asset.path)}${fail}`); }
    for (const stage of task.stages) {
      const argv = stage.args.map(a => a.split(task.output).map(posixQuote).join('"$forge_output"')).join(' ');
      lines.push(`${posixQuote(stage.executable)} ${argv}${fail}`);
    }
    if (usesOutput && (task.preserve.modification || task.preserve.access)) { lines.push(`touch ${task.preserve.modification && task.preserve.access ? '' : task.preserve.modification ? '-m ' : '-a '}-r ${posixQuote(task.input)} "$forge_output"${fail}`); }
  }
  lines.push(')', ''); return lines.join('\n');
}
export function renderPlan(plan: CommandPlan): RenderedPlan {
  const { shell } = plan.context, issues: Issue[] = [], allStages = plan.tasks.flatMap(t => t.stages);
  const commands = allStages.map(s => renderCommand(s, shell)).join('\n');
  const prefix = shell === 'cmd' ? 'REM ' : '# ';
  const stages = allStages.map(s => `${prefix}${s.name}\n${renderCommand(s, shell)}`).join('\n\n');
  let script: string, filename: string;
  const assets = plan.tasks.flatMap(t => t.assets.map(a => ({ path: a.path, content: a.content })));
  if (shell === 'bash' || shell === 'zsh') { script = posixScript(plan); filename = 'forge-task.' + (shell === 'zsh' ? 'zsh' : 'sh'); }
  else if (shell === 'cmd') {
    // CMD delegates the complete helper transaction to the system PowerShell; plain FFmpeg commands remain native CMD.
    const source = '& { ' + windowsStatements(plan, true).join('; ') + ' }';
    const stage: CommandStage = { name: '', taskId: '', kind: 'single', graph: '', maps: [], executable: 'powershell.exe', args: ['-NoProfile', '-Command', source] };
    const interactive = renderCommand(stage, 'cmd');
    script = interactive;
    filename = 'forge-task.cmd';
    assets.push({ path: 'forge-task-readable.ps1', content: '& {\n' + windowsStatements(plan, true).join('\n') + '\n}\n' });
    if (interactive.length > 8191 || allStages.some(s => [s.executable, ...s.args].some(a => /[\r\n]/.test(a)))) { issues.push({ level: 'error', message: 'CMD 输出超过长度限制或含换行参数，请切换 PowerShell；任务包仍提供可检查的 PowerShell 脚本。' }); }
    if (allStages.some(s => /%/.test(s.executable))) { issues.push({ level: 'error', message: 'CMD 不支持含百分号的自定义程序路径，请切换 PowerShell。' }); }
  } else { script = '& {\n' + windowsStatements(plan, shell === 'powershell5').join('\n') + '\n}\n'; filename = 'forge-task.ps1'; }
  return { commands, stages, script, filename, issues, assets };
}
export function downloadableScript(plan: CommandPlan, rendered: RenderedPlan): string {
  if (plan.context.shell !== 'cmd') { return rendered.script; }
  const source = '& { ' + windowsStatements(plan, true).join('; ') + ' }';
  const command = renderCommand({ name: '', taskId: '', kind: 'single', graph: '', maps: [], executable: 'powershell.exe', args: ['-NoProfile', '-Command', source] }, 'cmd', true);
  return '@echo off\r\nsetlocal DisableDelayedExpansion\r\nfor /f "tokens=2 delims=:" %%C in (\'chcp\') do set "forge_old_cp=%%C"\r\nchcp 65001 >nul\r\n' + command + '\r\nset "forge_exit=%errorlevel%"\r\nchcp %forge_old_cp% >nul\r\nexit /b %forge_exit%\r\n';
}

