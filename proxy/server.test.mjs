import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from './server.mjs';
async function run(options, fn) {
  const s = createServer(options); await new Promise(r => s.listen(0, '127.0.0.1', r));
  try { await fn(`http://127.0.0.1:${s.address().port}`); }
  finally { await new Promise(r => s.close(r)); }
}
test('demo returns usable metadata and healthy mode without key', async () => run({}, async base => {
  assert.equal((await (await fetch(`${base}/api/health`)).json()).mode, 'demo');
  for (const route of ['search','channels','videos']) {
    const r = await fetch(`${base}/api/youtube/${route}?part=snippet`);
    assert.equal(r.status, 200); assert.equal((await r.json()).items.length, 1);
  }
}));
test('rejects wrong paths, methods and unapproved queries', async () => run({}, async base => {
  for (const [path,status] of [['/bad',404],['/api/youtube/https://evil',404],['/api/youtube/search?url=evil',400]]) {
    assert.equal((await fetch(base+path)).status,status);
  }
  assert.equal((await fetch(base+'/api/health',{method:'POST'})).status,405);
}));
test('live fails closed when key is missing', async () => run({mode:'live',keyFile:'/not-present'}, async base => {
  assert.equal((await fetch(base+'/api/health')).status,503);
  assert.equal((await fetch(base+'/api/youtube/search')).status,503);
}));
test('rate limit enforced', async () => run({limit:1}, async base => {
  assert.equal((await fetch(base+'/api/youtube/search')).status,200);
  assert.equal((await fetch(base+'/api/youtube/search')).status,429);
}));
test('live passes credential only to fixed upstream and masks errors', async () => {
  const dir=mkdtempSync(join(tmpdir(),'yt-'));const keyFile=join(dir,'key');writeFileSync(keyFile,'test-key');
  let received;
  const up=http.createServer((req,res)=>{received=req.headers['x-rapidapi-key'];res.setHeader('Content-Type','application/json');
    if(req.url.includes('q=deny')) {res.statusCode=401;res.end('sensitive provider detail');}
    else res.end(JSON.stringify({items:[{id:'live'}]})); });
  await new Promise(r=>up.listen(0,'127.0.0.1',r));
  try {await run({mode:'live',keyFile,origin:`http://127.0.0.1:${up.address().port}`},async base=>{
    const r=await fetch(base+'/api/youtube/search?q=test');assert.equal(r.status,200);assert.equal(received,'test-key');
    assert.equal((await r.json()).items[0].id,'live');
    const denied=await fetch(base+'/api/youtube/search?q=deny');assert.equal(denied.status,502);
    assert.equal((await denied.json()).upstreamStatus,401);
    assert.equal((await fetch(base+'/api/youtube/search?maxResults=100')).status,400);
  });} finally {await new Promise(r=>up.close(r));rmSync(dir,{recursive:true});}
});
test('upstream timeout returns bounded 504', async () => {
  const dir=mkdtempSync(join(tmpdir(),'yt-'));const keyFile=join(dir,'key');writeFileSync(keyFile,'test-key');
  const up=http.createServer((req,res)=>{setTimeout(()=>res.end('{"items":[]}'),100);});
  await new Promise(r=>up.listen(0,'127.0.0.1',r));
  try {await run({mode:'live',keyFile,timeout:10,origin:`http://127.0.0.1:${up.address().port}`},async base=>{
    assert.equal((await fetch(base+'/api/youtube/search')).status,504);
  });} finally {up.closeAllConnections();await new Promise(r=>up.close(r));rmSync(dir,{recursive:true});}
});
test('invalid upstream shape returns 502', async () => {
  const dir=mkdtempSync(join(tmpdir(),'yt-'));const keyFile=join(dir,'key');writeFileSync(keyFile,'test-key');
  const up=http.createServer((req,res)=>res.end('{"unexpected":true}'));
  await new Promise(r=>up.listen(0,'127.0.0.1',r));
  try {await run({mode:'live',keyFile,origin:`http://127.0.0.1:${up.address().port}`},async base=>{
    assert.equal((await fetch(base+'/api/youtube/search')).status,502);
  });} finally {await new Promise(r=>up.close(r));rmSync(dir,{recursive:true});}
});
