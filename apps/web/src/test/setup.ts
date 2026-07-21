import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom has no layout engine and no ResizeObserver; @tanstack/react-virtual
// needs both to decide which rows to render.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

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
