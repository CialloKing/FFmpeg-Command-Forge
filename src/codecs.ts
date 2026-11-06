import { data } from './preset';
import type { Preset } from './types';
import { add, raw, withSelector } from './arguments';
import { colorMetadata, colorRange, colorValue } from './filters';

export function videoCodec(a: Preset): any {
  const key = a.视频参数_编码器_具体编码;
  return Object.entries(data.video).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1] || (key ? { 命令行编码器名: key, 是否复制流: key === 'copy', 是否禁用: key === '-vn' } : undefined);
}
export function audioCodec(a: Preset): any { return data.audio.find(x => x.私有ID.toLowerCase() === a.音频参数_编码器_代号.toLowerCase()); }
export const fpsMode = (v: string) => ['cfr', '固定帧率 cfr'].includes(v.trim().toLowerCase()) ? 'cfr' : ['vfr', '动态帧率 vfr'].includes(v.trim().toLowerCase()) ? 'vfr' : '';
export function videoExtra(a: Preset): boolean {
  return ['编码器_编码预设', '编码器_配置文件', '编码器_场景优化', '编码器_图片编码器质量值', '帧速率', '色彩管理_像素格式', '编码器_gpu', '编码器_threads', '比特率_基础', '比特率_最低值', '比特率_最高值', '比特率_缓冲区', '质量控制_参数名', '质量控制_值', '质量控制_进阶参数集'].some(k => a['视频参数_' + k]?.trim()) || !!fpsMode(a.视频参数_帧速率模式) || colorMetadata(a) || a.视频参数_比特率_控制方式 !== 0;
}
export const audioExtra = (a: Preset) => ['比特率', '质量参数名', '质量值', '质量参数名2', '质量值2', '位深度', '采样率'].some(k => a['音频参数_' + k].trim());
export const twoPass = (a: Preset) => a.视频参数_比特率_控制方式 === 6 && !!a.视频参数_比特率_基础.trim() && a.视频参数_编码器_类型 !== 2 && !videoCodec(a)?.是否复制流 && !videoCodec(a)?.是否禁用;
function quality(a: Preset, parts: string[], selector: string, phase: string): void {
  const mode = a.视频参数_比特率_控制方式, encoder = a.视频参数_编码器_具体编码.toLowerCase(), extra = a.视频参数_质量控制_进阶参数集;
  const emitQuality = (defaultName = '') => add(parts, a.视频参数_质量控制_参数名.trim() || defaultName, a.视频参数_质量控制_值, selector);
  if (mode === 1) { emitQuality('crf'); }
  else if (mode === 4 && encoder.endsWith('_amf')) { if (!/(^|\s)-rc(?::\S+)?(?=\s|$)/i.test(extra)) { add(parts, '-rc', 'cqp', selector); } }
  else {
    if (encoder.endsWith('_nvenc') && [2, 4, 5].includes(mode) && !/(^|\s)-rc(?::\S+)?(?=\s|$)/i.test(extra)) { add(parts, '-rc', mode === 4 ? 'constqp' : mode === 5 ? 'cbr' : 'vbr', selector); }
    if (mode === 4) { emitQuality('qp'); }
    else if (mode !== 6 || !['pass1', 'pass2'].includes(phase) && !a.视频参数_比特率_基础.trim()) { emitQuality(); }
  }
  for (const [name, key] of [['-b:v', '基础'], ['-minrate', '最低值'], ['-maxrate', '最高值'], ['-bufsize', '缓冲区']]) { add(parts, name, a['视频参数_比特率_' + key], selector); }
  raw(parts, extra);
}
export interface GraphResult { graph: string; maps: string[]; outputFilters: string[]; video: string[]; audio: string[]; videoCount: number; audioCount: number; subtitleCount: number; requestVideo: boolean; requestAudio: boolean; videoFiltered: boolean; audioFiltered: boolean }
export function encode(a: Preset, g: GraphResult, phase: string, passlog: string, appendCustom: (args: string[], text: string) => void): string[] {
  const result: string[] = [], video = videoCodec(a), audio = audioCodec(a);
  if (video?.命令行编码器名) {
    if (video.是否禁用) { result.push('-vn'); }
    else if (!g.video.length) { add(result, '-c:v', video.命令行编码器名); }
    else if (!(video.是否复制流 && g.videoFiltered)) { for (const s of g.video) { add(result, '-c', video.命令行编码器名, s); } }
  }
  if (g.requestVideo && !video?.是否禁用) {
    for (const s of g.video.length ? g.video : ['']) {
      if (video && !video.是否复制流) {
        for (const [role, key] of [['编码预设', '编码预设'], ['配置文件', '配置文件'], ['场景优化', '场景优化'], ['图片质量', '图片编码器质量值']]) { add(result, video[role] ? video[role].参数名 : ({ 编码预设: '-preset', 配置文件: '-profile', 场景优化: '-tune', 图片质量: '-q:v' } as Record<string, string>)[role], a['视频参数_编码器_' + key], s); }
      }
      if (!video?.是否复制流) { add(result, '-r', a.视频参数_帧速率, s); add(result, '-fps_mode', fpsMode(a.视频参数_帧速率模式), s); add(result, '-pix_fmt', a.视频参数_色彩管理_像素格式, s); }
      if (colorMetadata(a)) { for (const [name, key] of [['-colorspace', '矩阵系数'], ['-color_primaries', '色域'], ['-color_trc', '传输特性'], ['-color_range', '范围']]) { add(result, name, key === '范围' ? colorRange(a['视频参数_色彩管理_' + key]) : colorValue(a['视频参数_色彩管理_' + key]), s); } }
      if (!video?.是否复制流) { add(result, '-gpu', a.视频参数_编码器_gpu, s); add(result, '-threads', a.视频参数_编码器_threads, s); quality(a, result, s, phase); }
    }
  }
  appendCustom(result, a.自定义参数_视频参数);
  if (audio && phase !== 'pass1') {
    if (audio.是否禁用) { result.push('-an'); }
    else if (!(audio.是否复制流 && g.audioFiltered)) {
      for (const s of g.audio.length ? g.audio : ['']) {
        add(result, '-c:a', audio.命令行编码器名, s);
        if (!audio.是否复制流) { for (const p of audio.默认附加参数列表) { if (p.默认值) { add(result, p.参数名, p.默认值, s); } else if (p.参数名) { result.push(withSelector(p.参数名, s)); } } }
      }
    }
  }
  if (g.requestAudio && phase !== 'pass1' && !audio?.是否禁用 && !audio?.是否复制流) {
    for (const s of g.audio.length ? g.audio : ['']) { for (const [name, value] of [['-b:a', a.音频参数_比特率], [a.音频参数_质量参数名, a.音频参数_质量值], [a.音频参数_质量参数名2, a.音频参数_质量值2], ['-sample_fmt', a.音频参数_位深度], ['-ar', a.音频参数_采样率]]) { add(result, name, value, s); } }
  }
  appendCustom(result, a.自定义参数_音频参数);
  if (['pass1', 'pass2'].includes(phase)) { add(result, '-pass', phase === 'pass1' ? '1' : '2'); add(result, '-passlogfile', passlog); }
  return result;
}
