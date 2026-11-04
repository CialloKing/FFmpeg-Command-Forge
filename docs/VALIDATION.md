# 验证记录

验证日期：2026-11-04（Asia/Shanghai）。参考版本 6.2.43 / 9cff6bf。

## 已在当前 Windows 主机验证

- `npm run check`：TypeScript 类型检查通过。
- `npm test`：9 个测试组通过；1 个原生 POSIX 测试组因当前主机为 Windows 跳过。
- 原版对照覆盖全部内置预设、全部视频编码器、全部音频私有 ID、画面效果枚举及代表性的质量、流映射、字幕样式、元数据、章节、附件、复杂滤镜、剪辑、两遍编码、自定义参数和 TimeSpan 边界。
- 对照实际参数数组、滤镜图及阶段数量，不用展示字符串差异代替语义比较。
- 原生参数探针与 Windows FFmpeg 一样使用 CommandLineToArgvW。PowerShell 7、Windows PowerShell 5.1、CMD 交互式、下载 `.cmd` 以及完整 Windows 辅助脚本均通过空字符串、中文、引号、尾反斜杠、UNC 和特殊字符检查。
- Git Bash 验证了部分 POSIX 引用；其 MSYS 原生进程桥会改变 UNC 前缀，该项不作为 POSIX 原生验收。
- 合成短媒体验证了三种 Windows 脚本、缩放、AAC、两遍编码、特殊字符元数据、重名递增、修改时间保留。
- 实际验证外部字幕烧录、字幕混流、FFmetadata 章节和 MKV 附件；生成帧服务器文件的 UTF-8 内容检查通过。
- 阶段失败后不执行后续阶段；输出文件保留。
- Edge `file:` 页面通过参数编辑、预设往返、ZIP 任务包、复制降级、滤镜排序与未知字段保留、全局搜索、暗/亮主题、390px 移动布局、工作区恢复、禁用浏览器存储检查；无外部网络请求，无页面错误。

## 尚未实际验证

- Linux Bash、macOS Bash/Zsh 的原生环境运行；已提供对应测试和三系统 CI 工作流，尚未推送触发远端验证。
- Chrome、Firefox、Safari 的实际浏览器行为。
- 各厂商 GPU 编码器、特定 FFmpeg 构建的外部滤镜、真实 AviSynth/VapourSynth 执行环境。
- 各种文件系统的创建时间/访问时间精度和网络路径行为。

上述项目不标为通过。浏览器或系统限制会在使用流程中提供降级或明确阻断；设备与 FFmpeg 构建依赖仍需在目标机器验证。
