import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom has no layout engine and no ResizeObserver; @tanstack/react-virtual
// needs both to decide which rows to render.
class ResizeObserverStub {
  private callback: ResizeObserverCallback;
  private element: Element | null = null;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(element: Element): void {
    this.element = element;
    // Fire callback immediately with mocked dimensions
    if (this.element) {
      const rect = this.element.getBoundingClientRect();
      const entries = [
        {
          target: this.element,
          contentRect: rect,
          contentBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
          borderBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
          devicePixelContentBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
        } as unknown as ResizeObserverEntry,
      ];
      this.callback(entries, this as unknown as ResizeObserver);
    }
  }

  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

// jsdom 25 ships Blob without the text() reader every browser has had since
// 2020. The import flow uses it, so the environment gets the shim rather than
// the app getting a FileReader detour.
if (typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function (this: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

// Radix Select relies on pointer-capture and scrolling APIs that jsdom omits.
HTMLElement.prototype.hasPointerCapture = () => false;
HTMLElement.prototype.setPointerCapture = () => undefined;
HTMLElement.prototype.releasePointerCapture = () => undefined;
HTMLElement.prototype.scrollIntoView = () => undefined;

Element.prototype.getBoundingClientRect = function (): DOMRect {
  return {
    width: 1024,
    height: 768,
    top: 0,
    left: 0,
    bottom: 768,
    right: 1024,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
};
