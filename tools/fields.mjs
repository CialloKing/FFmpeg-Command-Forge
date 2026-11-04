import { writeFile } from 'node:fs/promises';
import { data, groupFor, groups } from '../src/preset.ts';
const behavior = key => {
  if (['预设备注', '计算机名称', '视频参数_编码器_分类名称'].includes(key)) return '保留与编辑；不直接写入 FFmpeg 参数';
  if (key === '预设文件版本') return '兼容版本检查';
  if (/保留.*时间/.test(key)) return '辅助脚本文件时间后处理';
  if (/^(输出位置|输出目录|输出命名|输出_自动)/.test(key)) return '路径上下文、输出命名及冲突处理';
  if (key === '输出容器') return '输出后缀及容器适配';
  if (key.startsWith('输出_')) return '输出目标声明';
  if (key.includes('视频帧服务器')) return '模板导入、展开及实际输入准备';
  const group = groupFor(key);
  return ({ 解码: '输入前解码参数', 编码器: '编码器数据库映射及按流参数', 画面: '滤镜片段、稳定排序与流图', 字幕: '字幕来源、样式及烧录滤镜', 质量: '质量模式、码率及分阶段编码', 色彩: '滤镜转换与色彩元数据', 音频: '私有 ID、音频参数及处理滤镜', 剪辑: '输入/输出寻址、时间解析及剪辑滤镜', 流控制: '流图、字幕容器适配及保留规则', 附加内容: '元数据、章节、附件及封面', 自定义参数: '原版参数语法、占位符及插入位置' })[group] || '版本信息';
};
let text = '# v6 字段归属\n\n自动生成自固定版本的反射模型。每个根字段列出类型、界面分组与行为；嵌套对象的字段类型、默认值与枚举保存在 `src/data/upstream.json`。\n\n';
text += `共 ${Object.keys(data.schema.fields).length} 个顶层字段。\n\n`;
for (const group of groups) {
  text += `## ${group}\n\n| 原生字段 | 类型 | 行为 |\n| --- | --- | --- |\n`;
  for (const [key, spec] of Object.entries(data.schema.fields).filter(([key]) => groupFor(key) === group)) { text += `| ${key} | ${spec.kind} | ${behavior(key)} |\n`; }
  text += '\n';
}
await writeFile('docs/FIELDS.md', text);
console.log(`字段清单已生成；${Object.keys(data.video).length} 个视频条目、${data.audio.length} 个音频条目、${data.builtins.length} 个内置预设。`);
