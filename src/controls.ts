import type { Translate } from './i18n';
import type { IssueTarget } from './types';
import { targetKey } from './diagnostics';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] { const node = document.createElement(tag); node.className = className; if (text !== undefined) { node.textContent = text; } return node; }
export function button(text: string, action: () => void, cls = ''): HTMLButtonElement { const b = el('button', cls, text); b.type = 'button'; b.onclick = action; return b; }
export function row(...nodes: (Node | string)[]): HTMLDivElement { const r = el('div', 'row'); r.append(...nodes); return r; }
export function issueTarget<T extends HTMLElement>(node: T, target: IssueTarget): T { node.dataset.issueTarget = targetKey(target); return node; }
export function labeled(label: string, node: HTMLElement, hint = '', wide = false): HTMLDivElement {
  const field = el('div', 'field' + (wide ? ' wide' : '')); const control = node.querySelector('input[role="combobox"]') ?? node;
  const id = 'field-' + crypto.randomUUID(); control.id = id; const l = el('label', '', label); l.htmlFor = id; field.append(l, node); if (hint) { field.append(el('small', 'hint', hint)); } return field;
}
export function textInput(value: string, onChange: (v: string) => void, placeholder = ''): HTMLInputElement { const input = el('input'); input.value = value; input.placeholder = placeholder; input.oninput = () => onChange(input.value); return input; }

export type Choice = [value: string, label: string];
export function createControls(t: Translate) {
  function choiceInput(options: Choice[], value: string, onChange: (v: string) => void, allowCustom = false): HTMLElement {
    const field = el('div', 'choice');
    const input = el('input');
    const popup = el('div', 'choice-popup');
    const list = el('div');
    const empty = el('div', 'choice-empty', t('没有匹配的选项'));
    const toggle = button('▾', () => {
      if (!popup.hidden) { dismiss(); return; }
      input.focus(); input.select(); showChoices('');
    }, 'choice-toggle');
    let matches: Choice[] = [];
    let active = -1;

    const displayValue = () => options.find(([id]) => id === value)?.[1] ?? value;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    list.id = 'choices-' + crypto.randomUUID();
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', t('候选选项'));
    input.setAttribute('aria-controls', list.id);
    toggle.setAttribute('aria-label', t('切换候选列表'));
    toggle.tabIndex = -1;
    toggle.onmousedown = event => event.preventDefault();
    empty.setAttribute('role', 'status');
    popup.append(list, empty);
    field.append(input, toggle, popup);
    dismiss();

    function dismiss(label = displayValue()): void {
      popup.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      input.value = label;
    }
    function update(next: string): void {
      if (next !== value) { value = next; onChange(next); }
    }
    function choose([id, label]: Choice): void {
      dismiss(label);
      update(id);
    }
    function showChoices(query: string): void {
      const terms = query.trim().toLowerCase().split(/\s+/);
      matches = options.filter(([id, label]) => terms.every(term => `${label} ${id}`.toLowerCase().includes(term)));
      active = -1;
      input.removeAttribute('aria-activedescendant');
      list.replaceChildren(...matches.map((choice, index) => {
        const option = el('div', 'choice-option', choice[1]);
        option.id = `${list.id}-${index}`;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', 'false');
        // 保持焦点在输入框上，以免候选项在点击生效前被失焦事件关闭。
        option.onmousedown = event => event.preventDefault();
        option.onclick = () => choose(choice);
        return option;
      }));
      empty.hidden = matches.length > 0;
      const bounds = input.getBoundingClientRect();
      const below = window.innerHeight - bounds.bottom;
      popup.classList.toggle('above', below < 240 && bounds.top > below);
      popup.hidden = false;
      popup.scrollTop = 0;
      input.setAttribute('aria-expanded', 'true');
    }

    input.onfocus = () => input.select();
    input.onclick = () => { if (popup.hidden) { input.select(); showChoices(''); } };
    input.onblur = () => dismiss();
    input.oninput = () => {
      if (allowCustom) { update(input.value); }
      showChoices(input.value);
    };
    input.onkeydown = event => {
      if (event.isComposing) { return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (popup.hidden) { showChoices(''); }
        if (!matches.length) { return; }
        list.children[active]?.setAttribute('aria-selected', 'false');
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const next = active < 0 && direction < 0 ? matches.length - 1 : active + direction;
        active = Math.max(0, Math.min(next, matches.length - 1));
        const option = list.children[active];
        option.setAttribute('aria-selected', 'true');
        input.setAttribute('aria-activedescendant', option.id);
        option.scrollIntoView({ block: 'nearest' });
      } else if (event.key === 'Enter' && !popup.hidden) {
        event.preventDefault();
        if (active >= 0) { choose(matches[active]); }
        else if (!allowCustom && matches.length === 1) { choose(matches[0]); }
        else if (allowCustom) { dismiss(); }
      } else if (event.key === 'Escape' && !popup.hidden) {
        event.preventDefault(); dismiss();
      }
    };
    return field;
  }

  return { choiceInput };
}
