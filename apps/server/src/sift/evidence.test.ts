import { describe, expect, it } from 'vitest';
import { localSiftInput, boundedPageText, itchProject } from './evidence.js';
import { localSiftResult } from './historyModel.js';

const source = (overrides: object = {}) => ({ url: 'https://maker.example/', title: 'Example', status: 'active' as const,
  contentText: 'We design synthesizers and audio effects.', httpStatus: 200, checkError: null, ...overrides });

describe('bounded local page evidence', () => {
  it('consumes a successful local check and records its evidence without a handoff approval', () => {
    const input = localSiftInput(source());
    expect(input).toEqual({url:'https://maker.example/',title:'Example',status:'active',pageText:'We design synthesizers and audio effects.'});
    expect(localSiftResult(input)).toEqual({disposition:'shortcut',handoff:'none',
      reason:'Site homepage. Confirm whether it earns a shortcut.',bin:{name:'Buying research',ruleId:'buying-research',ruleVersion:2,
        reason:'Homepage text describes first-party product making; keep it as buying research without selecting an item.',fields:['url','title','pageText']}});
  });
  it.each([
    {httpStatus:404}, {checkError:'timeout'}, {contentText:null}, {contentText:42}, {url:'https://maker.example/article'},
  ])('ignores unavailable or irrelevant cached evidence: %j', overrides => {
    expect(localSiftInput(source(overrides))).not.toHaveProperty('pageText');
  });
  it('normalizes text once and excludes the character after its 4096-character bound', () => {
    expect(boundedPageText('  Hello\0 \n world  ')).toBe('Hello world');
    expect(boundedPageText('a'.repeat(4095)+'xy')).toBe('a'.repeat(4095)+'x');
    expect(localSiftInput(source({contentText:'a'.repeat(4096)+'first'})))
      .toEqual(localSiftInput(source({contentText:'a'.repeat(4096)+'second'})));
  });
});

describe('manufacturer homepages', () => {
  it.each([
    ['Our oscillator plugins work with KORG synthesizers.', 'Buying research'],
    ['Four of our KORG oscillator plugins are now available.', 'Buying research'],
    ['Custom oscillator/effects for Korg Prologue and NTS-1.', 'Buying research'],
    ['Specialists in designing and building innovative music software.', 'Buying research'],
    ['We sell plugins from many manufacturers.', 'Needs review'],
    ['Plugin reviews and news about our plugins of the month.', 'Needs review'],
    ['Our favorite oscillator plugins from other makers.', 'Needs review'],
    ['Welcome to Example.', 'Needs review'],
  ])('%s → %s', (pageText, name) => {
    expect(localSiftResult({...source(),pageText}).bin?.name).toBe(name);
  });
  it('does not treat a non-homepage article as a maker homepage or read beyond the evidence bound', () => {
    expect(localSiftResult({...source(),url:'https://maker.example/news',pageText:'We design synthesizers.'}).bin?.name).toBe('Needs review');
    expect(localSiftResult({...source(),pageText:'a'.repeat(4096)+' We design synthesizers.'}).bin?.name).toBe('Needs review');
  });
});

describe('itch.io paid projects', () => {
  it('recognizes a priced project as review-only while keeping the exact URL and no Azuk approval', () => {
    const input=localSiftInput(source({url:'https://studio.itch.io/example-game',title:'Example Game',contentText:'A downloadable game. Buy Now $12.99 USD or more.'}));
    expect(input.url).toBe('https://studio.itch.io/example-game');
    expect(localSiftResult(input)).toEqual({disposition:'needs_review',handoff:'none',reason:'Metadata gives no clear next use.',
      bin:{name:'Price-watch review',ruleId:'exact-listing',ruleVersion:2,
        reason:'An itch.io project has a buy action and price evidence; tracking compatibility and buying intent still need review.',fields:['url','pageText']}});
  });
  it.each([
    ['https://studio.itch.io/', 'Buy Now $9.99'],
    ['https://itch.io/games', 'Buy Now $9.99'],
    ['https://www.itch.io/games', 'Buy Now $9.99'],
    ['https://studio.itch.io/game/devlog/123', 'Buy Now $9.99'],
    ['https://studio.itch.io/game/download', 'Buy Now $9.99'],
    ['https://studio.itch.io/game', 'Download Now. Name your own price.'],
    ['https://studio.itch.io/game', 'Buy Now $0.00'],
    ['https://studio.itch.io/game', 'Download Now $9.99'],
    ['https://studio.itch.io/game', 'Buy Now. No price published.'],
    ['https://studio.itch.io/game', 'Buy Now '+'.'.repeat(180)+' Another game $9.99'],
  ])('does not infer a priced project from %s (%s)', (url, pageText) => {
    expect(localSiftResult({...source(),url,pageText}).bin?.name).toBe('Needs review');
  });
  it('retains source-check precedence over purchase evidence', () => {
    expect(localSiftResult({...source(),url:'https://studio.itch.io/game',title:'Just a moment...',pageText:'Buy Now $5.00'}).bin?.name).toBe('Check source');
    expect(itchProject('https://studio.itch.io/game/')).toBe(true);
  });
});
