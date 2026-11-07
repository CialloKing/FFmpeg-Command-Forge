import type { FieldPath, Issue, IssueTarget } from './types';

export const presetTarget = (path: FieldPath): IssueTarget => ({ scope: 'preset', path });
export const contextTarget = (path: FieldPath, taskId?: string): IssueTarget => ({ scope: 'context', path, taskId });
export const targetKey = (target: IssueTarget): string => JSON.stringify(target);
export const issueKey = (issue: Issue): string => JSON.stringify([issue.level, issue.message, issue.target]);
export const fieldPathText = (path: FieldPath): string => path.map((part, index) => typeof part === 'number' ? `[${part}]` : (index ? '.' : '') + part).join('');
