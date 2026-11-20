interface DiscussionInput { url: string; title: string }
export interface DiscussionSource {
  kind: 'reply' | 'topic' | 'question';
  reason: string;
  fields: ('url' | 'title')[];
}

const QA_HOSTS = new Set(['stackoverflow.com', 'superuser.com', 'serverfault.com', 'askubuntu.com']);
const positiveId = (value: string | null | undefined) => typeof value === 'string' && /^[1-9]\d{0,11}$/.test(value);
const forumHost = (host: string) => /^(?:forum|forums|community|discuss|discourse)\./.test(host) || host === 'meta.discourse.org';
const reply = (): DiscussionSource => ({kind:'reply',reason:'An explicit forum reply is discussion context. Retain its exact reply address.',fields:['url']});
const question = (): DiscussionSource => ({kind:'question',reason:'A Q&A question address identifies discussion context.',fields:['url']});

function primaryTutorial(title: string): boolean {
  return /\b(?:tutorial|walkthrough|guide)\b/i.test(title)
    && !/\?|^(?:how (?:do|can|should)|why|what|which|can i|help\b)|\b(?:not working|need help|doesn.t work)\b/i.test(title);
}
function topic(title: string): DiscussionSource | null {
  return primaryTutorial(title) ? null : {kind:'topic',reason:'A forum topic address identifies discussion context.',fields:['url','title']};
}

function discourseAddress(path: string): {topicId: string; post?: string} | null {
  const parts=path.split('/').filter(Boolean);
  if(parts[0]!=='t')return null;
  const tail=parts.slice(1);let topicId:string|undefined,post:string|undefined;
  if(positiveId(tail[0])&&tail.length<=2)[topicId,post]=tail;
  else if(tail.length>=2&&tail.length<=3)[,topicId,post]=tail;
  else return null;
  return positiveId(topicId)&&(post===undefined||positiveId(post))?{topicId:topicId!,post}:null;
}

/** Source typing only: no read, URL rewrite, parent-repository inference or route approval. */
export function discussionSource(input: DiscussionInput): DiscussionSource | null {
  const url = URL.parse(input.url);
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  const host = url.hostname.replace(/^www\./, '');
  if (QA_HOSTS.has(host) || host.endsWith('.stackexchange.com')) {
    return /^\/questions\/[1-9]\d*(?:\/|$)/.test(url.pathname) ? question() : null;
  }
  if (host === 'digitalocean.com' && /^\/community\/questions\/[^/]+\/?$/.test(url.pathname)) return question();
  if (!forumHost(host) || /%2f|%5c/i.test(url.pathname)) return null;
  let path: string;
  try { path = decodeURIComponent(url.pathname); } catch { return null; }
  const address=discourseAddress(path);
  if (address) {
    return address.post !== undefined && Number(address.post) >= 2 ? reply() : topic(input.title);
  }
  if (/^\/ubbthreads\.php\/topics\/[1-9]\d*(?:\/|$)/.test(path)) {
    return /^#(?:post|comment)-?[1-9]\d*$/i.test(url.hash) ? reply() : topic(input.title);
  }
  if (/\/(?:viewtopic|showthread)\.php$/.test(path)) {
    if (positiveId(url.searchParams.get('p'))) return reply();
    if (positiveId(url.searchParams.get('t'))) return topic(input.title);
  }
  return null;
}

/** Unknown forum containers must not acquire a reference type from teaching words alone. */
export function forumReferenceHeld(input: DiscussionInput): boolean {
  const url=URL.parse(input.url);if(!url||!forumHost(url.hostname.replace(/^www\./,'')))return false;
  if(/%2f|%5c/i.test(url.pathname))return true;
  let path:string;try{path=decodeURIComponent(url.pathname);}catch{return true;}
  if(/^\/(?:docs?|documentation|tutorials?|guides?)(?:\/|$)/i.test(path))return false;
  if(discussionSource(input))return false;
  const address=discourseAddress(path);
  if(address&&(address.post===undefined||Number(address.post)===1)&&primaryTutorial(input.title))return false;
  if(primaryTutorial(input.title)&&(/^\/ubbthreads\.php\/topics\/[1-9]\d*(?:\/|$)/.test(path)
    || (/\/(?:viewtopic|showthread)\.php$/.test(path)&&positiveId(url.searchParams.get('t')))))return false;
  return true;
}
