# 第三方说明

- FFmpegFreeUI：1059 Studio，MIT。移植预设数据、数据库和纯命令生成规则；固定来源见 `upstream.json`，原许可见 `FFmpegFreeUI-LICENSE.txt`。不分发或链接 LakeUI，不包含原版的原生 UI、Agent 及硬件监控组件。
- fflate：Arjun Barrett，MIT。用于浏览器内生成任务 ZIP，实际版本和许可证包含在依赖锁文件及发布 HTML 中。
- .NET 时间解析兼容规则：参考 .NET Foundation 的 MIT 开源运行时和实际 .NET 10 对照结果，以保持原版 TimeSpan 行为。
- TypeScript、esbuild、tsx、Playwright：开发及验证工具，不要求最终用户安装，依照各自软件包许可使用。

FFmpeg 本体、硬件 SDK、字体、着色器和帧服务器由用户独立提供，不包含在 HTML 或生成任务包内。用户导入的模板内容由本地任务包保存，不会上载。
