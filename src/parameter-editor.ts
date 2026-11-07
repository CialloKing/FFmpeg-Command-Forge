import { blankValue, clone, data, effectiveValue, matchesFieldShape, matchesFieldType, schema } from './preset';
import { normalizeOrder } from './filters';
import { optionLabel, parameterLabel, type Locale, type Translate } from './i18n';
import { presetTarget } from './diagnostics';
import { button, createControls, el, issueTarget, labeled, textInput, type Choice } from './controls';
import type { FieldPath, Preset, PresetDocument, Schema } from './types';

interface ParameterEditorOptions {
  readDocument(): PresetDocument;
  readLocale(): Locale;
  translate: Translate;
  edit(path: FieldPath, value: unknown): void;
  openTextDialog(title: string, text: string, apply: (value: string) => void): void;
  renderEditor(): void;
  importTemplate(key: string): void;
}

export function createParameterEditor(options: ParameterEditorOptions) {
  const { readDocument, readLocale, translate: t, edit, openTextDialog, renderEditor, importTemplate } = options;
  const { choiceInput } = createControls(t);
  const currentValue = (path: FieldPath) => path.reduce<any>((value, key) => value?.[key], readDocument().raw);
  const parameterHints: Record<string, string> = { 视频参数_编码器_具体编码: '-c:v', 视频参数_编码器_编码预设: '-preset', 视频参数_帧速率: '-r', 视频参数_帧速率模式: '-fps_mode', 视频参数_分辨率: 'scale / scale_cuda', 视频参数_分辨率_裁剪滤镜参数: 'crop', 视频参数_比特率_基础: '-b:v', 视频参数_比特率_最低值: '-minrate', 视频参数_比特率_最高值: '-maxrate', 视频参数_比特率_缓冲区: '-bufsize', 视频参数_色彩管理_像素格式: '-pix_fmt', 音频参数_编码器_代号: '-c:a · 使用 3FUI 私有 ID', 音频参数_比特率: '-b:a', 音频参数_采样率: '-ar', 音频参数_位深度: '-sample_fmt', 解码参数_解码器: '-hwaccel', 解码参数_解码数据格式: '-hwaccel_output_format', 剪辑区间_入点: '-ss / trim · 建议使用 00:00:10 或 10.0', 剪辑区间_出点: '-to / trim · 建议使用 00:00:20 或 20.0', 输出_自动命名选项: '自动命名与冲突处理包含在完整脚本中', 自定义参数_完全自己写: '覆盖自动生成的 FFmpeg 参数；按原版 Windows 参数语法解析，不执行 Shell 代码' };
  const familyHints: [string, string][] = [
    ['视频参数_编码器_配置文件', '-profile'], ['视频参数_编码器_场景优化', '-tune'], ['视频参数_编码器_图片', '-q:v'], ['视频参数_编码器_gpu', '-gpu'], ['视频参数_编码器_threads', '-threads'], ['解码参数_CPU', '-threads'],
    ['视频参数_分辨率自动', 'scale / scale_cuda · w / h / flags / interp_algo'], ['视频参数_抽帧', 'mpdecimate · max / keep / hi / lo / frac'], ['视频参数_插帧', 'minterpolate · fps / mi_mode / me_mode / me / mc_mode'], ['视频参数_NV_FRUC', 'fruc_vulkan · fps / perf / grid'], ['视频参数_动态模糊', 'tmix · frames / weights / scale / planes'],
    ['视频参数_超分', 'libplacebo · upscaler / downscaler / custom_shader_path'], ['视频参数_降噪', 'hqdn3d / nlmeans / atadenoise / bm3d / bilateral_cuda'], ['视频参数_锐化', 'cas / unsharp'], ['视频参数_胶片颗粒', 'noise / apply_filmgrain'], ['视频参数_平滑断层', 'deband / gradfun / libplacebo'], ['视频参数_处理扫描', 'yadif / bwdif / tinterlace / fieldmatch / pullup'], ['视频参数_画面翻转', 'transpose / hflip / vflip'],
    ['视频参数_烧录字幕', 'subtitles / ass · filename / stream_index / fontsdir / force_style'], ['视频参数_色彩管理', 'colorspace / zscale / libplacebo / eq · -colorspace / -color_primaries / -color_trc / -color_range'], ['视频参数_质量控制', '-crf / -cq / -qp / -rc'], ['视频参数_比特率_控制', '-rc / -pass / -passlogfile'], ['音频参数_质量', '-q:a / -compression_level'], ['音频参数_声道', 'aformat · channel_layouts'], ['音频参数_响度', 'loudnorm · I / LRA / TP'],
    ['流控制_', '-map / -c:s / -map_metadata / -map_chapters'], ['元数据_', '-metadata'], ['章节_', '-f ffmetadata / -map_chapters'], ['附件_', '-attach / -metadata:s:t / -disposition'], ['自定义参数_视频滤镜', '-vf / -filter:v / -filter_complex'], ['自定义参数_音频滤镜', '-af / -filter:a / -filter_complex']
  ];
  const fieldHint = (key: string) => t(parameterHints[key] || familyHints.find(([prefix]) => key.startsWith(prefix))?.[1] || '');
  function parameterField(key: string, spec: Schema, value: any, path: FieldPath): HTMLElement {
    return issueTarget(renderParameterField(key, spec, value, path), presetTarget(path));
  }
  function renderParameterField(key: string, spec: Schema, value: any, path: FieldPath): HTMLElement {
    const label = parameterLabel(readLocale(), key);
    const hint = path.length === 1 ? fieldHint(key) || (readLocale() === 'zh-CN' ? key : '') : '';
    if (!matchesFieldType(value, spec)) {
      const field = el('div', 'field wide invalid-field');
      field.append(el('strong', '', label), el('p', 'error-message', t('字段类型不匹配，原始值已保留。')),
        el('pre', 'mono', JSON.stringify(value, null, 2)), button(t('编辑此字段 JSON'), () => {
          openTextDialog(t('编辑字段：{0}', label), JSON.stringify(currentValue(path), null, 2), text => {
            const value = JSON.parse(text);
            if (!matchesFieldShape(value, spec)) { throw new Error(t('此字段包含类型错误，请按字段结构修改 JSON。')); }
            edit(path, value); renderEditor();
          });
        }, 'small'));
      return field;
    }
    value ??= effectiveValue(readDocument(), path) ?? blankValue(spec);
    if (spec.kind === 'object' || spec.kind === 'array') {
      const wrapper = el('div', 'field wide');
      const details = el('details', 'nested'); const summary = el('summary', '', label + (spec.kind === 'array' ? t(' · {0} 项', (value || []).length) : '')); details.append(summary);
      if (spec.kind === 'object') {
        const fields = el('div', 'parameter-fields'); for (const [k, s] of Object.entries(spec.fields!)) { fields.append(parameterField(k, s, value?.[k], [...path, k])); } details.append(fields);
      } else {
        const list = el('div'); const values: any[] = value || [];
        // 字段编辑会替换预设对象；结构操作必须读取最新数组，不能写回渲染时的快照。
        const change = (update: (items: any[]) => void) => {
          const items = clone(currentValue(path) ?? effectiveValue(readDocument(), path) ?? []);
          update(items); edit(path, items);
          const replacement = parameterField(key, spec, currentValue(path), path);
          replacement.querySelector('details')!.open = details.open;
          wrapper.replaceWith(replacement);
        };
        values.forEach((v, i) => {
          const item = issueTarget(el('div', 'array-item'), presetTarget([...path, i]));
          if (v === null) { item.append(el('p', 'muted', t('空项，不参与命令生成。'))); }
          else if (spec.items!.kind === 'object' && matchesFieldType(v, spec.items!)) { for (const [k, s] of Object.entries(spec.items!.fields!)) { item.append(parameterField(k, s, v?.[k], [...path, i, k])); } }
          else { item.append(parameterField(t('第 {0} 项', i + 1), spec.items!, v, [...path, i])); }
          const actions = el('div', 'array-actions');
          const move = (delta: number) => change(items => { if (i + delta < 0 || i + delta >= items.length) { return; } [items[i], items[i + delta]] = [items[i + delta], items[i]]; });
          actions.append(button('↑', () => move(-1), 'small'), button('↓', () => move(1), 'small'), button(t('删除'), () => change(items => { items.splice(i, 1); }), 'small danger')); item.append(actions); list.append(item);
        });
        details.append(list, button(t('+ 添加一项'), () => change(items => { items.push(blankValue(spec.items!)); }), 'small'));
      }
      wrapper.append(details); return wrapper;
    }
    if (spec.kind === 'boolean') {
      const input = el('input'); input.type = 'checkbox'; input.checked = !!value; input.onchange = () => edit(path, input.checked); const field = labeled(label, input); field.className = 'field boolean'; field.prepend(input); return field;
    }
    let input: HTMLElement;
    if (spec.kind === 'enum') {
      const invalid = readDocument().issues.some(issue => issue.target?.scope === 'preset' && JSON.stringify(issue.target.path) === JSON.stringify(path));
      if (!invalid) { value = effectiveValue(readDocument(), path) ?? value; }
      const name = typeof value === 'number' ? Object.keys(spec.values!).find(k => spec.values![k] === value) || String(value) : String(value);
      const options: Choice[] = Object.keys(spec.values!).map(k => [k, optionLabel(readLocale(), k)]); if (!Object.hasOwn(spec.values!, name)) { options.unshift([name, t('未知：{0}', name)]); }
      input = choiceInput(options, name, v => edit(path, v));
    } else if (key === '音频参数_编码器_代号') {
      const current = String(value ?? '');
      const knownId = data.audio.find(codec => codec.私有ID.toLowerCase() === current.toLowerCase())?.私有ID;
      const options: Choice[] = data.audio.map(codec => [codec.私有ID, t('{0}（{1}）', optionLabel(readLocale(), codec.显示名称), codec.私有ID)]);
      options.unshift(['', t('未设置')]);
      // 保留未知的导入值，避免下拉框将无法生成命令的预设误显示为未设置。
      if (current && !knownId) { options.unshift([current, t('未知：{0}', current)]); }
      input = choiceInput(options, knownId ?? current, v => edit(path, v));
    } else if (key === '视频参数_编码器_具体编码' || key === '输出容器') {
      const choices = key === '视频参数_编码器_具体编码' ? Object.keys(data.video) : ['mp4', 'mkv', 'webm', 'mov', 'mp3', 'flac', 'wav', 'opus', 'png'];
      input = choiceInput(choices.map(choice => [choice, choice]), String(value ?? ''), v => edit(path, v), true);
    } else if (/自定义参数|自己写滤镜|进阶参数集/.test(key)) {
      const area = el('textarea', 'mono'); area.value = value ?? ''; area.oninput = () => edit(path, area.value); input = area;
    } else {
      const text = textInput(String(value ?? ''), v => edit(path, spec.kind === 'number' ? Number(v || 0) : v));
      if (spec.kind === 'number') { text.type = 'number'; text.step = 'any'; }
      input = text;
    }
    const field = labeled(label, input, hint, /自定义参数|自己写滤镜|进阶参数集/.test(key));
    if (/^(视频参数_视频帧服务器_)(avs|vpy)脚本文件$/.test(key)) { field.append(button(t('导入模板内容'), () => importTemplate(key), 'small')); }
    return field;
  }
  function filterOrder(): HTMLElement {
    if (!matchesFieldShape(readDocument().raw.滤镜排序系统, schema.fields!.滤镜排序系统)) {
      return el('div', 'note', t('请先修复滤镜排序字段中的类型错误。'));
    }
    const a = clone(readDocument().normalized); normalizeOrder(a); const order: Preset[] = a.滤镜排序系统;
    const box = el('div', 'card'); box.append(el('h3', '', t('滤镜执行顺序')), el('p', 'subtitle', t('同类滤镜保留已有顺序。内置滤镜内容随参数更新；自定义滤镜可在下方数组中编辑。')));
    if (!order.length) { box.append(el('div', 'empty', t('尚未启用滤镜。配置画面、字幕或音频处理后会显示在这里。'))); }
    order.forEach((item, i) => {
      const line = el('div', 'filter-item'); const detail = el('div', 'grow'); const name = item.显示名称 ? (item.是自定义滤镜 && !String(item.实例ID).startsWith('legacy-') ? item.显示名称 : optionLabel(readLocale(), item.显示名称)) : t('自定义滤镜'); detail.append(el('div', '', name), el('div', 'filter-detail mono', item.自定义滤镜内容));
      const move = (delta: number) => {
        const latest = clone(readDocument().normalized); normalizeOrder(latest);
        const order: Preset[] = latest.滤镜排序系统;
        const currentIndex = order.findIndex(filter => filter.实例ID === item.实例ID);
        if (currentIndex < 0) { renderEditor(); return; }
        const i = currentIndex;
        if (!order[i + delta] || order[i + delta].滤镜目标流类型 !== item.滤镜目标流类型) { return; }
        [order[i], order[i + delta]] = [order[i + delta], order[i]];
        const rawOrder = readDocument().raw.滤镜排序系统;
        const remaining: Preset[] = Array.isArray(rawOrder) ? rawOrder.filter(x => x && typeof x === 'object' && !Array.isArray(x)) : [];
        const items = order.map(normalized => { const originalIndex = remaining.findIndex(x => x.实例ID && x.实例ID === normalized.实例ID || (typeof x.滤镜标识符 === 'number' ? x.滤镜标识符 : schema.fields!.滤镜排序系统.items!.fields!.滤镜标识符.values![x.滤镜标识符]) === normalized.滤镜标识符 && x.自定义滤镜内容 === normalized.自定义滤镜内容); const original = originalIndex >= 0 ? remaining.splice(originalIndex, 1)[0] : {}; return { ...original, ...normalized }; });
        edit(['滤镜排序系统'], items); renderEditor();
      };
      line.append(el('span', 'filter-icon', item.滤镜目标流类型 === 2 ? 'A' : 'V'), detail, button('↑', () => move(-1), 'small'), button('↓', () => move(1), 'small')); box.append(line);
    });
    return box;
  }

  return { parameterField, filterOrder, fieldHint };
}
