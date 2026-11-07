import { extension, splitTrailingSerial, withoutExtension } from './paths';
import { incrementalNaming, localFile } from './plan';
import type { CommandPlan, PlannedTask } from './types';
import type { Translate } from './i18n';

export const psQuote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
export const posixQuote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";

// .NET file APIs use the process directory rather than PowerShell's current location.
export const psPath = (expression: string) => `$ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath(${expression})`;

function serial(task: PlannedTask) {
  const path = withoutExtension(task.output);
  if (task.naming < 11) { return { base: path.replace(/~\d+$/, '') + '~', digits: '1', ext: extension(task.output) }; }
  const { base, digits } = splitTrailingSerial(path);
  return { base, digits: (digits || '1').padStart(task.naming === 11 ? 2 : 3, '0'), ext: extension(task.output) };
}

function batchPaths(plan: CommandPlan) {
  const sources = [...new Set(plan.tasks.flatMap(task => task.reads ?? [task.input]))];
  return {
    sources: sources.filter(localFile),
    opaqueInputs: sources.some(path => !localFile(path)) || plan.tasks.some(task => task.opaqueReads),
    outputs: plan.tasks.flatMap((task, index) => task.managedOutput ? [{ task, index }] : [])
  };
}

// Read the volume and 128-bit file ID through an open handle so aliases compare equal.
const windowsFile = `
using System;
using System.IO;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class ForgeFile {
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool GetFileInformationByHandleEx(SafeFileHandle file, int type, byte[] info, int size);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool MoveFileEx(string source, string destination, int flags);
  public static string Id(string path) {
    using (var file=File.OpenRead(path)) {
      var id=new byte[24];
      if (!GetFileInformationByHandleEx(file.SafeFileHandle,18,id,id.Length)) { throw new Win32Exception(); }
      return Convert.ToBase64String(id);
    }
  }
  public static void Replace(string source, string destination) {
    if (!MoveFileEx(source,destination,1)) { throw new Win32Exception(); }
  }
}`.trim().replace(/\s*\n\s*/g, ' ');

export function windowsPreflight(plan: CommandPlan, t: Translate): string[] {
  const { sources, opaqueInputs, outputs } = batchPaths(plan);
  if (!outputs.length) { return []; }
  const windows = plan.context.platform === 'windows';
  const occupied = psQuote(t('输出已存在或与本批路径冲突：'));
  const identity = psQuote(t('无法安全确认输出文件可以覆盖：'));
  const lines = [
    '$forgeOutputs = @{}; $forgeExpected = @{}',
    `$forgePaths = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::${windows ? 'OrdinalIgnoreCase' : 'Ordinal'})`,
    `$forgeSources = @(${sources.map(psQuote).join(', ')}) | ForEach-Object { [IO.Path]::GetFullPath(${psPath('$_')}) }`,
    'foreach ($forgeSourcePath in $forgeSources) { [void]$forgePaths.Add($forgeSourcePath) }'
  ];
  const mayOverwrite = plan.allowOverwrite && outputs.some(({ task }) => task.stagedOutput && !incrementalNaming(task.naming)) && !opaqueInputs;
  if (mayOverwrite) {
    const stat = plan.context.platform === 'macos' ? '& /usr/bin/stat -L -f %d:%i $p' : '& stat -Lc %d:%i -- $p';
    lines.push(windows
      ? `function Get-ForgeId($p) { if (-not ('ForgeFile' -as [type])) { Add-Type -TypeDefinition ${psQuote(windowsFile)} }; [ForgeFile]::Id($p) }`
      : `function Get-ForgeId($p) { $value = ${stat}; if ($LASTEXITCODE -ne 0 -or -not $value) { throw (${identity} + $p) }; $value }`);
    lines.push('$forgeIds = @{}; $forgeIdsLoaded = $false');
  }
  // Fixed names must be reserved before any of the automatic names can be advanced.
  for (const { task, index } of [...outputs.filter(x => !incrementalNaming(x.task.naming)), ...outputs.filter(x => incrementalNaming(x.task.naming))]) {
    lines.push(`$p = [IO.Path]::GetFullPath(${psPath(psQuote(task.output))})`);
    if (incrementalNaming(task.naming)) {
      const { base, digits, ext } = serial(task);
      const numbered = task.naming >= 11;
      const value = numbered ? `[bigint]${psQuote(digits)}` : '1';
      const format = numbered ? `$forgeNumber.ToString(${psQuote('0'.repeat(digits.length))})` : '$forgeNumber.ToString()';
      const increment = numbered ? '$forgeNumber = [bigint]::Add($forgeNumber, [bigint]1)' : '$forgeNumber++';
      lines.push(`$forgeNumber = ${value}; while ($forgePaths.Contains($p) -or (Get-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue)) { $p = [IO.Path]::GetFullPath(${psPath(`(${psQuote(base)} + ${format} + ${psQuote(ext)})`)}); ${increment} }`);
    } else {
      lines.push(`if ($forgePaths.Contains($p)) { throw (${occupied} + $p) }`, '$item = Get-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue');
      if (!mayOverwrite || !task.stagedOutput) { lines.push(`if ($item) { throw (${occupied} + $p) }`); }
      else {
        lines.push(`if ($item) { if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw (${identity} + $p) }; if (-not $forgeIdsLoaded) { foreach ($s in $forgeSources) { $forgeIds[(Get-ForgeId $s)] = $true }; $forgeIdsLoaded = $true }; $id = Get-ForgeId $p; if ($forgeIds.ContainsKey($id)) { throw (${occupied} + $p) }; $forgeIds[$id] = $true; $forgeExpected[${index}] = $id }`);
      }
    }
    lines.push(`[void]$forgePaths.Add($p); $forgeOutputs[${index}] = $p`);
  }
  return lines;
}

export function posixPreflight(plan: CommandPlan, t: Translate): string[] {
  const { sources, opaqueInputs, outputs } = batchPaths(plan);
  if (!outputs.length) { return []; }
  const parents = new Map<string, number>();
  const parentSlot = (path: string) => {
    const parent = path.slice(0, path.lastIndexOf('/') + 1);
    if (!parents.has(parent)) { parents.set(parent, parents.size); }
    return parents.get(parent)!;
  };
  const lines = [
    'if [ -n "${ZSH_VERSION:-}" ]; then setopt KSH_ARRAYS; fi',
    'cd -P -- . || exit 1',
    'forge_cwd=$PWD',
    'forge_physical=()',
    // Cache physical parent directories, but keep lexical keys when a directory is yet to be created.
    'forge_key() {',
    '  local rest=$1 slot=$2 part full= parent physical',
    '  case "$rest" in /*) ;; *) rest="$forge_cwd/$rest" ;; esac',
    '  parent=${rest%/*}',
    '  if [ -z "${forge_physical[slot]+cached}" ]; then',
    // The batch already runs in a subshell, so cd and restore without forking once per parent.
    '    if cd -P -- "${parent:-/}" >/dev/null 2>&1; then',
    '      physical=$PWD; cd -P -- "$forge_cwd" >/dev/null || exit 1',
    '    else physical=; fi',
    '    forge_physical[slot]=$physical',
    '  fi',
    '  physical=${forge_physical[slot]}',
    '  if [ -n "$physical" ]; then rest="$physical/${rest##*/}"; fi',
    '  while [ -n "$rest" ]; do',
    '    part=${rest%%/*}',
    '    case "$rest" in */*) rest=${rest#*/} ;; *) rest= ;; esac',
    '    case "$part" in ""|.) ;; ..) full=${full%/*} ;; *) full="$full/$part" ;; esac',
    '  done',
    // Escape the separator and the escape character so matching is literal even for unusual paths.
    '  forge_entry=${full//%/%25}',
    '  forge_entry=${forge_entry//|/%7C}',
    '}',
    `forge_sources=(${sources.map(posixQuote).join(' ')})`,
    `forge_source_parents=(${sources.map(parentSlot).join(' ')})`,
    "forge_reserved='|'",
    'forge_reserve() { forge_reserved="$forge_reserved$forge_entry|"; }',
    'for (( forge_i=0; forge_i<${#forge_sources[@]}; forge_i++ )); do forge_key "${forge_sources[forge_i]}" "${forge_source_parents[forge_i]}"; forge_reserve; done',
    'forge_taken() { case "$forge_reserved" in *"|$forge_entry|"*) return 0 ;; esac; return 1; }',
    `forge_conflict() { printf '%s%s\\n' ${posixQuote(t('输出已存在或与本批路径冲突：'))} "$1" >&2; exit 1; }`
  ];
  if (outputs.some(({ task }) => task.naming >= 11)) {
    // Carry across decimal digits without depending on the shell's integer width.
    lines.push('forge_increment_serial() {',
      '  local prefix=$1 suffix= digit',
      '  while [ "${prefix%9}" != "$prefix" ]; do prefix=${prefix%9}; suffix=0$suffix; done',
      '  digit=${prefix#"${prefix%?}"}',
      '  printf "%s%s%s" "${prefix%?}" "$(( ${digit:-0} + 1 ))" "$suffix"',
      '}');
  }
  const mayOverwrite = plan.allowOverwrite && outputs.some(({ task }) => task.stagedOutput && !incrementalNaming(task.naming)) && !opaqueInputs;
  if (mayOverwrite) {
    const stat = plan.context.platform === 'macos' ? '/usr/bin/stat -L -f %d:%i' : 'stat -Lc %d:%i --';
    lines.push('forge_ids=()', 'forge_ids_loaded=0',
      `forge_id() { ${stat} "$1"; }`,
      `forge_identity_error() { printf '%s%s\\n' ${posixQuote(t('无法安全确认输出文件可以覆盖：'))} "$1" >&2; exit 1; }`);
  }
  const series = new Map<string, string>();
  for (const { task, index } of [...outputs.filter(x => !incrementalNaming(x.task.naming)), ...outputs.filter(x => incrementalNaming(x.task.naming))]) {
    const resolve = `forge_key "$forge_target" ${parentSlot(task.output)}`;
    lines.push(`forge_target=${posixQuote(task.output)}`, resolve);
    if (incrementalNaming(task.naming)) {
      const { base, digits, ext } = serial(task);
      const numbered = task.naming >= 11;
      const key = JSON.stringify([base, ext]);
      const next = series.get(key) ?? `forge_next_${series.size}`;
      if (!numbered) { series.set(key, next); }
      lines.push(`forge_number=${numbered ? digits : `\${${next}:-1}`}`, 'while [ -e "$forge_target" ] || [ -L "$forge_target" ] || forge_taken; do',
        `  forge_target=${posixQuote(base)}"$forge_number"${posixQuote(ext)}`,
        '  ' + resolve,
        numbered ? '  forge_number=$(forge_increment_serial "$forge_number")' : '  forge_number=$((forge_number + 1))', 'done');
      if (!numbered) { lines.push(`${next}=$forge_number`); }
    } else {
      lines.push('if forge_taken; then forge_conflict "$forge_target"; fi');
      if (!mayOverwrite || !task.stagedOutput) { lines.push('if [ -e "$forge_target" ] || [ -L "$forge_target" ]; then forge_conflict "$forge_target"; fi'); }
      else {
        lines.push('if [ -e "$forge_target" ] || [ -L "$forge_target" ]; then',
          '  if [ ! -f "$forge_target" ] || [ -L "$forge_target" ]; then forge_identity_error "$forge_target"; fi',
          '  if [ "$forge_ids_loaded" -eq 0 ]; then',
          '    for forge_source in "${forge_sources[@]}"; do',
          '      forge_id_value=$(forge_id "$forge_source") || forge_identity_error "$forge_source"',
          '      forge_ids+=("$forge_id_value")',
          '    done',
          '    forge_ids_loaded=1',
          '  fi',
          '  forge_id_value=$(forge_id "$forge_target") || forge_identity_error "$forge_target"',
          '  for forge_previous in "${forge_ids[@]}"; do',
          '    if [ "$forge_previous" = "$forge_id_value" ]; then forge_conflict "$forge_target"; fi',
          '  done',
          '  forge_ids+=("$forge_id_value")',
          `  forge_expected_${index}=$forge_id_value`,
          'fi');
      }
    }
    lines.push('forge_reserve', `forge_path_${index}=$forge_target`);
  }
  return lines;
}
