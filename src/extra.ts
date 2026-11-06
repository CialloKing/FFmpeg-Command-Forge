import type { Preset } from './types';
import type { GraphResult } from './codecs';
import { audioCodec, videoCodec } from './codecs';
import { extension, filename, substitute } from './paths';
import { subtitleCodec } from './graph';
import { add } from './arguments';

const noVideo = new Set('mp3 m4a aac flac wav ogg opus wma mka srt ass ssa vtt sup jpg jpeg jxl png webp bmp gif raw yuv h264 h265 hevc av1 ivf'.split(' '));
const noAudio = new Set('jpg jpeg jxl png webp bmp gif srt ass ssa vtt sup raw yuv h264 h265 hevc av1 ivf'.split(' '));
export const containerExtension = (a: Preset, output: string) => (extension(output) || a.输出容器).replace(/^\./, '').trim().toLowerCase();
function mime(file: string, type: number): string {
  const map: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', jxl: 'image/jxl', png: 'image/png', webp: 'image/webp', bmp: 'image/bmp', gif: 'image/gif', ttf: 'application/x-truetype-font', otf: 'application/vnd.ms-opentype', ttc: 'application/x-font-ttf', woff: 'font/woff', woff2: 'font/woff2', txt: 'text/plain', md: 'text/plain', nfo: 'text/plain', json: 'application/json', xml: 'application/xml' };
  return map[extension(file).slice(1).toLowerCase()] || (type === 5 ? 'text/plain' : 'application/octet-stream');
}
export function extraOutputs(a: Preset, g: GraphResult, input: string, output: string, sidecars: string[], outputReference = output) {
  const inputs: string[] = [], outputs: string[] = [];
  const subtitleInputs = new Set<number>();
  const ext = containerExtension(a, output), matroska = ['mkv', 'mka', 'mks', 'mk3d'].includes(ext), coverAllowed = matroska || ['mp4', 'm4v', 'm4a', 'mov', '3gp', '3g2'].includes(ext);
  const metadataMode = a.流控制_元数据选项;
  if (metadataMode) { add(outputs, '-map_metadata', metadataMode === 2 ? '-1' : '0'); if (metadataMode === 3) { add(outputs, '-movflags', '+use_metadata_tags'); } }
  for (const item of a.元数据_要写入的信息) { if (item.字段.trim()) { add(outputs, '-metadata', substitute(item.字段.trim() + '=' + item.值, input, outputReference)); } }
  if (a.流控制_章节选项) { add(outputs, '-map_chapters', a.流控制_章节选项 === 1 ? '0' : '-1'); }
  let inputIndex = 1;
  if (a.章节_来源 && a.章节_文件路径.trim()) {
    if (a.章节_来源 === 1) { add(inputs, '-f', 'ffmetadata'); }
    add(inputs, '-i', a.章节_文件路径.trim());
    if (a.章节_来源 === 1) { add(outputs, '-map_metadata', String(inputIndex)); }
    add(outputs, '-map_chapters', String(inputIndex++));
  }
  let explicit = false;
  if (a.流控制_附件选项 === 1 && matroska) { outputs.push('-map', '0:t?', '-c:t', 'copy'); explicit = true; }
  const subPositions: number[] = [], coverPositions: number[] = [];
  for (const file of sidecars) {
    subtitleInputs.add(inputIndex);
    add(inputs, '-i', file); outputs.push('-map', `${inputIndex++}:0?`); explicit = true;
    const codec = subtitleCodec(a.流控制_自动混流的字幕转为MOVTEXT ? 'mov_text' : 'copy', a, output, true);
    if (codec) { if (g.subtitleCount < 0) { add(outputs, '-c:s', codec); } else { subPositions.push(outputs.length); add(outputs, '-c:s:' + (g.subtitleCount + subPositions.length - 1), codec); } }
  }
  let coverIndex = 0, attachmentIndex = 0;
  for (const item of a.附件_要写入的附件) {
    if (!item.文件路径.trim() || !item.类型) { continue; }
    const file = item.文件路径.trim();
    if (item.类型 === 2) {
      if (!coverAllowed || g.videoCount < 0) { continue; }
      add(inputs, '-i', file); outputs.push('-map', `${inputIndex++}:v:0?`); explicit = true;
      const index = g.videoCount + coverIndex++;
      coverPositions.push(outputs.length); outputs.push(`-c:v:${index}`, 'copy', `-disposition:v:${index}`, 'attached_pic');
    } else if (matroska) {
      outputs.push('-attach', file, `-metadata:s:t:${attachmentIndex}`, 'mimetype=' + mime(file, item.类型), `-metadata:s:t:${attachmentIndex}`, 'filename=' + (item.类型 === 3 ? 'cover' + extension(file) : filename(file))); attachmentIndex++;
    }
  }
  if (explicit && !g.maps.length) {
    const defaultVideo = !videoCodec(a)?.是否禁用 && !noVideo.has(ext);
    const defaults: string[] = [];
    if (defaultVideo) { defaults.push('-map', '0:v:0?'); }
    if (!audioCodec(a)?.是否禁用 && !noAudio.has(ext)) { defaults.push('-map', '0:a:0?'); }
    coverPositions.forEach((p, i) => { outputs[p] = '-c:v:' + (Number(defaultVideo) + i); outputs[p + 2] = '-disposition:v:' + (Number(defaultVideo) + i); });
    subPositions.forEach((p, i) => { outputs[p] = '-c:s:' + i; });
    outputs.unshift(...defaults);
  }
  return { inputs, outputs, subtitleInputs };
}
