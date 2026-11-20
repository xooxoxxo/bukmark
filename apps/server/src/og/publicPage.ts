import { lookup } from 'node:dns/promises';
import { get } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { fetchPage, type PageError } from './fetchHead.js';
import { isPrivateIp } from './ssrfGuard.js';

const PAGE_BYTES = 2 * 1024 * 1024;
const DEADLINE_MS = 12_000;
type Address = { address: string; family: number };

interface PublicPageNetwork {
  resolve(hostname: string): Promise<Address[]>;
  request(url: URL, address: Address, signal: AbortSignal): Promise<Response>;
}

function pinnedRequest(url: URL, address: Address, signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    get(url, {
      agent: false,
      signal,
      family: address.family,
      lookup: (_host, _options, done) => done(null, address.address, address.family),
      headers: {
        accept: 'text/html, application/xhtml+xml',
        'accept-encoding': 'identity',
        'user-agent': 'Mozilla/5.0 (compatible; bukmark/1.0; +https://bukmark.it)',
      },
    }, (response) => {
      const status = response.statusCode;
      if (!status || status < 200 || status > 599) {
        response.destroy();
        reject(new Error('Invalid HTTP status'));
        return;
      }
      const body = status === 204 || status === 205 || status === 304 ? null : Readable.toWeb(response);
      if (!body) response.resume();
      const headers = new Headers();
      for (const name of ['location', 'content-type']) {
        const value = response.headers[name];
        if (typeof value === 'string') headers.set(name, value);
      }
      resolve(new Response(body as ReadableStream<Uint8Array> | null, { status, headers }));
    }).once('error', reject);
  });
}

const network: PublicPageNetwork = {
  resolve: (hostname) => lookup(hostname, { all: true }),
  request: pinnedRequest,
};

function isPublicAddress({ address, family }: Address) {
  if (family === 4) return isIP(address) === 4 && !isPrivateIp(address);
  // Accept only global unicast. Keep transition prefixes out of this reader.
  return family === 6 && isIP(address) === 6 && /^[23]/.test(address)
    && !/^2002:|^2001:(?:0?:|db8:)/i.test(address);
}

async function checkedAddresses(hostname: string, signal: AbortSignal, transport: PublicPageNetwork): Promise<Address[] | PageError> {
  let onAbort: (() => void) | undefined;
  try {
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    const addresses = await Promise.race([transport.resolve(hostname), aborted]);
    if (!addresses.length) return 'dns';
    return addresses.every(isPublicAddress) ? addresses : 'blocked';
  } catch (error) {
    if (signal.aborted) throw error;
    const code = (error as { code?: string }).code;
    return code === 'ENOTFOUND' || code === 'ENODATA' ? 'dns' : 'network';
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

export function readPublicPage(rawUrl: string, transport: PublicPageNetwork = network) {
  return fetchPage(rawUrl, PAGE_BYTES, async (url, signal) => {
    if (url.protocol !== 'https:' || url.username || url.password || url.port || Buffer.byteLength(url.href) > 1800
      || isIP(url.hostname.replace(/^\[|\]$/g, '')) || !url.hostname.includes('.')) return 'blocked';
    const addresses = await checkedAddresses(url.hostname, signal, transport);
    if (typeof addresses === 'string') return addresses;
    signal.throwIfAborted();
    return transport.request(url, addresses.find(({ family }) => family === 4) ?? addresses[0]!, signal);
  }, AbortSignal.timeout(DEADLINE_MS));
}
