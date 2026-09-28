import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HIT_END, HIT_START } from '../api/types';
import { Snippet } from './Snippet';

describe('Snippet', () => {
  it('marks the matched words and keeps the rest as text', () => {
    const { container } = render(<Snippet text={`the ${HIT_START}lifetime${HIT_END} rules for ${HIT_START}elision${HIT_END}.`} />);
    expect([...container.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['lifetime', 'elision']);
    expect(container.textContent).toBe('…the lifetime rules for elision.…');
  });

  it('never renders markup from the page', () => {
    const { container } = render(<Snippet text={`<img src=x onerror=alert(1)> ${HIT_START}hit${HIT_END}`} />);
    expect(container.querySelector('img')).toBeNull();
  });
});
