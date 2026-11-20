import { expect, it } from 'vitest';
import { readPublicPage } from './publicPage.js';

it('passes only the checked address to the connection and blocks a private redirect', async () => {
  const connected: { url: string; address: string }[] = [];
  const result = await readPublicPage('https://recipes.example.com/meal', {
    resolve: async (hostname) => hostname === 'recipes.example.com'
      ? [{ address: '93.184.216.34', family: 4 }]
      : [{ address: '93.184.216.34', family: 4 }, { address: '192.168.1.8', family: 4 }],
    request: async (url, address) => {
      connected.push({ url: url.href, address: address.address });
      return new Response(null, { status: 302, headers: { location: 'https://redirect.example.com/card' } });
    },
  });

  expect(result).toEqual({ status: null, error: 'blocked', html: null, url: 'https://redirect.example.com/card' });
  expect(connected).toEqual([{ url: 'https://recipes.example.com/meal', address: '93.184.216.34' }]);
});

it('revalidates each public HTTPS redirect and returns its final HTML', async () => {
  const addresses = ['93.184.216.34', '93.184.216.35'];
  const connected: string[] = [];
  const result = await readPublicPage('https://recipes.example.com/meal', {
    resolve: async (host) => [{ address: host.startsWith('recipes') ? addresses[0]! : addresses[1]!, family: 4 }],
    request: async (url, address) => {
      connected.push(address.address);
      return url.hostname.startsWith('recipes')
        ? new Response(null, { status: 301, headers: { location: 'https://cooking.example.com/card' } })
        : new Response('<p>Recipe</p>', { headers: { 'content-type': 'text/html' } });
    },
  });

  expect(connected).toEqual(addresses);
  expect(result).toEqual({ status: 200, error: null, html: '<p>Recipe</p>', url: 'https://cooking.example.com/card' });
});
