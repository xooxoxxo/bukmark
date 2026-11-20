import { isIP } from 'node:net';
import type { KnowledgeCitation, KnowledgeEvidence, KnowledgeReading } from '@bukmark/shared/review';
import { load } from 'cheerio/slim';
import type { PageFetch } from '../og/fetchHead.js';
import { pageText } from '../og/pageText.js';

const WIKI_HOST = /^[a-z0-9-]+\.wikipedia\.org$/;
const WIKI_VERSION = /^\/wiki\/Special:PermanentLink\/([1-9]\d{0,15})$/;
export type KnowledgePageReader = (url: string) => Promise<PageFetch>;

export function publicCitationUrl(input: string) {
  const url = URL.parse(input);
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.port || input.length > 1800
    || !url.hostname.includes('.') || isIP(url.hostname) || /\.(?:local|localhost|internal)\.?$/i.test(url.hostname)) return null;
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_.+|fbclid|gclid|msclkid)$/i.test(key)) url.searchParams.delete(key);
  }
  return url;
}

export function evidenceText(text: string) {
  return text.replace(/[\u0000\uD800-\uDFFF]/gu, '').replace(/\s+/g, ' ').trim();
}

function metadataText(input: string | undefined) {
  return input ? Array.from(evidenceText(input)).slice(0, 250).join('') || undefined : undefined;
}

function readLicense(href: string | undefined, source: URL) {
  const target = href && URL.parse(href, source);
  const url = target && publicCitationUrl(target.href);
  if (!url) return undefined;
  if (url.hostname === 'creativecommons.org') url.pathname = url.pathname.replace(/\/deed\.[a-z-]+$/i, '/');
  return url.href;
}

export async function readKnowledgeArticle(read: KnowledgePageReader, requested: string) {
  const page = await read(requested);
  const final = publicCitationUrl(page.url);
  if (!page.html || !final) return null;
  const $ = load(page.html);
  const canonical = $('head link[rel="canonical"]').attr('href');
  const wikiUrl = canonical ? publicCitationUrl(canonical) : null;
  const wikipedia = WIKI_HOST.test(final.hostname) && wikiUrl?.origin === final.origin && wikiUrl.pathname.startsWith('/wiki/');
  const wikiContent = wikipedia ? $('#mw-content-text .mw-parser-output').first().html() : null;
  const text = pageText(wikiContent || page.html);
  if (!text) return null;
  const title = metadataText($('h1').first().text()) || metadataText($('title').first().text()) || final.hostname;
  const revisionId = wikipedia ? $('head script').toArray()
    .map((script) => /"wgRevisionId"\s*:\s*([1-9]\d{0,15})\b/.exec($(script).text())?.[1]).find(Boolean) : undefined;
  const url = wikipedia ? wikiUrl.href : final.href;
  const versionUrl = revisionId ? new URL('/wiki/Special:PermanentLink/' + revisionId, final).href : undefined;
  const citation: KnowledgeCitation = {
    url, title, versionUrl, observedOn: new Date().toISOString().slice(0, 10),
    publisher: wikipedia ? 'Wikipedia' : metadataText($('meta[property="og:site_name"]').attr('content')),
    attribution: wikipedia ? 'Wikipedia contributors' : undefined,
    licenseUrl: readLicense($('head link[rel="license"]').attr('href'), final),
  };
  return { citation, text, revisionId };
}

type Article = NonNullable<Awaited<ReturnType<typeof readKnowledgeArticle>>>;

export function knowledgeReading(article: Article): KnowledgeReading {
  const { url, title, versionUrl } = article.citation;
  return { url, title, versionUrl, text: article.text.slice(0, 8000) };
}

export async function captureKnowledgePassage(
  read: KnowledgePageReader, savedUrl: string, excerpt: string, locator?: string, versionUrl?: string,
): Promise<KnowledgeEvidence | 'unavailable' | 'excerpt' | 'version'> {
  const article = await readKnowledgeArticle(read, savedUrl);
  if (!article) return 'unavailable';
  const requested = versionUrl?.trim() || article.citation.versionUrl;
  let verified = article;
  if (requested) {
    const pin = publicCitationUrl(requested);
    const source = new URL(article.citation.url);
    const id = pin && !pin.search && pin.origin === source.origin && WIKI_HOST.test(pin.hostname)
      ? WIKI_VERSION.exec(pin.pathname)?.[1] : undefined;
    if (!id || !pin) return 'version';
    const exact = await readKnowledgeArticle(read, pin.href);
    if (!exact || exact.revisionId !== id || exact.citation.url !== article.citation.url) return 'version';
    verified = exact;
  }
  const text = evidenceText(excerpt);
  if (!text || !evidenceText(verified.text).includes(text)) return 'excerpt';
  return { kind: 'page', citation: { ...verified.citation, locator: locator?.trim() || undefined }, excerpt: text };
}
