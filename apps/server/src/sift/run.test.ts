import { mkdtemp,readFile,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach,expect,it,vi } from 'vitest';
import { runSift } from './run.js';

let folder:string|undefined;
afterEach(async()=>{vi.unstubAllGlobals();if(folder)await rm(folder,{recursive:true,force:true});});

it.each(['sessionProtected','session_protected'])('keeps a nominated %s source out of the CLI page reader',async field=>{
  folder=await mkdtemp(join(tmpdir(),'bukmark-sift-cli-'));
  const url='https://github.com/sample/tools';
  const input=join(folder,'input.json'),select=join(folder,'selection.json'),out=join(folder,'report.json');
  await writeFile(input,JSON.stringify({links:[{url,title:'Public-looking protected source',[field]:true}]}));
  await writeFile(select,JSON.stringify([{savedUrl:url,publicUrl:url}]));
  const external=vi.fn(async()=>{throw new Error('Protected source reached a reader');});
  vi.stubGlobal('fetch',external);
  expect(await runSift(['--input',input,'--select',select,'--verify-public','--out',out],external)).toBe(0);
  const report=JSON.parse(await readFile(out,'utf8'));
  expect(report.rulesVersion).toBe('local-seven-bin-v5');
  expect(report.suggestedBins).toEqual({'Needs review':1});
  expect(report.pilot).toMatchObject({publicReady:0,publicSkipped:1,attempted:0,completed:0,inputTokens:0});
  expect(external).not.toHaveBeenCalled();
});

it('rejects an invalid protection flag instead of treating it as unprotected',async()=>{
  folder=await mkdtemp(join(tmpdir(),'bukmark-sift-cli-'));
  const input=join(folder,'input.json');
  await writeFile(input,JSON.stringify({links:[{url:'https://example.org/guide',title:'Stored source',sessionProtected:'true'}]}));
  await expect(runSift(['--input',input])).rejects.toThrow('invalid protection flag');
});
