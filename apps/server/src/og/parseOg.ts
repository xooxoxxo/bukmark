const META_RE = /<meta\s[^>]*>/gi;

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? (m[2] ?? m[3]) : undefined;
}

function resolve(content: string, pageUrl: string): string | null {
  try {
    const abs = new URL(content, pageUrl);
    if (abs.host === '') return null;
    return abs.toString();
  } catch {
    return null;
  }
}

export function parseOgImage(html: string, pageUrl: string): string | null {
  let twitterFallback: string | null = null;
  for (const tag of html.match(META_RE) ?? []) {
    const key = (attr(tag, 'property') ?? attr(tag, 'name'))?.toLowerCase();
    const content = attr(tag, 'content');
    if (!key || !content) continue;
    if (key === 'og:image' || key === 'og:image:url') {
      const abs = resolve(content, pageUrl);
      if (abs) return abs;
    }
    if (key === 'twitter:image' && twitterFallback === null) {
      twitterFallback = resolve(content, pageUrl);
    }
  }
  return twitterFallback;
}
