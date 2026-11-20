import { expect, it } from 'vitest';
import { discussionSource } from './discussion.js';
import { localSiftInput } from './evidence.js';
import { localSiftResult, localSiftRules } from './historyModel.js';

const input=(url:string,title='AI model training guide')=>({url,title,status:'active' as const});

it.each([
  'https://community.example.org/t/prompt-tips/123/2',
  'https://community.example.org/t/prompt-tips/123/10',
  'https://forum.example.org/t/123/2',
  'https://meta.discourse.org/t/guide/123/2',
  'https://forum.example.org/viewtopic.php?t=123&p=456',
  'https://forum.example.org/ubbthreads.php/topics/123/guide.html#Post456',
])('classifies a reply before teaching words without changing its address: %s',url=>{
  const row=input(url);expect(discussionSource(row)?.kind).toBe('reply');
  expect(localSiftResult(row).bin).toEqual({name:'Discussions and answers',ruleId:'discussion',ruleVersion:2,
    reason:'An explicit forum reply is discussion context. Retain its exact reply address.',fields:['url']});
  expect(localSiftInput({...row,httpStatus:200,contentText:'This article explains model training.'})).toEqual(row);
});

it.each([
  'https://community.example.org/t/general-topic/123',
  'https://community.example.org/t/123',
  'https://forum.example.org/ubbthreads.php/topics/123/release.html',
  'https://forum.example.org/viewtopic.php?t=123',
])('recognizes an ordinary topic without inferring a technical reference: %s',url=>{
  expect(localSiftResult(input(url,'A new release is out')).bin?.name).toBe('Discussions and answers');
});

it.each([
  'https://community.example.org/t/guide/123',
  'https://community.example.org/t/guide/123/1',
])('keeps a primary tutorial eligible for the reference rules: %s',url=>{
  expect(discussionSource(input(url))).toBeNull();
  expect(localSiftResult(input(url)).bin?.name).toBe('Technical reference');
});

it('does not exempt a root question just because it mentions a guide',()=>{
  expect(localSiftResult(input('https://community.example.org/t/guide/123','Which AI training guide should I use?')).bin?.name).toBe('Discussions and answers');
});

it('holds unresolved forum containers rather than inferring reference intent from their titles',()=>{
  for(const url of ['https://community.example.org/t/guide/0/2','https://community.example.org/u/person','https://community.example.org/c/announcements']){
    expect(localSiftResult(input(url)).bin?.name).toBe('Needs review');
  }
  expect(localSiftResult(input('https://community.example.org/docs/ai-guide')).bin?.name).toBe('Technical reference');
});

it.each([
  'https://community.example.org/t/guide/0/2',
  'https://community.example.org/t/guide/123/0',
  'https://community.example.org/t/guide/123/abc',
  'https://community.example.org/t/guide/not-an-id',
  'https://community.example.org/docs/123/2',
  'https://community.example.org/u/person',
  'https://community.example.org/c/announcements',
  'https://example.org/t/guide/123/2',
  'https://forum.example.org/viewtopic.php?t=0',
])('does not infer a forum source from malformed or unrelated paths: %s',url=>{
  expect(discussionSource(input(url))).toBeNull();
});

it.each([
  'https://stackoverflow.com/questions/123/example',
  'https://softwareengineering.stackexchange.com/questions/123/example',
  'https://digitalocean.com/community/questions/configuration-question',
])('recognizes a Q&A question independently of tutorial wording: %s',url=>{
  expect(discussionSource(input(url))?.kind).toBe('question');
  expect(localSiftResult(input(url)).bin?.name).toBe('Discussions and answers');
});

it('keeps source checks, repository context and standalone tutorial routes ahead of generic forum handling',()=>{
  expect(localSiftResult(input('https://community.example.org/t/topic/123/2','Just a moment...')).bin?.name).toBe('Check source');
  expect(localSiftResult(input('https://github.com/org/repo/blob/main/guide.md')).bin?.name).toBe('Repo code and examples');
  expect(localSiftResult(input('https://digitalocean.com/community/tutorials/ai-training-guide')).bin?.name).toBe('Technical reference');
});

it('retains the discussion source artifact and conservative rule scope in bundle evidence',async()=>{
  const rules=await localSiftRules();expect(rules.version).toBe('local-seven-bin-v5');
  expect(rules.artifacts.map(r=>r.path)).toContain('./discussion.ts');
  expect(rules.binRules?.find(r=>r.id==='discussion')).toMatchObject({version:2,scope:'all',consumes:['url','title']});
});
