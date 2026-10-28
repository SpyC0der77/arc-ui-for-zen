const {test}=require('node:test');
const assert=require('node:assert/strict');
const fixtures=import('../payload/content/debug-data.mjs');

test('debug page ownership never matches a normal page or another session',async()=>{
  const {PAGE,ownsPage}=await fixtures;
  assert.equal(ownsPage(`${PAGE}?debug=owned&title=Notes`,'owned'),true);
  for(const url of [`${PAGE}?debug=other`,`${PAGE}.evil?debug=owned`,'https://example.com/?debug=owned','about:blank','not a URL'])
    assert.equal(ownsPage(url,'owned'),false,url);
});
test('mock download actions change only their in-memory fixture state',async()=>{
  const {createDownloads}=await fixtures;
  let updates=0;const actions=[];
  const items=createDownloads({directory:'/mock',image:['/mock/a.png','/mock/b.png'],now:10000000,changed:()=>updates++,action:message=>actions.push(message)});
  assert.equal(items.length,7);
  assert.equal(items.filter(d=>d.succeeded).length,3);
  const pending=items.find(d=>!d.stopped);
  await pending.cancel();assert.equal(pending.canceled,true);assert.equal(pending.hasPartialData,true);
  await pending.removePartialData();assert.equal(pending.hasPartialData,false);
  await pending.start();assert.equal(pending.stopped,false);assert.equal(pending.error,null);
  const failed=items.find(d=>d.error);await failed.start();assert.equal(failed.error,null);
  await items[0].launch();await items[0].showContainingDirectory();
  assert.equal(actions.length,2);assert.equal(updates,4);
  assert.ok(items.every(d=>d.mock&&d.source.url.startsWith('https://example.invalid/mock/')));
});
