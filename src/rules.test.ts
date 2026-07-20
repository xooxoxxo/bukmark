import { describe, expect, it } from 'vitest';
import { classifyJunk, isAllowed, nonHttpRule, parseAllowlist } from './rules.js';

const junkRule = (url: string, allow: string[] = []) => {
  const v = classifyJunk(url, allow);
  return v.junk ? v.rule : null;
};

describe('classifyJunk', () => {
  it.each([
    ['https://mail.google.com/mail/u/0/', 'gmail'],
    ['https://google.com/search?q=x', 'google-search'],
    ['https://google.nl/search?q=x', 'google-search'],
    ['https://calendar.google.com/calendar/r', 'google-calendar'],
    ['https://meet.google.com/abc-defg-hij', 'google-meet'],
    ['https://accounts.google.com/signin/v2', 'google-accounts'],
    ['https://app.example.com/login', 'auth-page'],
    ['https://example.com/users/sign-in', 'auth-page'],
    ['https://example.com/auth/callback', 'auth-page'],
    ['http://localhost:3000/', 'local'],
    ['http://127.0.0.1:8080/x', 'local'],
    ['http://192.168.1.10/admin', 'local'],
    ['http://10.0.0.5/', 'local'],
    ['http://172.16.0.1/', 'local'],
  ])('%s → %s', (url, rule) => {
    expect(junkRule(url)).toBe(rule);
  });

  it.each([
    'https://docs.google.com/document/d/abc/edit',
    'https://drive.google.com/file/d/xyz/view',
    'https://github.com/drizzle-team/drizzle-orm',
    'https://example.com/blog/login-security-explained',
  ])('not junk: %s', (url) => {
    expect(junkRule(url)).toBeNull();
  });

  it('allowlist wins over rules', () => {
    expect(junkRule('https://mail.google.com/mail/u/0/', ['https://mail.google.com/*'])).toBeNull();
  });
});

describe('nonHttpRule', () => {
  it.each([
    ['chrome://settings/', 'browser-internal'],
    ['chrome-extension://abc/popup.html', 'browser-internal'],
    ['about:blank', 'browser-internal'],
    ['file:///etc/hosts', 'browser-internal'],
    ['ftp://example.com/x', 'non-http'],
  ])('%s → %s', (raw, rule) => {
    expect(nonHttpRule(raw)).toBe(rule);
  });
});

describe('allowlist', () => {
  it('parses lines, skips blanks and comments', () => {
    expect(parseAllowlist('# c\nhttps://a.com/x\n\nhttps://b.com/*\n')).toEqual([
      'https://a.com/x',
      'https://b.com/*',
    ]);
  });
  it('exact and prefix matching', () => {
    expect(isAllowed('https://a.com/x', ['https://a.com/x'])).toBe(true);
    expect(isAllowed('https://a.com/xy', ['https://a.com/x'])).toBe(false);
    expect(isAllowed('https://b.com/deep/page', ['https://b.com/*'])).toBe(true);
  });
});
