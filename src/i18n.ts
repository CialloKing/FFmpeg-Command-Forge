import en from './locales/en.json';
import enSchema from './locales/en-schema.json';

const languageTags = { zh: 'zh-CN', en: 'en' } as const;
export type Locale = typeof languageTags[keyof typeof languageTags];
export type Translate = (text: string, ...values: (string | number)[]) => string;

export function detectLocale(preferences: readonly string[]): Locale {
  for (const preference of preferences) {
    const language = lookup<Locale>(languageTags, preference.toLowerCase().split('-')[0]);
    if (language) { return language; }
  }
  return 'en';
}

export const sourceText: Translate = (text, ...values) => text.replace(/\{(\d+)\}/g, (token, index: string) => String(values[Number(index)] ?? token));

type Catalog = {
  messages: Record<string, string>;
  fields: Record<string, string>;
  options: Record<string, string>;
  presets: Record<string, { name?: string; note: string }>;
};
const catalogs: Partial<Record<Locale, Catalog>> = { en: { messages: en, ...enSchema } };
const lookup = <T>(catalog: Record<string, T>, key: string): T | undefined => Object.hasOwn(catalog, key) ? catalog[key] : undefined;

export function translator(locale: Locale): Translate {
  const messages = catalogs[locale]?.messages;
  return messages ? (text, ...values) => sourceText(lookup(messages, text) ?? text, ...values) : sourceText;
}

export function parameterLabel(locale: Locale, key: string): string {
  const name = key.replace(/^(视频参数_|音频参数_|解码参数_)/, '');
  const fields = catalogs[locale]?.fields;
  return fields ? name.split('_').map(part => lookup(fields, part) ?? part).join(' / ') : name.replaceAll('_', ' / ');
}

export function optionLabel(locale: Locale, value: string): string {
  const catalog = catalogs[locale];
  const label = catalog && (lookup(catalog.options, value) ?? lookup(catalog.fields, value));
  return label ?? value.replaceAll('_', ' ');
}

export function presetText(locale: Locale, name: string, note: string): { name: string; note: string } {
  const presets = catalogs[locale]?.presets;
  const localized = presets && lookup(presets, name);
  return { name: localized?.name ?? name, note: localized?.note ?? note };
}
