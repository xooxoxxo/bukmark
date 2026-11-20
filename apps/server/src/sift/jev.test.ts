import { expect, it, vi } from 'vitest';
import { askJev, JEV_MODEL, publicBookmarkState } from './jev.js';
import { privateConversationUrl } from './publicSource.js';

it.each([
  'https://claude.ai/chat/private-example',
  'https://claude.ai/%63hat/private-example',
  'https://chatgpt.com/c/private-example',
  'https://chat.openai.com/c/private-example',
  'https://chatgpt.com/g/public-gpt/c/private-example',
  'https://chatgpt.com/g/g-p-private-example/project',
])('rejects account-private conversation routes before reading them: %s',async url=>{
  const read=vi.fn();expect(await publicBookmarkState(url,url,read)).toBeNull();expect(read).not.toHaveBeenCalled();
});

it('holds a private conversation final URL rather than projecting its anonymous shell',async()=>{
  const read=vi.fn(async()=>({status:200,error:null,url:'https://claude.ai/chat/private-example',html:'<title>Claude</title>'}));
  expect(await publicBookmarkState('https://claude.ai/','https://claude.ai/',read)).toBeNull();
});

it('does not blanket-reject public share paths or conversation-like paths on unrelated hosts',()=>{
  expect(privateConversationUrl('https://claude.ai/share/public-example')).toBe(false);
  expect(privateConversationUrl('https://chatgpt.com/share/public-example')).toBe(false);
  expect(privateConversationUrl('https://example.org/chat/tutorial')).toBe(false);
});

it.each([
  ['https://mail.example.com/mail/u/0', 'https://mail.example.com/mail/u/0'],
  ['https://example.com/%6cogin', 'https://example.com/%6cogin'],
  ['https://example.com/private-order', 'https://example.com/guide'],
  ['https://example.com/guide?session=private', 'https://example.com/guide'],
])('rejects an unsafe public nomination before reading it', async (saved, nominated) => {
  const read = vi.fn();
  expect(await publicBookmarkState(saved, nominated, read)).toBeNull();
  expect(read).not.toHaveBeenCalled();
});

it('uses the verified listing page and sends only its public fields to TypeSafe', async () => {
  const canonical = 'https://www.amazon.de/dp/B000000001';
  const read = vi.fn(async () => ({
    status: 200, error: null, url: canonical,
    html: '<head><title>Public instrument</title></head><body>Unsent page body</body>',
  }));
  const state = await publicBookmarkState('https://amazon.de/old/dp/B000000001/ref=saved?tracking=local', canonical, read);
  expect(read).toHaveBeenCalledWith(canonical);
  expect(state).toEqual({ host: 'amazon.de', path: '/dp/B000000001', title: 'Public instrument' });

  const api = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    expect(request.state).toEqual({ host: 'amazon.de', path: '/dp/B000000001', title: 'Public instrument' });
    expect(request.model).toBe(JEV_MODEL);
    expect(Object.keys(request.questions)).toEqual(['disposition', 'handoff']);
    return Response.json({
      model: JEV_MODEL, usage: { input_tokens: 1000, output_tokens: 65 },
      answers: {
        disposition: { type: 'choice', choice: 'reference', confidence: 0.85, probabilities: { reference: 0.72 } },
        handoff: { type: 'choice', choice: 'azuk', confidence: 0.91, probabilities: { azuk: 0.91 } },
      },
    });
  });
  expect(await askJev(state!, 'test-key', api)).toEqual({
    model: JEV_MODEL, inputTokens: 1000, costUsd: 0.000042,
    disposition: { value: 'reference', confidence: 0.85, probability: 0.72 },
    handoff: { value: 'azuk', confidence: 0.91, probability: 0.91 },
    needsReview: true,
  });
});
