import { fetchHead } from './fetchHead.js';
import { parseOgImage } from './parseOg.js';

export async function fetchOgImage(url: string): Promise<string | null> {
  const html = await fetchHead(url);
  return html ? parseOgImage(html, url) : null;
}
