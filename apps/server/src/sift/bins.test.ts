import { describe, expect, it } from 'vitest';
import { affectedByBinRuleChange, BIN_RULES, suggestBin } from './bins.js';
import { localSiftResult, localSiftRules } from './historyModel.js';

describe('seven-bin suggestions from stored metadata', () => {
  it.each([
    ['https://www.thomann.de/intl/akai_mpc_one.htm', 'Akai MPC One', 'Price-watch review'],
    ['https://amazon.de/dp/B000000001?tag=sample', 'Instrument', 'Price-watch review'],
    ['https://amazon.de/s?k=synth', 'Synth search', 'Needs review'],
    ['https://pluginboutique.com/product/1-Bundles/2-Instruments/3-Synth-Bundle', 'Synth bundle', 'Price-watch review'],
    ['https://pluginboutique.com/product/1-Bundles', 'Bundles', 'Buying research'],
    ['https://mod.audio/dwarf/', 'MOD Dwarf', 'Buying research'],
    ['https://example.org/reviews/headphones', 'Headphones review', 'Buying research'],
    ['https://example.org/reviews/code', 'A code review', 'Needs review'],
    ['https://github.com/shadcn-ui/ui/blob/main/apps/www/components/example.tsx#L10', 'Example', 'Repo code and examples'],
    ['https://github.com/withastro/astro/tree/latest/examples', 'Examples', 'Repo code and examples'],
    ['https://github.com/shadcn-ui/ui/issues/120', 'Docs product question', 'Discussions and answers'],
    ['https://github.com/org/repo/discussions/42', 'Discussion', 'Discussions and answers'],
    ['https://stackoverflow.com/questions/12345/example', 'CSS question', 'Discussions and answers'],
    ['https://github.com/shadcn-ui/ui', 'shadcn/ui', 'Needs review'],
    ['https://www.npmjs.com/package/@hookform/resolvers', 'Resolvers', 'Needs review'],
    ['https://docs.volta.sh/advanced/workspaces', 'Workspaces', 'Technical reference'],
    ['https://docs.rust-lang.org/book/ch09-00-error-handling.html', 'Error Handling - The Rust Programming Language', 'Technical reference'],
    ['https://example.org/docs/products/price', 'Shopping API', 'Technical reference'],
    ['https://example.org/articles/css', 'A CSS guide', 'Technical reference'],
    ['https://example.org/news/vscode', 'VS Code hacks to improve productivity', 'Technical reference'],
    ['https://example.org/articles/fashion', 'A style guide', 'Needs review'],
    ['https://example.org/recipes/porridge', 'Porridge recipe', 'Needs review'],
    ['https://en.wikipedia.org/wiki/Microgrid', 'Microgrid', 'Needs review'],
    ['https://github.com/', 'GitHub', 'Needs review'],
    ['https://example.org/docs/x', 'Just a moment...', 'Check source'],
    ['https://example.org/docs/x', '', 'Check source'],
    ['https://user:secret@example.org/docs/x', 'Documentation', 'Check source'],
    ['https://example.org/account/docs/x', 'Documentation', 'Check source'],
    ['https://127.0.0.1/docs/x', 'Documentation', 'Check source'],
    ['file:///etc/passwd', 'Documentation', 'Check source'],
  ])('%s → %s (%s)', (url, title, expected) => {
    expect(suggestBin({ url, title })).toMatchObject({ name: expected });
  });

  it('keeps a bin, disposition, handoff and owner intent separate', () => {
    const input = { url: 'https://mod.audio/dwarf/', title: 'MOD Dwarf', status: 'active' as const };
    expect(localSiftResult(input)).toMatchObject({ disposition: 'needs_review', handoff: 'none',
      bin: { name: 'Buying research', ruleId: 'buying-research', fields: ['url', 'title'] } });
    expect(localSiftResult({ ...input, appearances: 999 })).toEqual(localSiftResult(input));
    expect(localSiftResult({ ...input, status: 'archived' }).disposition).toBe('archived');
  });

  it('records the executable bin artifact and ordered rule manifest in a new bundle version', async () => {
    const rules = await localSiftRules();
    expect(rules.version).toBe('local-seven-bin-v5');
    expect(rules.artifacts.some(x => x.path === './bins.ts' && x.source.includes('suggestBin'))).toBe(true);
    expect(rules.binRules).toEqual(BIN_RULES);
    expect(rules.digest).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('conservative affected scopes', () => {
  const github = { url: 'https://github.com/org/repo/issues/1', title: 'Question' };
  const docs = { url: 'https://docs.example.org/api', title: 'Docs' };
  it('includes other GitHub winners when the code rule changes, without rescanning unrelated docs', () => {
    const changed = BIN_RULES.map(rule => rule.id === 'repo-code' ? { ...rule, version: 2 } : rule);
    expect(affectedByBinRuleChange(github, BIN_RULES, changed)).toBe(true);
    expect(affectedByBinRuleChange(docs, BIN_RULES, changed)).toBe(false);
    expect(affectedByBinRuleChange(github, BIN_RULES, BIN_RULES)).toBe(false);
  });
  it('expands additions, removals and reordering to the full selected scope', () => {
    for (const changed of [[...BIN_RULES].reverse(), BIN_RULES.slice(1), [...BIN_RULES, { ...BIN_RULES[0]!, id: 'new-rule' }]]) {
      expect(affectedByBinRuleChange(docs, BIN_RULES, changed)).toBe(true);
    }
  });
  it('uses both old and new scopes when a rule widens, and treats title rules as full-scope', () => {
    const widened = BIN_RULES.map(rule => rule.id === 'repo-code' ? { ...rule, scope: 'all' as const } : rule);
    expect(affectedByBinRuleChange(docs, BIN_RULES, widened)).toBe(true);
    const titleChange = BIN_RULES.map(rule => rule.id === 'technical-reference' ? { ...rule, version: 5 } : rule);
    expect(affectedByBinRuleChange(github, BIN_RULES, titleChange)).toBe(true);
  });
  it('includes removed hosts and falls back to a full scan for missing historical bounds', () => {
    const after=BIN_RULES.map(r=>r.id==='discussion'?{...r,scope:'discussion' as const,hosts:['github.com'],version:2}:r);
    const old=after.map(r=>r.id==='discussion'?{...r,hosts:[...r.hosts!,'old-answers.example.org'],version:1}:r);
    const removed={url:'https://old-answers.example.org/questions/1',title:'Question'};
    expect(affectedByBinRuleChange(removed,old,after)).toBe(true);
    const unbounded=BIN_RULES.map(r=>r.id==='repo-code'?{...r,hosts:undefined,version:0}:r);
    expect(affectedByBinRuleChange(docs,unbounded,BIN_RULES)).toBe(true);
  });
});
