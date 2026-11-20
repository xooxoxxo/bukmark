interface ReferenceInput { url: string; title: string; pageText?: string }
interface ReferenceSignal { reason: string; fields: ('url' | 'title' | 'pageText')[] }

// Path separators must not hide subjects such as howto_css or midi-over-trs.
function words(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function metadata(input: Pick<ReferenceInput, 'url' | 'title'>) {
  const url = URL.parse(input.url);
  let path = url?.pathname ?? '';
  try { path = decodeURIComponent(path); } catch { path = ''; }
  return { url, host: url?.hostname.replace(/^www\./, '') ?? '', path, text: words(`${path} ${input.title}`) };
}

const SUBJECT = /\b(?:api|programming|code|typescript|javascript|micropython|python|rust|linux|react|docker|css|html|sql|git|vscode|vs code|d3|nextjs|next js|vue|svelte|angular|jamstack|revalidation|microcontrollers?|arduino)\b/;
const LEARNING = /\b(?:guide|reference|manual|tutorials?|hacks?|tips|how ?to|learn(?:ing)?|introduction|examples?|master|understanding|explained|implementation)\b/;
const COMPARISON = /\b(?:vs|versus|comparison|compare)\b/;
const PURCHASE = /\b(?:buy(?:ing)?|prices?|shopping|deals?|sale)\b/;

function aiSubject(text: string): boolean {
  if (/\b(?:artificial intelligence|machine learning|deep learning|neural networks?|(?:large )?language models?|generative ai|prompt engineering|openai|chatgpt)\b/.test(text)) return true;
  if (/\b(?:degree|master of laws|law school|llb)\b/.test(text)) return false;
  return /\b(?:ai|ml|llms?)\b/.test(text)
    && /\b(?:models?|training|inference|prompts?|neural|python|datasets?|tokens?|transformers?|embeddings?)\b/.test(text);
}

function languageEdition(text: string): boolean {
  const explicit = /\b(?:ecmascript|ecma script)\b/.test(text);
  const tag = /\b(?:esnext|es[5-9]|es20(?:1[5-9]|[2-9][0-9]))\b/.test(text);
  const physicalModel = /\b(?:headphones?|radios?|receivers?|speakers?|cameras?|guitars?|vehicles?|synthesizers?)\b/.test(text);
  return explicit || (tag && (!physicalModel || /\bjavascript\b/.test(text)));
}

function technicalSubject(text: string): boolean {
  const frameworkPair = /\bgatsby\b.*\bnext(?: js)?\b|\bnext(?: js)?\b.*\bgatsby\b/.test(text)
    && !/\b(?:novel|literature|fitzgerald)\b/.test(text);
  const midiProtocol = /\bmidi\b/.test(text) && /\b(?:trs|protocol|connectors?|cables?|synthesizers?|audio|minijacks?)\b/.test(text);
  return SUBJECT.test(text) || frameworkPair || midiProtocol || aiSubject(text) || languageEdition(text);
}

/** Bounds eligibility for existing local text; it does not fetch or establish a public source. */
export function technicalTextCandidate(url: string, title: string): boolean {
  const m = metadata({ url, title });
  if (m.host === 'github.com' || m.host === 'npmjs.com') return false;
  return technicalSubject(m.text);
}

export function technicalReference(input: ReferenceInput): ReferenceSignal | null {
  const m = metadata(input);
  // Repository roots and packages need catalog review; selected context has its own prior rules.
  if (m.host === 'github.com' || m.host === 'npmjs.com') return null;
  if (/^(?:docs?|developer)\./i.test(m.host) || /\/(?:docs?|documentation|tutorials?)(?:\/|$)/i.test(m.path)) {
    return { reason: 'A documentation or tutorial source is identified by its address.', fields: ['url', 'title'] };
  }
  if (m.host === 'd3js.org' && /^\/d3-[a-z0-9-]+(?:\/|$)/.test(m.path)) {
    return { reason: 'An upstream D3 module reference is identified by its API path.', fields: ['url', 'title'] };
  }
  if (!technicalSubject(m.text) || PURCHASE.test(words(input.title))
    || (aiSubject(m.text) && /\b(?:pricing|plans?|subscriptions?)\b/.test(words(input.title)))) return null;
  if (languageEdition(m.text) && /\b(?:everything you need to know|what s new|features?|overview|specification|changes)\b/.test(m.text)) {
    return { reason: 'An ECMAScript edition is paired with a feature overview or language-reference cue.', fields: ['url', 'title'] };
  }
  // The subject phrase itself is not evidence that a product page teaches anything.
  const intentText = m.text.replace(/\b(?:machine|deep|reinforcement|transfer) learning\b/g, ' ');
  if (LEARNING.test(intentText) || COMPARISON.test(m.text)) {
    return { reason: 'A technical subject is paired with learning, reference or comparison intent.', fields: ['url', 'title'] };
  }
  // An explanation of a concept is distinct from a product's navigation or sales copy.
  const text = input.pageText?.slice(0, 4096) ?? '';
  if (m.url?.pathname !== '/' && /\b(?:this (?:article|tutorial|guide|example) (?:explains?|shows?|covers?|walks)|in this (?:tutorial|guide)|you (?:will|can) learn|step.by.step)\b/i.test(text)) {
    return { reason: 'Bounded article text supplies instructional intent for the technical subject.', fields: ['url', 'title', 'pageText'] };
  }
  if (m.url?.pathname === '/' && /\b(?:is|refers to)\s+an?\s+(?:[a-z-]+\s+){0,2}(?:architectural approach|architecture|network protocol)\b/i.test(text)) {
    return { reason: 'Bounded homepage text explains a technical architecture or protocol concept.', fields: ['url', 'title', 'pageText'] };
  }
  return null;
}
