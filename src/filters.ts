import type { Preset } from './types';
import { dirname, extension, filterPath, join, stem, substitute } from './paths';
import { data } from './preset';

export const named = (name: string, values: [string, any][]) => { const opts = values.filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k, v]) => `${k}=${v}`).join(':'); return opts ? `${name}=${opts}` : name; };
const params = (a: Preset, prefix: string, count = 4): string[] => Array.from({ length: count }, (_, i) => a[prefix + '_参数' + (i + 1)] || '');
const fromNames = (name: string, names: string[], values: string[]) => named(name, names.map((n, i) => [n, values[i]]));
export const colorValue = (v: string) => v?.trim().toLowerCase() === 'auto' ? '' : v?.trim() || '';
export function colorRange(v: string): string { const raw = colorValue(v); return /^(tv)|有限|limited/i.test(raw) ? 'tv' : /^(pc)|全范围|full/i.test(raw) ? 'pc' : raw; }
export function colorMetadata(a: Preset): boolean { return ['写入元数据并转换', '仅写入元数据'].includes(a.视频参数_色彩管理_处理方式) && ['矩阵系数', '色域', '传输特性', '范围'].some(k => colorValue(a['视频参数_色彩管理_' + k])); }
export function colorFilter(a: Preset): string {
  const v = (k: string) => colorValue(a['视频参数_色彩管理_' + k]);
  if (a.视频参数_色彩管理_处理方式.trim() === '仅写入元数据') { return ''; }
  const name = a.视频参数_色彩管理_滤镜选择.trim() || (['色域', '传输特性', '范围', '色调映射算法'].some(k => v(k)) ? 'libplacebo' : v('矩阵系数') ? 'colorspace' : 'libplacebo');
  const matrix = v('矩阵系数').toLowerCase() === 'rgb' ? 'gbr' : v('矩阵系数');
  const names = name.toLowerCase() === 'colorspace' ? ['space', 'primaries', 'trc', 'range'] : name.toLowerCase() === 'libplacebo' ? ['colorspace', 'color_primaries', 'color_trc', 'range', 'tonemapping'] : ['matrix', 'primaries', 'transfer', 'range'];
  const values = [matrix, v('色域'), v('传输特性'), colorRange(v('范围')), v('色调映射算法')];
  return values.slice(0, names.length).some(Boolean) ? fromNames(name, names, values) : '';
}
export function subtitleCandidates(a: Preset, input: string): string[] {
  const dir = a.视频参数_烧录字幕_外部字幕文件夹位置 || dirname(input);
  const name = a.视频参数_烧录字幕_外部字幕文件名 || stem(input);
  const priorities = a.视频参数_烧录字幕_字幕格式优先级.filter((n: number) => n > 0);
  return [...new Set<number>(priorities.length ? priorities : [1, 2, 3])].map(n => join(dir, name + '.' + ['', 'srt', 'ass', 'ssa'][n]));
}
function subtitle(a: Preset, input: string, output: string, external?: string): string {
  const p = '视频参数_烧录字幕_'; const v = (k: string): any => a[p + k];
  if (v('自己写滤镜取代所有设置')) { return substitute(v('自己写滤镜取代所有设置'), input, '<输出文件>'); }
  if (!v('滤镜选择')) { return ''; }
  const inner = v('字幕来源是外部文件') === 2;
  const file = inner ? input : external;
  if (!file || (inner && !v('指定内嵌的流'))) { return ''; }
  const opts: [string, string][] = [['filename', `'${filterPath(file).replaceAll("'", "\\'")}'`]];
  if (inner) { opts.push(['stream_index', v('指定内嵌的流')]); }
  if (v('字体文件夹')) { opts.push(['fontsdir', `'${filterPath(v('字体文件夹')).replaceAll("'", "\\'")}'`]); }
  const style: string[] = [];
  const push = (name: string, value: any) => { if (value !== '' && value !== 0 && value !== undefined) { style.push(name + '=' + value); } };
  push('FontName', v('基本样式_名称')); push('FontSize', v('基本样式_大小'));
  for (const [name, key] of [['Bold', '粗体'], ['Italic', '斜体'], ['Underline', '下划线'], ['StrikeOut', '删除线']]) { if (v('基本样式_' + key)) { push(name, -1); } }
  if (v('边框样式')) { push('BorderStyle', v('边框样式') === 1 ? 1 : 3); }
  for (const [name, key] of [['Outline', '描边宽度'], ['Shadow', '阴影距离']]) { push(name, v(key)); }
  for (const [name, key] of [['PrimaryColour', '主要颜色'], ['SecondaryColour', '次要颜色'], ['OutlineColour', '描边颜色'], ['BackColour', '背景颜色']]) {
    const c = v(key); if (c && (c.已设置 || c.A !== 255 || c.R !== 0 || c.G !== 0 || c.B !== 0)) { push(name, '&H' + ['A', 'B', 'G', 'R'].map(k => Math.max(0, Math.min(255, c[k])).toString(16).padStart(2, '0').toUpperCase()).join('')); }
  }
  for (const [name, key] of [['Alignment', '对齐方位'], ['MarginV', '垂直边距'], ['MarginL', '左边距'], ['MarginR', '右边距'], ['Spacing', '字距'], ['LineSpacing', '行距']]) { push(name, v(key)); }
  if (v('补充样式')) { style.push(v('补充样式')); }
  if (style.length) { opts.push(['force_style', `'${style.join(',').replaceAll("'", "\\'")}'`]); }
  const name = v('滤镜选择') === 2 && !inner && !style.length && ['.ass', '.ssa'].includes(extension(file).toLowerCase()) ? 'ass' : 'subtitles';
  return named(name, opts);
}
const interpolationNames: Record<string, string> = { '两帧加权平均': 'blend', '运动补偿插值': 'mci', '双向运动估计': 'bidir', '双侧运动估计': 'bilat', '穷举搜索': 'esa', '三步搜索': 'tss', '二维对数搜索': 'tdls', '新三步搜索': 'ntss', '四步搜索': 'fss', '菱形搜索': 'ds', '基于 Hexagon': 'hexbs', '增强的预测区域': 'epzs', '不均匀多六边形': 'umh', '重叠块运动补偿': 'obmc', '加权 obmc': 'aobmc' };
export function filterFragment(a: Preset, id: number, input = '<输入文件>', output = '<输出文件>', external?: string): string {
  const v = (k: string): any => a['视频参数_' + k];
  switch (id) {
    case 1: return v('分辨率_裁剪滤镜参数').trim() ? 'crop=' + v('分辨率_裁剪滤镜参数').trim() : '';
    case 2: {
      const cuda = v('分辨率自动计算_缩放滤镜').trim().toLowerCase() === 'scale_cuda';
      let algo = v('分辨率自动计算_缩放算法').trim(); if (cuda && !['nearest', 'bilinear', 'bicubic', 'lanczos'].includes(algo.toLowerCase())) { algo = ''; }
      const suffix = algo ? (cuda ? ':interp_algo=' : ':flags=') + algo : '';
      const size = v('分辨率').trim().replaceAll('X', 'x');
      if (size) { return cuda && size.includes('x') ? `scale_cuda=w=${size.split('x')[0]}:h=${size.split('x')[1]}${suffix}` : `scale=${size.replaceAll('x', ':')}${suffix}`; }
      const w = v('分辨率自动计算_宽度'), h = v('分辨率自动计算_高度');
      return w || h ? (cuda ? `scale_cuda=w=${w || '-2'}:h=${h || '-2'}` : `scale=${w || '-2'}:${h || '-2'}`) + suffix : '';
    }
    case 3: { const pairs = ['max', 'keep', 'hi', 'lo', 'frac'].map(k => [k, v('抽帧_' + k)] as [string, string]); return pairs.some(([, x]) => x) ? named('mpdecimate', pairs) : ''; }
    case 4: {
      if (!v('插帧_目标帧率')) { return ''; }
      const pairs: [string, any][] = [['fps', v('插帧_目标帧率')]];
      for (const [name, key] of [['mi_mode', '插帧模式'], ['me_mode', '运动估计模式'], ['me', '运动估计算法'], ['mc_mode', '运动补偿模式']]) { const x = v('插帧_' + key).trim(); pairs.push([name, interpolationNames[x] || x]); }
      if (v('插帧_可变块大小的运动补偿')) { pairs.push(['vsbmc', '1']); }
      for (const [name, key] of [['mb_size', '块大小'], ['search_param', '搜索范围'], ['scd_threshold', '场景变化检测强度']]) { pairs.push([name, v('插帧_' + key)]); }
      return named('minterpolate', pairs);
    }
    case 18: return v('NV_FRUC_目标帧率').trim() ? named('fruc_vulkan', [['fps', v('NV_FRUC_目标帧率').trim()], ['perf', ['slow', 'medium', 'fast'].includes(v('NV_FRUC_质量和速度').trim().toLowerCase()) ? v('NV_FRUC_质量和速度').trim().toLowerCase() : ''], ['grid', ['auto', '1', '2', '4', '8'].includes(v('NV_FRUC_网格大小').trim().toLowerCase()) ? v('NV_FRUC_网格大小').trim().toLowerCase() : '']]) : '';
    case 5: return v('动态模糊_连续混合帧数') ? named('tmix', [['frames', v('动态模糊_连续混合帧数')], ['weights', v('动态模糊_每帧权重')], ['scale', v('动态模糊_输出缩放系数')], ['planes', v('动态模糊_处理颜色平面')]]) : '';
    case 6: return (v('超分_滤镜叠加策略组').length ? v('超分_滤镜叠加策略组') : [v('超分_直接面板')]).filter(Boolean).map((s: Preset) => {
      const pairs: [string, string][] = [['w', s.目标宽度], ['h', s.目标高度], ['upscaler', s.上采样算法], ['downscaler', s.下采样算法], ['antiringing', s.抗振铃强度], ['custom_shader_path', s.着色器文件路径 ? `'${filterPath(s.着色器文件路径).replaceAll("'", "\\'")}'` : '']];
      return pairs.some(([, x]) => x) ? named('libplacebo', pairs) : '';
    }).filter(Boolean).join(',');
    case 7: {
      const p = params(a, '视频参数_降噪'); const n = v('降噪_方式');
      if (n === 1) { return 'hqdn3d' + (p.filter(Boolean).length ? '=' + p.filter(Boolean).join(':') : ''); }
      const map: Record<number, [string, string[]]> = { 2: ['nlmeans', ['s', 'p', 'pc', 'r']], 3: ['atadenoise', ['0a', '0b', '1a', '1b']], 4: ['bm3d', ['sigma', 'block', 'bstep', 'group']], 5: ['bilateral_cuda', ['sigmaS', 'sigmaR', 'window_size']] };
      return map[n] ? fromNames(map[n][0], map[n][1], p) : '';
    }
    case 8: { const p = params(a, '视频参数_锐化', 3); return v('锐化_方式') === 1 ? fromNames('cas', ['strength', 'planes'], p) : v('锐化_方式') === 2 ? 'unsharp' + (p.filter(Boolean).length ? '=' + p.filter(Boolean).join(':') : '') : ''; }
    case 9: {
      const p = params(a, '视频参数_胶片颗粒'), n = v('胶片颗粒_方式');
      if (n === 4) { return 'libplacebo=apply_filmgrain=true'; }
      if (n === 2) { return named('noise', [['c0s', p[0]], ['c0f', p[0] ? 't+u' : ''], ['c1s', p[1]], ['c1f', p[1] ? 't+u' : ''], ['c2s', p[1]], ['c2f', p[1] ? 't+u' : ''], ['all_seed', p[2]]]); }
      return n === 1 || n === 3 ? named('noise', [['alls', p[0]], ['allf', p[0] ? n === 1 ? 't+u' : 't+a+u' : ''], ['all_seed', p[1]]]) : '';
    }
    case 10: {
      const p = params(a, '视频参数_平滑断层'), n = v('平滑断层_方式');
      return n === 1 || n === 2 ? named('deband', [['1thr', p[0]], ['2thr', p[0]], ['3thr', p[0]], ['range', p[1]], ['direction', p[2]], ['blur', '1'], ['coupling', p[3]]]) : n === 3 ? fromNames('gradfun', ['strength', 'radius'], p) : n === 4 ? named('libplacebo', [['deband', 'true'], ['deband_iterations', p[0]], ['deband_threshold', p[1]], ['deband_radius', p[2]], ['deband_grain', p[3]]]) : '';
    }
    case 11: return ['', 'yadif=mode=send_frame:parity=auto:deint=all', 'yadif=mode=send_frame:parity=tff:deint=all', 'yadif=mode=send_frame:parity=bff:deint=all', 'tinterlace=mode=interleave_top', 'tinterlace=mode=interleave_bottom', 'fieldmatch,yadif=deint=interlaced,decimate', 'yadif=mode=send_field:parity=auto:deint=all', 'pullup=jl=1:jr=1,fps=25', 'yadif=mode=send_frame:parity=auto:deint=all', 'yadif=mode=send_field:parity=auto:deint=all', 'bwdif=mode=send_frame:parity=auto:deint=all', 'bwdif=mode=send_field:parity=auto:deint=all', 'yadif_cuda=mode=send_frame:parity=auto:deint=all', 'bwdif_cuda=mode=send_frame:parity=auto:deint=all'][v('处理扫描方式')] || '';
    case 12: { const n = v('画面翻转_角度翻转'); const list: string[] = Array.from({ length: n ? ((n - 1) % 3) + 1 : 0 }, () => n <= 3 ? 'transpose=1' : 'transpose=2'); if (v('画面翻转_镜像翻转')) { list.push(v('画面翻转_镜像翻转') === 1 ? 'hflip' : 'vflip'); } return list.join(','); }
    case 13: return subtitle(a, input, output, external || (input.startsWith('<') ? '<字幕文件 | 预览模式专用字符>' : undefined));
    case 14: return colorFilter(a);
    case 15: { const pairs = [['brightness', '亮度'], ['contrast', '对比度'], ['saturation', '饱和度'], ['gamma', '伽马']].map(([name, k]) => [name, v('色彩管理_启用调整' + k) ? v('色彩管理_' + k) : ''] as [string, string]); return pairs.some(([, x]) => x) ? named('eq', pairs) : ''; }
    case 16: return v('色彩管理_像素格式预先转换').trim() ? 'format=' + v('色彩管理_像素格式预先转换').trim() : '';
    case 51: { const pairs = [['I', '目标响度'], ['LRA', '动态范围'], ['TP', '峰值电平']].map(([name, k]) => [name, a['音频参数_响度标准化_启用调整' + k] ? a['音频参数_响度标准化_' + k] : ''] as [string, string]); return pairs.some(([, x]) => x) ? named('loudnorm', pairs) : ''; }
    case 52: return a.音频参数_声道数 ? 'aformat=channel_layouts=' + a.音频参数_声道数 : '';
    default: return '';
  }
}
export const priorities: Record<number, number> = { 16: 0, 1: 100, 2: 110, 3: 120, 4: 130, 18: 132, 5: 140, 6: 150, 7: 160, 8: 170, 9: 180, 10: 190, 11: 200, 12: 210, 13: 220, 14: 300, 15: 310, 51: 1000, 52: 1010, 53: 1020 };
export function normalizeOrder(a: Preset): void {
  const order: Preset[] = a.滤镜排序系统;
  for (const [type, id, key] of [[1, 101, '自定义参数_视频滤镜'], [2, 102, '自定义参数_音频滤镜']] as const) {
    const content = a[key].trim();
    if (content && !order.some(x => x.滤镜标识符 === id && x.自定义滤镜内容 === content)) { order.push({ 实例ID: 'legacy-' + id, 显示名称: type === 1 ? '自定义视频滤镜' : '自定义音频滤镜', 是自定义滤镜: true, 允许在排序页直接编辑: false, 滤镜标识符: id, 滤镜目标流类型: type, 自定义滤镜内容: content }); }
    a[key] = '';
  }
  const enumNames = data.schema.fields!.滤镜排序系统.items!.fields!.滤镜标识符.values!;
  for (const id of [1, 2, 3, 4, 18, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 14, 15, 51, 52, 53]) {
    const type = id >= 51 ? 2 : 1;
    let index = order.findIndex(x => !x.是自定义滤镜 && x.滤镜标识符 === id);
    const content = filterFragment(a, id);
    // Enable-by-setting matters for empty optional values and empty super-resolution strategies.
    const enabled = content !== '' || id === 6 && a.视频参数_超分_滤镜叠加策略组.length > 0 || id === 15 && ['亮度', '对比度', '饱和度', '伽马'].some(k => a['视频参数_色彩管理_启用调整' + k]) || id === 51 && ['目标响度', '动态范围', '峰值电平'].some(k => a['音频参数_响度标准化_启用调整' + k]);
    if (!enabled) { if (index >= 0) { order.splice(index, 1); } continue; }
    if (index < 0) {
      const later = order.findIndex(x => x.滤镜目标流类型 === type && !x.是自定义滤镜 && (priorities[x.滤镜标识符] ?? Infinity) > priorities[id]);
      const same = order.map((x, i) => x.滤镜目标流类型 === type ? i : -1).filter(i => i >= 0);
      index = later >= 0 ? later : same.length ? same[same.length - 1] + 1 : order.length;
      order.splice(index, 0, { 实例ID: 'builtin-' + id });
    }
    Object.assign(order[index], { 滤镜标识符: id, 滤镜目标流类型: type, 显示名称: id === 18 ? 'NVIDIA Vulkan FRUC' : Object.keys(enumNames).find(k => enumNames[k] === id), 自定义滤镜内容: content, 是自定义滤镜: false, 允许在排序页直接编辑: false });
  }
  a.滤镜排序系统 = order.sort((a, b) => Number(a.滤镜目标流类型 === 2) - Number(b.滤镜目标流类型 === 2));
}
