import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'D:/C#project/FFmpegFreeUI');
const revision = '9cff6bf2d9f8b0162f2e6dc76e539d13a208acf3';
if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() !== revision) {
  throw new Error('上游提交与兼容基线不一致。请使用固定提交。');
}
await mkdir('tools/oracle/generated', { recursive: true });
await mkdir('src/data', { recursive: true });
await mkdir('docs', { recursive: true });
const base = 'FFmpegFreeUI/功能/预设系统/';
const sources = [
  ['FFmpegFreeUI/功能/视频编码器数据库_v6.vb'], ['FFmpegFreeUI/功能/音频编码器数据库_v6.vb'],
  [base + '预设数据_v6.vb'], [base + '开发者内置预设_v6.vb'],
  [base + '预设命令行核心_v6.vb'], [base + '预设命令行滤镜图_v6.vb'],
  [base + '预设滤镜排序_v6.vb'], [base + '预设区段_画面效果字幕_v6.vb'],
  [base + '预设区段_剪辑自定义_v6.vb'],
  [base + '预设区段_画面帧_v6.vb', 317], [base + '预设区段_质量色彩音频_v6.vb', 127],
  [base + '预设区段_高级流控制_v6.vb', 210], [base + '预设区段_输出解码编码_v6.vb', 250],
  [base + '预设存储_v6.vb', 96, 113]
];
const manifest = { repository: 'https://github.com/Lake1059/FFmpegFreeUI', revision, version: '6.2.43', sources: [] };
for (const [relative, start, end] of sources) {
  const content = await readFile(path.join(root, relative), 'utf8');
  manifest.sources.push({ path: relative, sha256: createHash('sha256').update(content).digest('hex'), start, end });
  // Extract complete original method blocks, rather than implementing a second reference engine.
  const imports = 'Imports System.IO\nImports System.Text\nImports System.Text.Json\nImports System.Globalization\nImports System.Text.RegularExpressions\n';
  let generated = content;
  if (start) {
    generated = imports + '\nPartial Public Class 预设管理_v6\n' + content.split(/\r?\n/).slice(start - 1, end).join('\n');
    if (end) generated += '\nEnd Class\n';
  }
  if (relative.endsWith('预设区段_输出解码编码_v6.vb')) {
    const extra = content.split(/\r?\n/).slice(35, 54).join('\n');
    generated = generated.replace('Partial Public Class 预设管理_v6', 'Partial Public Class 预设管理_v6\n' + extra);
  }
  await writeFile(path.join('tools/oracle/generated', path.basename(relative)), generated.replace(/^Imports LakeUI\r?\n/gm, ''), 'utf8');
}
const helpersSource = await readFile(path.join(root, base + '预设面板总览_兼容性_v6.vb'), 'utf8');
manifest.sources.push({ path: base + '预设面板总览_兼容性_v6.vb', sha256: createHash('sha256').update(helpersSource).digest('hex') });
const helpers = [...helpersSource.matchAll(/^    (?:Private|Public) Shared Function (?:已设置|字幕颜色已设置|限制颜色通道|抽帧参数已设置|超分单片有设置)\([\s\S]*?^    End Function/gm)].map(m => m[0]).join('\n');
await writeFile('tools/oracle/generated/Helpers.vb', 'Partial Public Class 预设管理_v6\n' + helpers + '\nEnd Class\n');
const moduleSource = await readFile(path.join(root, 'FFmpegFreeUI/功能/Module1.vb'), 'utf8');
manifest.sources.push({ path: 'FFmpegFreeUI/功能/Module1.vb', sha256: createHash('sha256').update(moduleSource).digest('hex') });
const pathHelper = moduleSource.match(/^    Public Function 将路径转换为FFmpeg滤镜接受的格式\([\s\S]*?^    End Function/m)[0];
await writeFile('tools/oracle/generated/Paths.vb', 'Module OriginalPaths\n' + pathHelper + '\nEnd Module\n');
await copyFile(path.join(root, 'LICENSE.txt'), 'docs/FFmpegFreeUI-LICENSE.txt');
await writeFile('docs/upstream.json', JSON.stringify(manifest, null, 2) + '\n');
execFileSync('dotnet', ['build', 'tools/oracle/Oracle.vbproj', '--nologo', '-v:q'], { stdio: 'inherit' });
const schema = execFileSync('dotnet', ['tools/oracle/bin/Debug/net10.0/Oracle.dll', '--schema'], { encoding: 'utf8', maxBuffer: 8e6 });
await writeFile('src/data/upstream.json', schema, 'utf8');
console.log('已生成固定上游数据与原版命令参考工具。');
