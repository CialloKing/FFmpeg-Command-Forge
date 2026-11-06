import type { CommandPlan, CommandStage, Issue, RenderedPlan, ScriptFile, Shell } from './types';
import { windowsQuote } from './arguments';
import { sourceText, type Translate } from './i18n';
import { posixPreflight, posixQuote, psPath, psQuote, windowsPreflight } from './preflight';
import { extension, withoutExtension } from './paths';

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
  if (plan.tasks.some(task => task.stagedOutput || task.stages.some(stage => stage.passlogArg !== undefined))) {
    lines.push("function New-ForgeScratch($parent) { $name = '.forge-' + [guid]::NewGuid().ToString('N'); (New-Item -ItemType Directory -Path ([IO.Path]::Combine($parent,$name))).FullName }");
  }
  if (plan.tasks.some(task => task.assets.length)) {
    lines.push(`function New-ForgeAsset($base,$ext,$data) { $p = ${psPath("$base + '.forge-' + [guid]::NewGuid().ToString('N') + $ext")}; $stream = [IO.File]::Open($p,[IO.FileMode]::CreateNew); [void]$forgeAssets.Add($p); try { $stream.Write($data,0,$data.Length) } finally { $stream.Dispose() } }`);
  }
  if (plan.tasks.some(task => task.stagedOutput)) {
    const move = plan.context.platform === 'windows' ? '[ForgeFile]::Replace($staged,$target)' : '[IO.File]::Move($staged,$target,$true)';
    lines.push(`function Publish-ForgeOutput($staged,$target,$expected) { if (!$expected) { [IO.File]::Move($staged,$target); return }; $item = Get-Item -LiteralPath $target -Force; if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or (Get-ForgeId $target) -cne $expected) { throw (${psQuote(t('输出在转码期间发生变化：'))} + $target) }; ${move} }`);
  }
  for (const [index, task] of plan.tasks.entries()) {
    const usesOutput = task.managedOutput;
    const scratch = task.stagedOutput || task.stages.some(stage => stage.passlogArg !== undefined);
    const temporary = scratch || task.assets.length;
    const body = [`Write-Host ${psQuote(t('任务：') + task.input)}`];
    if (usesOutput) {
      body.push(`$forgeOutput = $forgeOutputs[${index}]`, '$forgeParent = [IO.Path]::GetDirectoryName($forgeOutput)', '[void][IO.Directory]::CreateDirectory($forgeParent)');
      body.push(`Write-Host (${psQuote(t('输出：'))} + $forgeOutput)`);
    }
    if (scratch) { body.push(`$forgeScratch = New-ForgeScratch ${task.stagedOutput ? '$forgeParent' : '([IO.Path]::GetTempPath())'}`); }
    if (task.stagedOutput) { body.push('$forgeStaged = [IO.Path]::Combine($forgeScratch,[IO.Path]::GetFileName($forgeOutput))'); }
    for (const asset of task.assets) {
      const base64 = b64(new TextEncoder().encode(asset.content));
      body.push(`New-ForgeAsset ${psQuote(withoutExtension(asset.path))} ${psQuote(extension(asset.path))} ([Convert]::FromBase64String(${psQuote(base64)}))`);
    }
    for (const stage of task.stages) {
      const args = stage.args.map((arg, i) => {
        if (i === stage.assetArg) { return '$forgeAssets[0]'; }
        if (i === stage.passlogArg) { return '([IO.Path]::Combine($forgeScratch,\'pass\'))'; }
        if (task.stagedOutput && i === stage.mediaOutputArg) { return '$forgeStaged'; }
        if (!usesOutput) { return psQuote(arg); }
        const parts = stage.outputArgs?.[i];
        return parts ? '(' + parts.map(psQuote).join(' + $forgeOutput + ') + ')' : psQuote(arg);
      });
      if (legacy) {
        // Rebuild Windows quoting after resolving output collisions. No string is interpreted as shell code.
        const argv = args.join(', ');
        body.push(`$forgeArgs = @(${argv})`);
        body.push(String.raw`$forgeQuoted = @($forgeArgs | ForEach-Object { '"' + ([regex]::Replace([regex]::Replace($_, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1')) + '"' })`);
        body.push(processStatement(stage.executable, "($forgeQuoted -join ' ' )", t));
      } else {
        body.push(`$PSNativeCommandArgumentPassing = 'Standard'; & ${psQuote(stage.executable)} ${args.join(' ')}; if ($LASTEXITCODE -ne 0) { throw (${psQuote(t('进程失败：'))} + $LASTEXITCODE) }`);
      }
    }
    if (usesOutput && Object.values(task.preserve).some(Boolean)) {
      body.push(`$forgeSource = Get-Item -LiteralPath ${psQuote(task.input)}; $forgeTarget = Get-Item -LiteralPath ${task.stagedOutput ? '$forgeStaged' : '$forgeOutput'}`);
      for (const [key, property] of [['creation', 'CreationTimeUtc'], ['modification', 'LastWriteTimeUtc'], ['access', 'LastAccessTimeUtc']] as const) { if (task.preserve[key]) { body.push(`$forgeTarget.${property} = $forgeSource.${property}`); } }
    }
    if (task.stagedOutput) {
      body.push(`try { Publish-ForgeOutput $forgeStaged $forgeOutput $forgeExpected[${index}] } catch { if ([IO.File]::Exists($forgeStaged)) { $forgeKeep = $true; [Console]::Error.WriteLine(${psQuote(t('已编码文件保留在：'))} + $forgeStaged) }; throw }`);
    }
    if (!temporary) { lines.push(...body); continue; }
    const setup = [], cleanup = [];
    if (scratch) {
      setup.push('$forgeScratch = $null', '$forgeKeep = $false');
      cleanup.push('if ($forgeScratch -and !$forgeKeep) { Remove-Item -LiteralPath $forgeScratch -Recurse -Force -ErrorAction SilentlyContinue }');
    }
    if (task.assets.length) {
      setup.push("$forgeAssets = New-Object 'System.Collections.Generic.List[string]'");
      cleanup.push('foreach ($p in $forgeAssets) { Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue }');
    }
    lines.push(...setup, `try { ${body.join('; ')} } finally { ${cleanup.join('; ')} }`);
  }
  return lines;
}
function b64(bytes: Uint8Array): string { let result = ''; for (let i = 0; i < bytes.length; i += 8192) { result += String.fromCharCode(...bytes.subarray(i, i + 8192)); } return btoa(result); }
function posixScript(plan: CommandPlan, t: Translate): string {
  const lines = [`#!/usr/bin/env ${plan.context.shell === 'zsh' ? 'zsh' : 'bash'}`, t('# FFmpeg Command Forge · 任何阶段失败都会停止，保留已有输出。'), '('];
  const fail = ' || { forge_exit_code=$?; exit "$forge_exit_code"; }';
  if (plan.context.cwd) { lines.push(`cd -- ${posixQuote(plan.context.cwd)}${fail}`); }
  lines.push(...posixPreflight(plan, t));
  if (plan.tasks.some(task => task.stagedOutput)) {
    const replace = plan.context.platform === 'macos'
      ? '  /usr/bin/perl -e \'rename($ARGV[0],$ARGV[1]) or die "$!\\n"\' -- "$1" "$2"'
      : '  mv -fT -- "$1" "$2"';
    lines.push('forge_publish() {',
      '  if [ -z "$3" ]; then link -- "$1" "$2"; return $?; fi',
      '  if [ ! -f "$2" ] || [ -L "$2" ] || [ "$(forge_id "$2")" != "$3" ]; then',
      `    printf '%s%s\\n' ${posixQuote(t('输出在转码期间发生变化：'))} "$2" >&2; return 1`,
      '  fi', replace, '}');
  }
  for (const [index, task] of plan.tasks.entries()) {
    const usesOutput = task.managedOutput;
    const scratch = task.stagedOutput || task.stages.some(stage => stage.passlogArg !== undefined);
    const temporary = scratch || task.assets.length;
    if (temporary) {
      lines.push('(', 'forge_scratch= forge_keep=0', 'forge_assets=()',
        'forge_cleanup() { local p; for p in "${forge_assets[@]}"; do rm -f -- "$p"; done; if [ -n "$forge_scratch" ] && [ "$forge_keep" -eq 0 ]; then rm -rf -- "$forge_scratch"; fi; }',
        'trap forge_cleanup EXIT', "trap 'exit 130' INT", "trap 'exit 143' TERM");
    }
    lines.push(`printf '%s\n' ${posixQuote(t('任务：') + task.input)}`);
    if (usesOutput) {
      lines.push(`forge_output=$forge_path_${index}`);
      if (task.directory) { lines.push(`mkdir -p -- ${posixQuote(task.directory)}${fail}`); }
      lines.push(`printf '%s%s\\n' ${posixQuote(t('输出：'))} "$forge_output"`);
    }
    if (scratch) {
      const parent = task.stagedOutput ? '"$(dirname -- "$forge_output")"' : '"${TMPDIR:-/tmp}"';
      lines.push(`forge_scratch=$(mktemp -d -- ${parent}/.forge.XXXXXXXX)${fail}`);
    }
    if (task.stagedOutput) { lines.push('forge_staged="$forge_scratch/${forge_output##*/}"'); }
    for (const [assetIndex, asset] of task.assets.entries()) {
      // noclobber creates the sibling atomically, preserving relative imports in the template.
      lines.push(`forge_asset=${posixQuote(withoutExtension(asset.path))}.forge.$$.$RANDOM.$RANDOM${posixQuote(extension(asset.path))}`,
        'set -C', `exec 3> "$forge_asset"${fail}`, 'forge_assets+=("$forge_asset")',
        `printf '%s' ${posixQuote(asset.content)} >&3${fail}`, 'exec 3>&-');
      if (assetIndex === 0) { lines.push('forge_main_asset=$forge_asset'); }
    }
    for (const stage of task.stages) {
      const argv = stage.args.map((arg, i) => {
        if (i === stage.assetArg) { return '"$forge_main_asset"'; }
        if (i === stage.passlogArg) { return '"$forge_scratch/pass"'; }
        if (task.stagedOutput && i === stage.mediaOutputArg) { return '"$forge_staged"'; }
        if (!usesOutput) { return posixQuote(arg); }
        const parts = stage.outputArgs?.[i];
        return parts ? parts.map(posixQuote).join('"$forge_output"') : posixQuote(arg);
      }).join(' ');
      lines.push(`${posixQuote(stage.executable)} ${argv}${fail}`);
    }
    if (usesOutput && (task.preserve.modification || task.preserve.access)) { lines.push(`touch ${task.preserve.modification && task.preserve.access ? '' : task.preserve.modification ? '-m ' : '-a '}-r ${posixQuote(task.input)} "${task.stagedOutput ? '$forge_staged' : '$forge_output'}"${fail}`); }
    if (task.stagedOutput) {
      lines.push(`forge_publish "$forge_staged" "$forge_output" "\${forge_expected_${index}:-}" || { forge_keep=1; printf '%s%s\\n' ${posixQuote(t('已编码文件保留在：'))} "$forge_staged" >&2; exit 1; }`);
    }
    if (temporary) { lines.push(`)${fail}`); }
  }
  lines.push(')', ''); return lines.join('\n');
}
export function renderPlan(plan: CommandPlan, t: Translate = sourceText): RenderedPlan {
  const { shell } = plan.context, issues: Issue[] = [], allStages = plan.tasks.flatMap(t => t.stages);
  const stageCommands = allStages.map(stage => renderCommand(stage, shell, false, t));
  const commands = stageCommands.join('\n');
  const prefix = shell === 'cmd' ? 'REM ' : '# ';
  const stages = allStages.map((stage, i) => `${prefix}${stage.name}\n${stageCommands[i]}`).join('\n\n');
  let script: string, download: ScriptFile, bundleScripts: ScriptFile[], copyable = true;
  const assets = plan.tasks.flatMap(t => t.assets.map(a => ({ path: a.path, content: a.content })));
  if (shell === 'bash' || shell === 'zsh') {
    script = posixScript(plan, t);
    download = { name: 'forge-task.' + (shell === 'zsh' ? 'zsh' : 'sh'), content: script };
    bundleScripts = [download];
  }
  else if (shell === 'cmd') {
    // CMD delegates the complete helper transaction to the system PowerShell; plain FFmpeg commands remain native CMD.
    const statements = windowsStatements(plan, true, t);
    const source = '& { ' + statements.join('; ') + ' }';
    const stage: CommandStage = { name: '', taskId: '', kind: 'single', graph: '', maps: [], executable: 'powershell.exe', args: ['-NoProfile', '-Command', source] };
    script = renderCommand(stage, 'cmd');
    const inlineBatch = renderCommand(stage, 'cmd', true);
    copyable = script.length <= 8191 && !/[\r\n]/.test(source) && !allStages.some(stage => stage.executable.includes('%'));
    const ps1 = powershellFile('& {\n' + statements.join('\n') + '\n}\n');
    if (!copyable) {
      issues.push({ level: 'info', message: t('此 CMD 脚本无法直接粘贴，请下载 PowerShell 脚本或任务包。') });
    }
    download = copyable && inlineBatch.length <= 8191 ? { name: 'forge-task.cmd', content: cmdBatch(inlineBatch) } : ps1;
    // Locate the companion script without changing the caller's working directory.
    const launcher = '"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -File "%~dp0forge-task.ps1"';
    bundleScripts = [{ name: 'forge-task.cmd', content: cmdBatch(launcher) }, ps1];
  } else {
    script = '& {\n' + windowsStatements(plan, shell === 'powershell5', t).join('\n') + '\n}\n';
    download = powershellFile(script);
    bundleScripts = [download];
  }
  return { commands, stages, script, copyable, download, bundleScripts, issues, assets };
}

const powershellFile = (script: string): ScriptFile => ({ name: 'forge-task.ps1', content: '\uFEFF' + script });
function cmdBatch(command: string): string {
  return '@echo off\r\nsetlocal DisableDelayedExpansion\r\nfor /f "tokens=2 delims=:" %%C in (\'chcp\') do set "forge_old_cp=%%C"\r\nchcp 65001 >nul\r\n' + command + '\r\nset "forge_exit=%errorlevel%"\r\nchcp %forge_old_cp% >nul\r\nexit /b %forge_exit%\r\n';
}

