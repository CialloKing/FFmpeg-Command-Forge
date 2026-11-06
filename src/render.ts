import type { CommandPlan, CommandStage, Issue, RenderedPlan, Shell } from './types';
import { windowsQuote } from './arguments';
import { sourceText, type Translate } from './i18n';
import { posixPreflight, posixQuote, psPath, psQuote, windowsPreflight } from './preflight';

export { posixQuote, psQuote };
export function cmdQuote(s: string, batch = false): string {
  let result = windowsQuote(s).replace(/["&|<>()^]/g, '^$&');
  return result.replaceAll('%', batch ? '%%' : '^%');
}
export function renderCommand(stage: CommandStage, shell: Shell, batch = false, t: Translate = sourceText): string {
  const { executable, args } = stage;
  if (shell === 'bash' || shell === 'zsh') { return [executable, ...args].map(posixQuote).join(' '); }
  if (shell === 'cmd') { return windowsQuote(executable).replaceAll('%', batch ? '%%' : '^%') + (args.length ? ' ' + args.map(a => cmdQuote(a, batch)).join(' ') : ''); }
  if (shell === 'powershell5') { return processStatement(executable, psQuote(args.map(windowsQuote).join(' ')), t); }
  return `& { $PSNativeCommandArgumentPassing = 'Standard'; & ${[executable, ...args].map(psQuote).join(' ')}; if ($LASTEXITCODE -ne 0) { throw (${psQuote(t('进程失败：'))} + $LASTEXITCODE) } }`;
}
function processStatement(executable: string, argumentExpression: string, t: Translate): string {
  const exe = /[\\/]/.test(executable) ? psPath(psQuote(executable)) : psQuote(executable);
  return `$forgeStart = New-Object System.Diagnostics.ProcessStartInfo; $forgeStart.FileName = ${exe}; $forgeStart.Arguments = ${argumentExpression}; $forgeStart.WorkingDirectory = (Get-Location -PSProvider FileSystem).ProviderPath; $forgeStart.UseShellExecute = $false; $forgeStart.CreateNoWindow = $true; $forgeStart.RedirectStandardOutput = $true; $forgeStart.RedirectStandardError = $true; $forgeProcess = [System.Diagnostics.Process]::Start($forgeStart); $forgeStdout = $forgeProcess.StandardOutput.BaseStream.CopyToAsync([Console]::OpenStandardOutput()); $forgeStderr = $forgeProcess.StandardError.BaseStream.CopyToAsync([Console]::OpenStandardError()); $forgeProcess.WaitForExit(); [void]$forgeStdout.GetAwaiter().GetResult(); [void]$forgeStderr.GetAwaiter().GetResult(); $forgeCode = $forgeProcess.ExitCode; $forgeProcess.Dispose(); if ($forgeCode -ne 0) { throw (${psQuote(t('进程失败：'))} + $forgeCode) }`;
}
function windowsStatements(plan: CommandPlan, legacy: boolean, t: Translate): string[] {
  const lines = ["$ErrorActionPreference = 'Stop'"];
  if (plan.context.cwd) { lines.push(`Set-Location -LiteralPath ${psQuote(plan.context.cwd)}`); }
  lines.push(...windowsPreflight(plan, t));
  for (const [index, task] of plan.tasks.entries()) {
    const usesOutput = task.managedOutput;
    lines.push(`Write-Host ${psQuote(t('任务：') + task.input)}`);
    if (usesOutput) {
      lines.push(`$forgeOutput = $forgeOutputs[${index}]`);
      lines.push('[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($forgeOutput)) | Out-Null');
      lines.push(`Write-Host (${psQuote(t('输出：'))} + $forgeOutput)`);
    }
    for (const asset of task.assets) {
      const base64 = b64(new TextEncoder().encode(asset.content));
      lines.push(`[System.IO.File]::WriteAllBytes(${psPath(psQuote(asset.path))}, [System.Convert]::FromBase64String(${psQuote(base64)}))`);
    }
    for (const stage of task.stages) {
      const args = stage.args.map((arg, i) => {
        if (!usesOutput) { return psQuote(arg); }
        if (i === stage.overwriteArg) { return `$forgeFlags[${index}]`; }
        const parts = stage.outputArgs?.[i];
        return parts ? '(' + parts.map(psQuote).join(' + $forgeOutput + ') + ')' : psQuote(arg);
      });
      if (legacy) {
        // Rebuild Windows quoting after resolving output collisions. No string is interpreted as shell code.
        const argv = args.join(', ');
        lines.push(`$forgeArgs = @(${argv})`);
        lines.push(String.raw`$forgeQuoted = @($forgeArgs | ForEach-Object { '"' + ([regex]::Replace([regex]::Replace($_, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1')) + '"' })`);
        lines.push(processStatement(stage.executable, "($forgeQuoted -join ' ' )", t));
      } else {
        lines.push(`$PSNativeCommandArgumentPassing = 'Standard'; & ${psQuote(stage.executable)} ${args.join(' ')}; if ($LASTEXITCODE -ne 0) { throw (${psQuote(t('进程失败：'))} + $LASTEXITCODE) }`);
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
function posixScript(plan: CommandPlan, t: Translate): string {
  const lines = [`#!/usr/bin/env ${plan.context.shell === 'zsh' ? 'zsh' : 'bash'}`, t('# FFmpeg Command Forge · 任何阶段失败都会停止，保留已有输出。'), '('];
  const fail = ' || { forge_exit_code=$?; exit "$forge_exit_code"; }';
  if (plan.context.cwd) { lines.push(`cd -- ${posixQuote(plan.context.cwd)}${fail}`); }
  lines.push(...posixPreflight(plan, t));
  for (const [index, task] of plan.tasks.entries()) {
    const usesOutput = task.managedOutput;
    lines.push(`printf '%s\n' ${posixQuote(t('任务：') + task.input)}`);
    if (usesOutput) {
      lines.push(`forge_output=$forge_path_${index}`);
      if (task.directory) { lines.push(`mkdir -p -- ${posixQuote(task.directory)}${fail}`); }
      lines.push(`printf '%s%s\\n' ${posixQuote(t('输出：'))} "$forge_output"`);
    }
    for (const asset of task.assets) { lines.push(`printf '%s' ${posixQuote(asset.content)} > ${posixQuote(asset.path)}${fail}`); }
    for (const stage of task.stages) {
      const argv = stage.args.map((arg, i) => {
        if (!usesOutput) { return posixQuote(arg); }
        if (i === stage.overwriteArg) { return `"$forge_flag_${index}"`; }
        const parts = stage.outputArgs?.[i];
        return parts ? parts.map(posixQuote).join('"$forge_output"') : posixQuote(arg);
      }).join(' ');
      lines.push(`${posixQuote(stage.executable)} ${argv}${fail}`);
    }
    if (usesOutput && (task.preserve.modification || task.preserve.access)) { lines.push(`touch ${task.preserve.modification && task.preserve.access ? '' : task.preserve.modification ? '-m ' : '-a '}-r ${posixQuote(task.input)} "$forge_output"${fail}`); }
  }
  lines.push(')', ''); return lines.join('\n');
}
export function renderPlan(plan: CommandPlan, t: Translate = sourceText): RenderedPlan {
  const { shell } = plan.context, issues: Issue[] = [], allStages = plan.tasks.flatMap(t => t.stages);
  const commands = allStages.map(s => renderCommand(s, shell, false, t)).join('\n');
  const prefix = shell === 'cmd' ? 'REM ' : '# ';
  const stages = allStages.map(s => `${prefix}${s.name}\n${renderCommand(s, shell, false, t)}`).join('\n\n');
  let script: string, filename: string;
  const assets = plan.tasks.flatMap(t => t.assets.map(a => ({ path: a.path, content: a.content })));
  if (shell === 'bash' || shell === 'zsh') { script = posixScript(plan, t); filename = 'forge-task.' + (shell === 'zsh' ? 'zsh' : 'sh'); }
  else if (shell === 'cmd') {
    // CMD delegates the complete helper transaction to the system PowerShell; plain FFmpeg commands remain native CMD.
    const source = '& { ' + windowsStatements(plan, true, t).join('; ') + ' }';
    const stage: CommandStage = { name: '', taskId: '', kind: 'single', graph: '', maps: [], executable: 'powershell.exe', args: ['-NoProfile', '-Command', source] };
    const interactive = renderCommand(stage, 'cmd');
    script = interactive;
    filename = 'forge-task.cmd';
    assets.push({ path: 'forge-task-readable.ps1', content: '& {\n' + windowsStatements(plan, true, t).join('\n') + '\n}\n' });
    if (interactive.length > 8191 || allStages.some(s => [s.executable, ...s.args].some(a => /[\r\n]/.test(a)))) { issues.push({ level: 'error', message: t('CMD 输出超过长度限制或含换行参数，请切换 PowerShell；任务包仍提供可检查的 PowerShell 脚本。') }); }
    if (allStages.some(s => /%/.test(s.executable))) { issues.push({ level: 'error', message: t('CMD 不支持含百分号的自定义程序路径，请切换 PowerShell。') }); }
  } else { script = '& {\n' + windowsStatements(plan, shell === 'powershell5', t).join('\n') + '\n}\n'; filename = 'forge-task.ps1'; }
  return { commands, stages, script, filename, issues, assets };
}
export function downloadableScript(plan: CommandPlan, rendered: RenderedPlan, t: Translate = sourceText): string {
  if (plan.context.shell !== 'cmd') { return rendered.script; }
  const source = '& { ' + windowsStatements(plan, true, t).join('; ') + ' }';
  const command = renderCommand({ name: '', taskId: '', kind: 'single', graph: '', maps: [], executable: 'powershell.exe', args: ['-NoProfile', '-Command', source] }, 'cmd', true);
  return '@echo off\r\nsetlocal DisableDelayedExpansion\r\nfor /f "tokens=2 delims=:" %%C in (\'chcp\') do set "forge_old_cp=%%C"\r\nchcp 65001 >nul\r\n' + command + '\r\nset "forge_exit=%errorlevel%"\r\nchcp %forge_old_cp% >nul\r\nexit /b %forge_exit%\r\n';
}

