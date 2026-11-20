import { expect, it } from 'vitest';
import { localSiftResult } from './historyModel.js';
import { localSiftInput } from './evidence.js';

const input=(title:string,url='https://example.org/article',pageText?:string)=>({url,title,status:'active' as const,pageText});

it.each([
  'Build Your Own Q&A App with OpenAI: A Beginner’s Guide',
  'I want to learn Artificial Intelligence and Machine Learning. Where can I start?',
  'Deep learning tutorial',
  'Neural network architecture explained',
  'Large language models: a practical guide',
  'LLM inference guide',
  'AI model training tutorial',
  'ML datasets tutorial',
  'Prompt engineering examples',
  'How to use ChatGPT',
])('recognizes educational AI/ML subject context: %s', title=>{
  expect(localSiftResult(input(title)).bin).toMatchObject({name:'Technical reference',ruleId:'technical-reference',ruleVersion:4,fields:['url','title']});
});

it.each([
  ['AI guide','https://example.org/article'],
  ['ML guide','https://example.org/article'],
  ['LLM degree training guide','https://example.org/law'],
  ['A guide to measuring liquid in ml','https://example.org/kitchen'],
  ['A style guide','https://fashion.ai/'],
  ['OpenAI','https://example.org/'],
  ['OpenAI pricing guide','https://example.org/pricing'],
  ['AI model subscription plans explained','https://example.org/'],
  ['AI models','https://example.org/'],
  ['Machine Learning without Code','https://example.org/'],
  ['Machine Learning Platform','https://example.org/'],
  ['Deep Learning Tools','https://example.org/'],
])('does not infer education from ambiguous abbreviations, products or commerce: %s',(title,url)=>{
  expect(localSiftResult(input(title,url,'Read more. Learn more. Our products.')).bin?.name).not.toBe('Technical reference');
});

it.each([
  'ES2020: Everything You Need to Know',
  'What’s New in ES2021',
  'ES2015 features overview',
  'ECMAScript language specification',
  'ESNext changes explained',
  'ES6 guide',
])('recognizes language-edition reference intent: %s',title=>{
  expect(localSiftResult(input(title)).bin?.name).toBe('Technical reference');
});

it.each([
  'ES2014: Everything You Need to Know',
  'ES2020',
  'ES2020 headphones guide',
  'ES 2020 travel guide',
])('does not treat an unrelated or bare edition marker as language instruction: %s', title=>{
  expect(localSiftResult(input(title)).bin?.name).not.toBe('Technical reference');
});

it('uses only successful bounded local AI article evidence for instructional intent',()=>{
  const row={url:'https://example.org/neural-networks',title:'Neural network details',status:'active' as const,
    contentText:'This article explains gradient propagation.',httpStatus:200,checkError:null};
  expect(localSiftResult(localSiftInput(row)).bin).toMatchObject({name:'Technical reference',fields:['url','title','pageText']});
  expect(localSiftResult(localSiftInput({...row,checkError:'timeout'})).bin?.name).toBe('Needs review');
  expect(localSiftResult(localSiftInput({...row,contentText:'x'.repeat(4096)+' This article explains neural networks.'})).bin?.name).toBe('Needs review');
});

it('preserves source checks and existing route precedence for the new subjects',()=>{
  expect(localSiftResult(input('Just a moment...','https://example.org/es2020-guide')).bin?.name).toBe('Check source');
  expect(localSiftResult(input('AI model training guide','https://github.com/org/repo/blob/main/tutorial.md')).bin?.name).toBe('Repo code and examples');
  expect(localSiftResult(input('AI model training guide','https://github.com/org/repo/issues/1')).bin?.name).toBe('Discussions and answers');
  expect(localSiftResult(input('AI model training guide','https://amazon.de/dp/B000000001')).bin?.name).toBe('Price-watch review');
});
