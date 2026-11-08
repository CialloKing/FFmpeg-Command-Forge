import { windowsQuote } from './arguments';
import { psQuote, posixQuote, cmdBatch } from './render';
import { pathKey } from './paths';
import { resolvedInput } from './plan';
import { isProbeData } from './workspace';
import type { CommandPlan, ExecutionContext, InputTask, Issue, Platform, ScriptFile } from './types';
import { sourceText, type Translate } from './i18n';

export type ReportKind = 'probes' | 'environment';
export interface ReportEntry {
  key: string; taskId?: string; path?: string; resolvedPath?: string;
  exitCode: number; stdoutBase64: string; stderrBase64: string;
}
export interface ToolReport {
  format: string; version: 1; platform: Platform; executable: string; capturedAt: string; results: ReportEntry[];
}
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
export function reportText(base64: string): string {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) { throw new Error('Invalid Base64'); }
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(base64), c => c.charCodeAt(0))).replace(/^\uFEFF/, '');
}
export function parseReport(value: unknown, kind: ReportKind, t: Translate = sourceText): ToolReport {
  const invalid = (): never => { throw new Error(t('报告格式无效或版本不支持')); };
  if (!object(value) || value.format !== 'ffmpeg-command-forge/' + kind || value.version !== 1 ||
      !['windows', 'linux', 'macos'].includes(value.platform) || typeof value.executable !== 'string' ||
      typeof value.capturedAt !== 'string' || !Number.isFinite(Date.parse(value.capturedAt)) || !Array.isArray(value.results)) { invalid(); }
  const report = value as ToolReport, seen = new Set<string>();
  for (const entry of report.results) {
    if (!object(entry) || typeof entry.key !== 'string' || seen.has(entry.key) || !Number.isInteger(entry.exitCode) ||
        typeof entry.stdoutBase64 !== 'string' || typeof entry.stderrBase64 !== 'string') { invalid(); }
    if (kind === 'probes' && (typeof entry.taskId !== 'string' || entry.key !== entry.taskId || typeof entry.path !== 'string' || typeof entry.resolvedPath !== 'string')) { invalid(); }
    try { reportText(entry.stdoutBase64); reportText(entry.stderrBase64); } catch { invalid(); }
    seen.add(entry.key);
  }
  if (kind === 'environment' && (seen.size !== 4 || !['version', 'encoders', 'filters', 'hwaccels'].every(key => seen.has(key)))) { invalid(); }
  return report;
}
export function importProbeReport(report: ToolReport, context: ExecutionContext) {
  const updates: { id: string; probe: NonNullable<InputTask['probe']> }[] = [];
  let failed = 0, skipped = 0;
  const tasks = new Map(context.inputs.map(task => [task.id, task]));
  for (const entry of report.results) {
    const task = tasks.get(entry.taskId!);
    if (report.platform !== context.platform || !task || task.path !== entry.path || resolvedInput(task, context) !== entry.resolvedPath) { skipped++; continue; }
    if (entry.exitCode !== 0) { failed++; continue; }
    try {
      const data: unknown = JSON.parse(reportText(entry.stdoutBase64));
      if (!isProbeData(data)) { throw new Error('Invalid ffprobe JSON'); }
      updates.push({ id: task.id, probe: { path: task.path, resolvedPath: entry.resolvedPath, data } });
    } catch { failed++; }
  }
  return { updates, failed, skipped };
}

export function environmentIssues(plan: CommandPlan, report: ToolReport | undefined, t: Translate = sourceText): Issue[] {
  const info = (message: string): Issue => ({ level: 'info', message, target: { scope: 'context', path: ['environmentReport'] } });
  if (!report) { return []; }
  const c = plan.context;
  if (report.platform !== c.platform || pathKey(report.executable, c.platform === 'windows') !== pathKey(c.ffmpeg, c.platform === 'windows')) {
    return [info(t('环境报告与当前系统或 FFmpeg 路径不匹配，检查结果未应用'))];
  }
  const results = new Map(report.results.map(entry => [entry.key, entry]));
  const issues: Issue[] = [];
  for (const entry of report.results) { if (entry.exitCode !== 0) { issues.push(info(t('环境查询失败：{0}', entry.key))); } }
  const list = (key: string, pattern: RegExp) => new Set(reportText(results.get(key)!.stdoutBase64).split(/\r?\n/).flatMap(line => line.match(pattern)?.[1] ?? []));
  const encoders = list('encoders', /^\s*[VAS][A-Z.]{5}\s+([\w.-]+)\s/), filters = list('filters', /^\s*[TSC.]{2,3}\s+([\w.-]+)\s/);
  const requiredEncoders = new Set<string>(), requiredFilters = new Set<string>();
  const a = plan.preset;
  const custom = Object.keys(a).some(key => key.startsWith('自定义参数_') && String(a[key]).trim()) || a.滤镜排序系统.some((filter: any) => filter.是自定义滤镜);
  // 只分割滤镜图语法中的分隔符，路径和表达式里的转义逗号不代表新滤镜。
  const scanFilters = (graph: string) => {
    let token = '', quoted = false, escaped = false;
    const collect = () => { const name = token.replace(/^(?:\s*\[[^\]]*\])+\s*/, '').trim().match(/^([A-Za-z0-9_]+)(?:[=@]|$)/)?.[1]; if (name) { requiredFilters.add(name); } token = ''; };
    for (const char of graph) {
      if (escaped) { token += char; escaped = false; continue; }
      if (char === '\\') { token += char; escaped = true; continue; }
      if (char === "'") { quoted = !quoted; }
      if (!quoted && (char === ',' || char === ';')) { collect(); } else { token += char; }
    }
    collect();
  };
  for (const task of plan.tasks) { for (const stage of task.stages) {
    stage.args.forEach((arg, index) => {
      if (/^-(?:c|codec)(?::.*)?$/.test(arg) && stage.args[index + 1] !== 'copy') { requiredEncoders.add(stage.args[index + 1]); }
      if (!custom && /^-(?:vf|af|filter(?::[va](?::.*)?)?|filter_complex)$/.test(arg)) { scanFilters(stage.args[index + 1] ?? ''); }
    });
  } }
  if (results.get('encoders')!.exitCode === 0) { for (const name of requiredEncoders) { if (!encoders.has(name)) { issues.push(info(t('环境报告未列出所需编码器：{0}', name))); } } }
  if (results.get('filters')!.exitCode === 0) { for (const name of requiredFilters) { if (!filters.has(name)) { issues.push(info(t('环境报告未列出所需滤镜：{0}', name))); } } }
  if (custom) { issues.push(info(t('自定义参数或滤镜的依赖未检查，请在目标机器确认'))); }
  return issues;
}

export function reportScripts(plan: CommandPlan, kind: ReportKind, t: Translate = sourceText): ScriptFile[] {
  const c = plan.context, name = kind === 'probes' ? 'forge-probe' : 'forge-environment';
  const executable = kind === 'probes' ? c.ffprobe : c.ffmpeg;
  const requests = kind === 'probes' ? plan.probes.map(stage => ({
    metadata: { key: stage.taskId, taskId: stage.taskId, path: c.inputs.find(task => task.id === stage.taskId)!.path, resolvedPath: stage.args.at(-1)! }, args: stage.args
  })) : ['version', 'encoders', 'filters', 'hwaccels'].map(key => ({ metadata: { key }, args: ['-hide_banner', '-' + key] }));
  const header = { format: 'ffmpeg-command-forge/' + kind, version: 1, platform: c.platform, executable };
  const message = t('报告已保存：');
  if (c.shell === 'bash' || c.shell === 'zsh') {
    const lines = ['#!/usr/bin/env ' + c.shell, 'set -eu', 'set -o pipefail'];
    if (c.cwd) { lines.push('cd -- ' + posixQuote(c.cwd)); }
    lines.push(`forge_dir=$(mktemp -d './${name}.XXXXXX')`, 'forge_file="$forge_dir/report.json"',
      `printf '%s' ${posixQuote(JSON.stringify(header).slice(0, -1) + ',"capturedAt":"')} > "$forge_file.part"`,
      `date -u '+%Y-%m-%dT%H:%M:%SZ' | tr -d '\\r\\n' >> "$forge_file.part"`,
      `printf '%s' '\",\"results\":[' >> "$forge_file.part"`);
    requests.forEach(({ metadata, args }, index) => {
      lines.push(`if ${[executable, ...args].map(posixQuote).join(' ')} > "$forge_dir/stdout" 2> "$forge_dir/stderr"; then forge_code=0; else forge_code=$?; fi`,
        `forge_out=$(base64 < "$forge_dir/stdout" | tr -d '\\r\\n')`, `forge_err=$(base64 < "$forge_dir/stderr" | tr -d '\\r\\n')`,
        `printf '%s' ${posixQuote((index ? ',' : '') + JSON.stringify(metadata).slice(0, -1) + ',"exitCode":')} "$forge_code" ',"stdoutBase64":"' "$forge_out" '","stderrBase64":"' "$forge_err" '"}' >> "$forge_file.part"`);
    });
    lines.push(`printf '%s' ']}' >> "$forge_file.part"`, 'mv -- "$forge_file.part" "$forge_file"', `printf '%s\\n' ${posixQuote(message)}"$forge_file"`);
    return [{ name: name + (c.shell === 'zsh' ? '.zsh' : '.sh'), content: lines.join('\n') + '\n' }];
  }
  const lines = ["$ErrorActionPreference = 'Stop'"];
  if (c.cwd) { lines.push('Set-Location -LiteralPath ' + psQuote(c.cwd)); }
  lines.push(`$forgeDir = Join-Path (Get-Location -PSProvider FileSystem).ProviderPath (${psQuote(name + '-')} + [Guid]::NewGuid().ToString('N'))`,
    '[void](New-Item -ItemType Directory -Path $forgeDir)', '$forgeResults = New-Object System.Collections.Generic.List[object]',
    `function Invoke-ForgeReport($exe, $arguments) {
  $out = New-Object IO.MemoryStream; $err = New-Object IO.MemoryStream; $process = $null
  try {
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $exe; $start.Arguments = $arguments
    $start.WorkingDirectory = (Get-Location -PSProvider FileSystem).ProviderPath
    $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    $process = [Diagnostics.Process]::Start($start)
    $copyOut = $process.StandardOutput.BaseStream.CopyToAsync($out)
    $copyErr = $process.StandardError.BaseStream.CopyToAsync($err)
    $process.WaitForExit(); [void]$copyOut.GetAwaiter().GetResult(); [void]$copyErr.GetAwaiter().GetResult()
    return @{ exitCode = $process.ExitCode; stdoutBase64 = [Convert]::ToBase64String($out.ToArray()); stderrBase64 = [Convert]::ToBase64String($err.ToArray()) }
  } catch { return @{ exitCode = -1; stdoutBase64 = ''; stderrBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($_.Exception.Message)) } }
  finally { if ($process) { $process.Dispose() }; $out.Dispose(); $err.Dispose() }
}`);
  const exe = /[\\/]/.test(executable) ? `$ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath(${psQuote(executable)})` : psQuote(executable);
  for (const { metadata, args } of requests) {
    lines.push(`$forgeRow = Invoke-ForgeReport (${exe}) ${psQuote(args.map(windowsQuote).join(' '))}`);
    for (const [key, value] of Object.entries(metadata)) { lines.push(`$forgeRow[${psQuote(key)}] = ${psQuote(value)}`); }
    lines.push('$forgeResults.Add($forgeRow)');
  }
  lines.push(`$forgeReport = [ordered]@{ ${Object.entries(header).map(([key, value]) => `${key} = ${typeof value === 'number' ? value : psQuote(value)}`).join('; ')}; capturedAt = [DateTime]::UtcNow.ToString('o'); results = @($forgeResults.ToArray()) }`,
    `$forgeFile = Join-Path $forgeDir 'report.json'`, '[IO.File]::WriteAllText($forgeFile, ($forgeReport | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))',
    `Write-Host (${psQuote(message)} + $forgeFile)`);
  const ps1 = { name: name + '.ps1', content: '\uFEFF' + lines.join('\n') + '\n' };
  return c.shell === 'cmd' ? [{ name: name + '.cmd', content: cmdBatch(`"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -File "%~dp0${name}.ps1"`) }, ps1] : [ps1];
}
