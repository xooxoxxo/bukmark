import { expect, it } from 'vitest';
import { localSiftResult, localSiftRules } from './historyModel.js';
import { localSiftInput } from './evidence.js';

const source=(url:string,title:string,pageText?:string)=>({url,title,status:'active' as const,pageText});
it.each([
  ['https://w3schools.com/howto/howto_css_responsive_header.asp','How To Create a Responsive Header'],
  ['https://example.org/guide/midi-over-trs','A guide to MIDI over TRS minijacks'],
  ['https://example.org/','MicroPython tips'],
  ['https://example.org/python/resources','10 GitHub Repositories to Master Python'],
  ['https://example.org/gatsby-vs-next/','Gatsby vs Next'],
  ['https://example.org/react-vs-vue/','React versus Vue'],
  ['https://d3js.org/d3-brush','d3-brush | D3 by Observable'],
])('recognizes reference intent with a technical subject: %s', (url,title)=>{
  expect(localSiftResult(source(url,title)).bin).toMatchObject({name:'Technical reference',ruleId:'technical-reference',ruleVersion:4,fields:['url','title']});
});

it.each([
  ['https://example.org/fashion/','A guide to midi skirts'],
  ['https://example.org/books/','The Great Gatsby study guide'],
  ['https://example.org/headphones/','Headphones comparison'],
  ['https://example.org/python-books/','Python book buying guide'],
  ['https://d3js.org/','D3'],
  ['https://github.com/example/python-tutorial','A Python tutorial'],
  ['https://npmjs.com/package/python-helper','Python guide'],
])('does not confuse subject words, shopping or catalog roots with technical reference: %s',(url,title)=>{
  expect(localSiftResult(source(url,title)).bin?.name).not.toBe('Technical reference');
});

it('uses bounded explanation text for an architecture concept without turning product descriptions into teaching',()=>{
  expect(localSiftResult(source('https://example.org/','Jamstack','Jamstack is an architectural approach that separates content and rendering.')).bin)
    .toEqual({name:'Technical reference',ruleId:'technical-reference',ruleVersion:4,
      reason:'Bounded homepage text explains a technical architecture or protocol concept.',fields:['url','title','pageText']});
  expect(localSiftResult(source('https://example.org/','React Native Paper','React Native Paper is a high-quality library. Read our docs.')).bin?.name).toBe('Needs review');
});

it('uses successful bounded article evidence for instructional intent and ignores a failed cached check',()=>{
  const row={url:'https://example.org/css-layout',title:'CSS layout details',status:'active' as const,
    contentText:'This article explains how grid tracks are sized.',httpStatus:200,checkError:null};
  expect(localSiftResult(localSiftInput(row)).bin).toMatchObject({name:'Technical reference',fields:['url','title','pageText']});
  expect(localSiftResult(localSiftInput({...row,checkError:'timeout'})).bin?.name).toBe('Needs review');
  expect(localSiftResult(localSiftInput({...row,contentText:'x'.repeat(4096)+' This article explains CSS sizing.'})).bin?.name).toBe('Needs review');
});

it('retains source checks, listing/context precedence and separate route review',()=>{
  expect(localSiftResult(source('https://example.org/css-guide','Just a moment...','This article explains CSS.')).bin?.name).toBe('Check source');
  expect(localSiftResult(source('https://github.com/org/repo/blob/main/css-guide.md','CSS Guide')).bin?.name).toBe('Repo code and examples');
  expect(localSiftResult(source('https://github.com/org/repo/issues/1','CSS Guide')).bin?.name).toBe('Discussions and answers');
  expect(localSiftResult(source('https://amazon.de/dp/B000000001','CSS Guide')).bin?.name).toBe('Price-watch review');
});

it('versions the executable reference dependencies in saved-run rule evidence',async()=>{
  const rules=await localSiftRules();expect(rules.version).toBe('local-seven-bin-v5');
  expect(rules.artifacts.map(r=>r.path)).toContain('./technical.ts');
});
