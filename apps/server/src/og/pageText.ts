/** The most text kept per page: enough to search a long article, small enough to store thousands. */
export const MAX_TEXT = 100_000;

// Elements whose content is never the page's text.
const DROP = ['script', 'style', 'noscript', 'svg', 'template', 'iframe', 'canvas', 'head', 'nav', 'header', 'footer', 'aside', 'form', 'button', 'select'];
const DROP_RE = new RegExp(`<(${DROP.join('|')})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, 'gi');
const BLOCK_RE = /<\/?(p|div|section|article|main|li|ul|ol|h[1-6]|br|tr|td|th|table|blockquote|pre|dd|dt|figcaption)\b[^>]*>/gi;
// Inside a sentence: gone without a trace, so "an <em>owner</em>." stays "an owner.".
const INLINE_RE = /<\/?(a|em|strong|b|i|u|s|span|code|mark|small|sub|sup|abbr|cite|q|time|kbd|var|del|ins)\b[^>]*>/gi;

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™', middot: '·',
};

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    }
    return NAMED[ref.toLowerCase()] ?? whole;
  });
}

function toText(html: string): string {
  return decode(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(DROP_RE, ' ')
      .replace(BLOCK_RE, '\n')
      .replace(INLINE_RE, '')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** The inside of the first `<tag …>…</tag>`, if the page has one. */
function inner(html: string, tag: string): string | null {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*)<\\/${tag}\\s*>`, 'i').exec(html);
  return m ? m[1]! : null;
}

/**
 * A page's readable text: its article or main content when it marks one out
 * and that holds real text, else its body, without scripts, navigation and
 * other chrome. Null when there is no text at all.
 */
export function pageText(html: string): string | null {
  const body = inner(html, 'body') ?? html;
  // Postgres text cannot hold NUL.
  let text = toText(body.replace(/\u0000/g, ''));
  for (const tag of ['article', 'main']) {
    const part = inner(body, tag);
    const partText = part ? toText(part) : '';
    // A teaser <article> in a list page is not the page; the whole body is.
    if (partText.length >= 500 || partText.length >= text.length * 0.5) {
      text = partText;
      break;
    }
  }
  if (text === '') return null;
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
}
