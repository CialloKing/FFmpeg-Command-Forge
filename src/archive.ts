import { AsyncZipDeflate, Zip } from 'fflate';
import { createCheckpoint, type WorkOptions } from './scheduling';

export async function createArchive(files: Record<string, string | Uint8Array>, options: WorkOptions = {}): Promise<Uint8Array> {
  const checkpoint = createCheckpoint(options), chunks: Uint8Array[] = [];
  let archive: Zip, rejectResult: (error: unknown) => void = () => {};
  const completed = new Promise<void>((resolve, reject) => {
    rejectResult = reject;
    archive = new Zip((error, data, final) => {
      if (error) { reject(error); return; }
      chunks.push(data); if (final) { resolve(); }
    });
  });
  // 及时观察异步 worker 错误；最终仍由 completed 将同一错误交给调用方。
  void completed.catch(() => {});
  try {
    const encoder = new TextEncoder();
    for (const [name, content] of Object.entries(files)) {
      const stream = new AsyncZipDeflate(name); archive!.add(stream);
      if (!content.length) { stream.push(new Uint8Array(), true); }
      for (let start = 0; start < content.length;) {
        const pause = checkpoint(); if (pause) { await pause; }
        let end = Math.min(start + 32768, content.length);
        // UTF-16 的代理对不能被拆成两个编码块，否则导出的中文扩展字符会改变。
        if (typeof content === 'string' && end < content.length && /[\uD800-\uDBFF]/.test(content[end - 1])) { end--; }
        const bytes = typeof content === 'string' ? encoder.encode(content.slice(start, end)) : content.slice(start, end);
        stream.push(bytes, end === content.length); start = end;
      }
    }
    archive!.end(); await completed;
    const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      const pause = checkpoint(); if (pause) { await pause; }
      result.set(chunk, offset); offset += chunk.length;
    }
    return result;
  } catch (error) { archive!.terminate(); rejectResult(error); throw error; }
}
