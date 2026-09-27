import { readFileSync } from 'node:fs';

type Listener = () => unknown;

/** Just enough of an element to run popup/main.ts and options/main.ts under Node. */
export class FakeElement {
  value: string | number = '';
  textContent = '';
  hidden = false;
  disabled = false;
  max = 1;
  readonly children: FakeElement[] = [];
  private readonly classes = new Set<string>();
  private readonly listeners: Record<string, Listener[]> = {};

  constructor(readonly tagName: string, readonly id = '') {}

  readonly classList = {
    toggle: (name: string, force?: boolean): boolean => {
      const on = force ?? !this.classes.has(name);
      if (on) this.classes.add(name);
      else this.classes.delete(name);
      return on;
    },
    contains: (name: string): boolean => this.classes.has(name),
  };

  addEventListener(type: string, listener: Listener): void {
    (this.listeners[type] ??= []).push(listener);
  }

  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }

  removeAttribute(name: string): void {
    if (name === 'value') this.value = '';
  }

  /** Like a real click: a disabled button ignores it. */
  click(): void {
    if (this.disabled) return;
    for (const listener of this.listeners.click ?? []) void listener();
  }
}

/**
 * Builds elements from the ids in the real HTML file, with their initial
 * hidden/disabled/value attributes, so a renamed id fails a test instead of
 * passing against a made-up element.
 */
export function loadPage(file: 'popup.html' | 'options.html') {
  const html = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  const elements = new Map<string, FakeElement>();
  for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)) {
    const attrs = match[2] ?? '';
    const id = /\sid="([^"]+)"/.exec(attrs)?.[1];
    if (!id) continue;
    const el = new FakeElement((match[1] ?? '').toLowerCase(), id);
    el.hidden = /\shidden(?=[\s/=]|$)/.test(attrs);
    el.disabled = /\sdisabled(?=[\s/=]|$)/.test(attrs);
    el.value = /\svalue="([^"]*)"/.exec(attrs)?.[1] ?? '';
    elements.set(id, el);
  }
  return {
    document: {
      getElementById: (id: string) => elements.get(id) ?? null,
      createElement: (tagName: string) => new FakeElement(tagName),
    },
    /** An element of the page; throws when the HTML has no such id. */
    el(id: string): FakeElement {
      const el = elements.get(id);
      if (!el) throw new Error(`${file} has no #${id}`);
      return el;
    },
  };
}
