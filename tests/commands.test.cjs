const {test}=require('node:test');
const assert=require('node:assert/strict');
const commands=import('../payload/content/commands.sys.mjs');

test('command prefixes and aliases match without swallowing ordinary searches',async()=>{
  const {matchActions}=await commands;
  assert.equal(matchActions('  OPEN   ARCHIVE ')[0].id,'archive');
  assert.equal(matchActions('down')[0].id,'downloads');
  assert.equal(matchActions('split view')[0].id,'split');
  assert.equal(matchActions('horizontal split')[0].id,'split-horizontal');
  assert.equal(matchActions('unsplit')[0].id,'unsplit');
  assert.equal(matchActions('debug')[0].id,'debug');
  assert.equal(matchActions('mock data')[0].id,'debug');
  assert.equal(matchActions('reset debug data')[0].id,'debug-reset');
  for(const query of ['', 'a', 'archive.org', 'https://downloads.com', 'downloads for windows', '? archive', 'split screen tutorial', 'debugging javascript', 'https://debug.example']){
    assert.deepEqual(matchActions(query),[],query);
  }
});
