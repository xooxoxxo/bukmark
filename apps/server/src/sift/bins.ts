import type { SiftBin, SiftBinSuggestion } from '@bukmark/shared';
import { builderSource } from '../builder/model.js';
import { productListing } from '../review/model.js';
import type { SiftBookmark } from './model.js';
import { boundedPageText, itchProject, usesPageText } from './evidence.js';
import { technicalReference } from './technical.js';
import { discussionSource, forumReferenceHeld } from './discussion.js';

export const BIN_RULES_VERSION = 'local-seven-bin-v5';
type Scope = 'all' | 'github' | 'discussion';
export interface BinRuleDefinition {
  id: string;
  version: number;
  bin: SiftBin;
  consumes: ('url' | 'title' | 'pageText')[];
  scope: Scope;
  /** Persist the bound so a later implementation can include hosts removed from a rule. */
  hosts?: readonly string[];
}
/** Order is precedence. Scopes are conservative re-evaluation bounds, not match predicates. */
export const BIN_RULES: readonly BinRuleDefinition[] = [
  { id: 'source-check', version: 1, bin: 'Check source', consumes: ['url', 'title'], scope: 'all' },
  { id: 'exact-listing', version: 2, bin: 'Price-watch review', consumes: ['url', 'pageText'], scope: 'all' },
  { id: 'repo-code', version: 1, bin: 'Repo code and examples', consumes: ['url'], scope: 'github', hosts: ['github.com'] },
  { id: 'discussion', version: 2, bin: 'Discussions and answers', consumes: ['url', 'title'], scope: 'all' },
  { id: 'technical-reference', version: 4, bin: 'Technical reference', consumes: ['url', 'title', 'pageText'], scope: 'all' },
  { id: 'buying-research', version: 2, bin: 'Buying research', consumes: ['url', 'title', 'pageText'], scope: 'all' },
  { id: 'fallback', version: 5, bin: 'Needs review', consumes: ['url', 'title', 'pageText'], scope: 'all' },
];

const PRIVATE_PATH = /(?:^|\/)(?:account|auth|dashboard|inbox|login|mail|oauth|private|reset|settings|sign-in|token)(?:\/|$)/i;
const BUYING_ITEMS = /\b(?:price|buy|buying|shopping|headphones?|speakers?|microphones?|synth(?:esizer)?s?|guitars?|laptops?|monitors?|cameras?|keyboards?|audio interface|midi|pedals?)\b/i;

function hostOf(url: URL | null): string { return url?.hostname.replace(/^www\./, '') ?? ''; }
function sourceProblem(input: Pick<SiftBookmark, 'url' | 'title'>, url: URL | null): boolean {
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return true;
  const host = hostOf(url);
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || /\.(?:local|localhost|internal|test)$/.test(host)) return true;
  let path: string;
  try { path = decodeURIComponent(url.pathname); } catch { return true; }
  if (PRIVATE_PATH.test(path) || /[\\\x00-\x1f\x7f]/.test(path) || /[^/]+@[^/]+\.[^/]+/.test(path)) return true;
  const title = input.title.trim();
  return !title || /^(?:access denied|forbidden|(?:page )?not found|40[34](?: not found)?|error(?: \d{3})?|just a moment|attention required|(?:sign|log) in(?: to .*)?|untitled)[.!…\s]*(?:[-|].*)?$/i.test(title)
    || /\b(?:captcha|verify (?:you are|you're) human|robot check)\b/i.test(title);
}

/** Stored metadata only. This does not establish public accessibility or authorize a handoff. */
export function suggestBin(input: Pick<SiftBookmark, 'url' | 'title' | 'pageText'>): SiftBinSuggestion {
  const url = URL.parse(input.url);
  const host = hostOf(url);
  const path = url?.pathname ?? '';
  const builder = builderSource(input.url);
  const discussion = discussionSource(input);
  const text = usesPageText(input.url, input.title) ? boundedPageText(input.pageText) : '';
  const buyAt = text.search(/\bbuy now\b/i);
  const price = /(?:[$€£]\s*(\d+(?:[.,]\d{1,2})?)|\b(\d+(?:[.,]\d{1,2})?)\s*(?:USD|EUR|GBP)\b)/gi;
  const nearBuy = buyAt < 0 ? '' : text.slice(Math.max(0, buyAt - 80), buyAt + 160);
  const paidProject = itchProject(input.url) && [...nearBuy.matchAll(price)]
    .some(match => Number((match[1] ?? match[2])!.replace(',', '.')) > 0);
  const productCategory = /\b(?:plugins?|oscillators?|synth(?:esizer)?s?|music software|audio effects|guitar pedals?|headphones?|microphones?|audio interfaces?)\b/i;
  const maker = /\b(?:we (?:design|build|make|create|develop)|(?:designing|building|manufacturing)\b.{0,90}\b(?:software|plugins?|oscillators?|synthesizers?|pedals?)|our (?:[a-z0-9-]+ ){0,2}(?:plugins?|oscillators?|synthesizers?|pedals?|products?)|custom (?:oscillators?|effects|synthesizers?)|manufacturer of)\b/i;
  const manufacturer = url?.pathname === '/' && productCategory.test(`${input.title} ${text}`)
    && !/\b(?:tutorial|how to|reviews?|comparison|roundup|favorites?|recommended)\b/i.test(`${input.title} ${text.slice(0, 160)}`)
    && maker.test(`${input.title} ${text}`);
  const forumHeld=forumReferenceHeld(input);
  const technical = forumHeld?null:technicalReference({ ...input, pageText: text });
  const listing = paidProject || productListing(input.url) !== null
    || (url?.protocol === 'https:' && host === 'pluginboutique.com'
      && /^\/product\/\d+-[^/]+\/\d+-[^/]+\/\d+-[^/]+\/?$/.test(path));
  const buying = manufacturer || /\/(?:products?|shop|buy|store)(?:\/|$)/i.test(path)
    || (host === 'mod.audio' && /^\/dwarf\/?$/.test(path))
    || (/\b(?:reviews?|comparison|compare|versus|vs|best)\b/i.test(`${path} ${input.title}`) && BUYING_ITEMS.test(`${path} ${input.title}`));
  const checks: [boolean, string][] = [
    [sourceProblem(input, url), 'The address or saved title needs verification before choosing a use.'],
    [listing, 'Recognized exact retailer listing; compatibility, buying intent and a price watch still need approval.'],
    [builder?.kind === 'github-context' && builder.page !== 'discussion', 'Repository file or directory; retain its source ref and verify a commit before export.'],
    [(builder?.kind === 'github-context' && builder.page === 'discussion')
      || (builder?.kind === 'repository' && builder.issue !== undefined)
      || discussion !== null, discussion?.reason ?? 'Repository discussion or issue; parent association still needs review.'],
    [technical !== null, technical?.reason ?? 'No technical-reference evidence.'],
    [buying, 'Product information or buying comparison; this is research, not an exact approved listing.'],
    [true, forumHeld?'The forum source type is unresolved; review it before choosing a use.':'No supported bin has enough metadata evidence; review the intended use.'],
  ];
  const index = checks.findIndex(([matches]) => matches);
  const rule = BIN_RULES[index]!;
  const fields = rule.id === 'technical-reference' ? technical!.fields
    : rule.id === 'discussion' ? discussion?.fields ?? ['url'] as ('url' | 'title')[]
      : rule.consumes.filter(field => field !== 'pageText' || Boolean(text));
  const reason = paidProject && rule.id === 'exact-listing'
    ? 'An itch.io project has a buy action and price evidence; tracking compatibility and buying intent still need review.'
    : manufacturer && rule.id === 'buying-research'
      ? 'Homepage text describes first-party product making; keep it as buying research without selecting an item.' : checks[index]![1];
  return { name: rule.bin, ruleId: rule.id, ruleVersion: rule.version, reason, fields };
}

function inScope(input: Pick<SiftBookmark, 'url' | 'title'>, rule: BinRuleDefinition): boolean {
  const host = hostOf(URL.parse(input.url));
  // Missing bounds in a historical manifest are unknown, so scan the full selection.
  return rule.scope === 'all' || !rule.hosts?.length || rule.hosts.includes(host);
}

/** Scan the selected inputs, not just previous winners. Add/remove/reorder falls back to the full selection. */
export function affectedByBinRuleChange(input: Pick<SiftBookmark, 'url' | 'title'>,
  before: readonly BinRuleDefinition[], after: readonly BinRuleDefinition[]): boolean {
  if (before.map(r => r.id).join('|') !== after.map(r => r.id).join('|')) return true;
  return before.some((old, i) => {
    const next = after[i]!;
    const changed = old.version !== next.version || old.bin !== next.bin || old.scope !== next.scope
      || old.consumes.join('|') !== next.consumes.join('|') || old.hosts?.join('|') !== next.hosts?.join('|');
    return changed && (inScope(input, old) || inScope(input, next));
  });
}
