import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fakeChrome, type FakeChrome } from '../test/chrome';
import { requestLogin } from './login';

let chrome: FakeChrome;

beforeEach(() => {
  chrome = fakeChrome();
  vi.stubGlobal('chrome', chrome);
});

afterEach(() => { vi.unstubAllGlobals(); });

const firstCall = (fn: Mock) => fn.mock.invocationCallOrder[0] ?? Infinity;

describe('requestLogin', () => {
  it('asks for the host, saves it as the server, then has the background log in', async () => {
    chrome.permissions.contains.mockResolvedValue(false);
    await expect(requestLogin(' http://nas.lan:3000/ ')).resolves.toEqual({ ok: true });

    expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: ['http://nas.lan:3000/*'] });
    expect(chrome.storage.sync.data.baseUrl).toBe('http://nas.lan:3000');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'login', baseUrl: 'http://nas.lan:3000' });
    expect(firstCall(chrome.permissions.request)).toBeLessThan(firstCall(chrome.storage.sync.set));
    expect(firstCall(chrome.storage.sync.set)).toBeLessThan(firstCall(chrome.runtime.sendMessage));
  });

  it('waits on nothing before the permission check, so the click still counts as a gesture', async () => {
    await requestLogin('http://nas.lan:3000');
    const permissionCheck = firstCall(chrome.permissions.contains);
    for (const area of [chrome.storage.local, chrome.storage.sync, chrome.storage.session]) {
      for (const fn of [area.get, area.set, area.remove]) expect(firstCall(fn)).toBeGreaterThan(permissionCheck);
    }
  });

  it('changes nothing when the prompt is declined', async () => {
    chrome.permissions.contains.mockResolvedValue(false);
    chrome.permissions.request.mockResolvedValue(false);
    await expect(requestLogin('http://nas.lan:3000')).resolves.toEqual({
      ok: false,
      error: 'Not logged in — access to that address was declined.',
    });
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('turns away an address that is not http(s) without prompting', async () => {
    const result = await requestLogin('nas.lan:3000');
    expect(result).toEqual({ ok: false, error: 'Enter the server address, starting with http:// or https://' });
    expect(chrome.permissions.request).not.toHaveBeenCalled();
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });

  it('returns the background’s error and drops the copy kept for the next popup', async () => {
    chrome.storage.session.data.lastAuthError = 'Login cancelled.';
    chrome.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'Login cancelled.' });
    await expect(requestLogin('http://nas.lan:3000')).resolves.toEqual({ ok: false, error: 'Login cancelled.' });
    expect(chrome.storage.session.data.lastAuthError).toBeUndefined();
  });

  it('treats a missing reply as a failed login', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(undefined);
    await expect(requestLogin('http://nas.lan:3000')).resolves.toEqual({ ok: false, error: 'Login failed.' });
  });
});
