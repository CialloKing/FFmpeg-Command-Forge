// 用同一台机器、同一 Node 版本比较；耗时不作为 CI 硬阈值。
// node --import tsx tools/benchmark-plan.mjs
import { buildPlan, defaultContext } from '../src/plan.ts';
import { importPreset } from '../src/preset.ts';

const preset = importPreset({ 输出容器: 'mkv', 输出_自动命名选项: 2 });
for (const sameBasename of [false, true]) {
  for (const count of [100, 500, 1000, 2000]) {
    const context = defaultContext();
    context.outputDirectory = 'D:\\Output';
    context.inputs = Array.from({ length: count }, (_, index) => ({
      id: String(index), path: sameBasename ? `D:\\Media\\${index}\\clip.mp4` : `D:\\Media\\clip-${index}.mp4`
    }));
    await buildPlan(preset, context);
    const samples = [];
    for (let run = 0; run < 3; run++) {
      const start = performance.now();
      await buildPlan(preset, context);
      samples.push(performance.now() - start);
    }
    console.log(JSON.stringify({ sameBasename, count, medianMs: Number(samples.sort((a, b) => a - b)[1].toFixed(2)) }));
  }
}
