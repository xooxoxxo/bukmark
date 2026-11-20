import { expect, it } from 'vitest';
import { siftBookmark } from './model.js';

it('keeps an archived recipe archived while proposing its separate recipe route', () => {
  expect(siftBookmark({ url: 'https://loveandlemons.com/porridge/', title: 'Porridge Recipe', status: 'archived' }))
    .toEqual({ disposition: 'archived', handoff: 'recipe', reason: 'Existing archive.' });
});

it('recognizes an exact listing while leaving shopping intent in needs review', () => {
  expect(siftBookmark({ url: 'https://amazon.de/dp/B000000001?tag=sample', title: 'Instrument', status: 'active', appearances: 99 }))
    .toEqual({ disposition: 'needs_review', handoff: 'azuk', reason: 'Exact listing. Shopping intent and destination need review.' });
});
