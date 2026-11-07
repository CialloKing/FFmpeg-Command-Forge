import { substitute, type PathStyle } from './paths';

// FFmpeg on Windows uses CommandLineToArgvW, not a shell. Never evaluate imported fragments.
export function parseArguments(text: string): string[] {
  const args: string[] = [];
  let i = 0;
  text = text.replace(/^[ \t]+|[ \t]+$/g, '');
  while (i < text.length) {
    while (/[ \t]/.test(text[i] || '') && i < text.length) { i++; }
    if (i >= text.length) { break; }
    let arg = '', quoted = false;
    while (i < text.length) {
      if (!quoted && /[ \t]/.test(text[i])) { break; }
      let slashes = 0;
      while (text[i] === '\\') { slashes++; i++; }
      if (text[i] === '"') {
        arg += '\\'.repeat(Math.floor(slashes / 2));
        if (slashes % 2) { arg += '"'; i++; }
        else {
          // Consecutive quotes follow CommandLineToArgvW's triple-quote convention.
          let count = 0; while (text[i] === '"') { count++; i++; }
          if (quoted) { count++; }
          arg += '"'.repeat(Math.floor(count / 3));
          quoted = count % 3 === 1;
        }
      } else { arg += '\\'.repeat(slashes); if (i < text.length && (quoted || !/[ \t]/.test(text[i]))) { arg += text[i++]; } }
    }
    args.push(arg);
  }
  return args;
}
export function windowsQuote(value: string): string { return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"'; }
export const raw = (parts: string[], text: string) => { if (text?.trim()) { parts.push(...parseArguments(text.replace(/\r\n|\n|\r/g, ' '))); } };

export function presetArguments(text: string, input: string, output: string, mapLiteral?: (value: string) => string, style: PathStyle = 'windows'): string[] {
  if (!text.trim()) { return []; }
  const source = text.replace(/\r\n|\n|\r/g, ' ');
  const args = parseArguments(substitute(source, input, output, style));
  if (!mapLiteral) { return args; }
  const original = parseArguments(source);
  // Expanded placeholders already contain target paths. Only map tokens that stayed literal.
  if (args.length !== original.length) { return args; }
  return args.map((arg, index) => arg === original[index] ? mapLiteral(arg) : arg);
}

const flagOptions = new Set(['-y', '-n', '-hide_banner', '-nostdin', '-stdin', '-re', '-an', '-vn', '-sn', '-dn', '-shortest', '-bitexact', '-copyts', '-start_at_zero', '-copyinkf', '-ignore_unknown', '-copy_unknown', '-stats', '-nostats', '-xerror']);
const valueOptions = /^(?:-metadata|-map|-map_metadata|-map_chapters|-c|-codec|-filter|-vf|-af|-filter_complex|-lavfi|-f|-ss|-to|-t|-itsoffset|-itsscale|-stream_loop|-loop|-loglevel|-v|-threads|-b|-q|-crf|-preset|-profile|-tune)(?::.*)?$/;
const readOption = /^(?:-i|-attach(?::.*)?|-filter_script(?::.*)?|-filter_complex_script)$/;

export function argumentReads(args: readonly string[]): { indices: number[]; opaque: boolean } {
  const indices: number[] = [];
  let opaque = false;
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    if (readOption.test(option)) {
      if (args[i + 1] === undefined) { opaque = true; continue; }
      indices.push(++i);
      if (option !== '-i' && !option.startsWith('-attach')) { opaque = true; }
      continue;
    }
    if (flagOptions.has(option) || !option.startsWith('-')) { continue; }
    const value = args[i + 1];
    if (value === undefined) { continue; }
    if (option === '-f' && /^(concat|lavfi)$/i.test(value)) { opaque = true; }
    if (/^(?:-vf|-af|-filter(?::.*)?|-filter_complex|-lavfi)$/.test(option) &&
      /(?:^|[;,\]])\s*(?:a?movie)\s*=|(?:filename|fontfile|textfile|custom_shader_path)\s*=/i.test(value)) { opaque = true; }
    // Known values such as metadata may themselves look like switches.
    if (valueOptions.test(option) || !value.startsWith('-')) { i++; }
    else if (readOption.test(value)) { opaque = true; }
  }
  return { indices, opaque };
}
export function add(parts: string[], name: string, value: unknown, selector = ''): void {
  if (!name?.trim() || value === '' || value === null || value === undefined) { return; }
  parts.push(withSelector(name.startsWith('-') ? name : '-' + name, selector), String(value));
}
export function withSelector(name: string, selector: string): string {
  if (!selector) { return name; }
  const colon = name.indexOf(':'); return (colon >= 0 ? name.slice(0, colon) : name) + ':' + selector;
}
