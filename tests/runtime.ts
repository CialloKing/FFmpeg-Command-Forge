import { execFileSync } from 'node:child_process';
import path from 'node:path';
export const pwsh = process.env.FORGE_PWSH || 'pwsh.exe';
export function gitBash(): string {
  if (process.env.FORGE_BASH) { return process.env.FORGE_BASH; }
  const git = execFileSync('where.exe', ['git.exe'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
  return path.resolve(path.dirname(git), '..', 'bin/bash.exe');
}
