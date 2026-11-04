export type Preset = Record<string, any>;
export type Schema = { kind: string; fields?: Record<string, Schema>; items?: Schema; values?: Record<string, number>; defaults?: any };
export type Platform = 'windows' | 'linux' | 'macos';
export type Shell = 'powershell' | 'powershell5' | 'cmd' | 'bash' | 'zsh';
export interface Issue { level: 'error' | 'missing' | 'info'; message: string; field?: string }
export interface PresetDocument { raw: Preset; normalized: Preset; issues: Issue[] }
export interface InputTask { id: string; path: string; output?: string; probe?: { path: string; resolvedPath?: string; data: any }; subtitle?: string; sidecars?: string[]; sidecarsConfirmed?: boolean }
export interface ExecutionContext {
  platform: Platform; shell: Shell; ffmpeg: string; ffprobe: string; cwd: string;
  outputDirectory: string; inputs: InputTask[]; pathMappings: { from: string; to: string }[];
  resources: Record<string, string>; confirmedPaths: string[]; clock: string; nonce: string;
}
export interface CommandStage { name: string; kind: 'probe' | 'single' | 'pass1' | 'pass2'; executable: string; args: string[]; graph: string; maps: string[]; taskId: string }
export interface PlannedTask {
  id: string; input: string; output: string; directory: string; stages: CommandStage[];
  assets: { path: string; content: string }[]; preserve: { creation: boolean; modification: boolean; access: boolean };
  naming: number; candidateStem: string; extension: string;
}
export interface CommandPlan { status: 'ready' | 'missing' | 'incompatible'; issues: Issue[]; tasks: PlannedTask[]; probes: CommandStage[]; context: ExecutionContext; preset: Preset }
export interface RenderedPlan { commands: string; stages: string; script: string; filename: string; issues: Issue[]; assets: { path: string; content: string }[] }
