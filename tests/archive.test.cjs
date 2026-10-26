const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const scope={};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../payload/content/archive.js'),'utf8'),scope);
const {ArcArchive}=scope;
const HOUR=3600000;
const now=Date.UTC(2026,9,25,12);
function row(id,overrides={}) {
  return {tab:id,url:'https://example.com/'+id,lastAccessed:now-13*HOUR,...overrides};
}
function prefs(values={}) {
  return {getIntPref:(key,fallback)=>key in values?values[key]:fallback};
}
function clock() {
  const queue=[];
  return {queue,schedule(fn,ms){const id={fn,ms};queue.push(id);return id;},
    cancel(id){const index=queue.indexOf(id);if(index!==-1)queue.splice(index,1);},
    fire(){queue.shift().fn();}};
}
test('archives only idle background web pages, oldest first',()=>{
  const rows=[
    row('fresh',{lastAccessed:now-1*HOUR}),
    row('old',{lastAccessed:now-30*HOUR}),
    row('older',{lastAccessed:now-40*HOUR}),
    row('selected',{selected:true}),
    row('multi',{multiselected:true}),
    row('pinned',{pinned:true}),
    row('essential',{essential:true}),
    row('split',{splitview:true}),
    row('grouped',{grouped:true}),
    row('folded',{folded:true}),
    row('audible',{audible:true}),
    row('busy',{busy:true}),
    row('attention',{attention:true}),
    row('private',{private:true}),
    row('closed',{closed:true}),
    row('internal',{url:'about:newtab'}),
    row('missing-time',{lastAccessed:NaN}),
    row('zero-time',{lastAccessed:0}),
    row('exactly-idle',{lastAccessed:now-12*HOUR})
  ];
  const selected=ArcArchive.due(rows,{now,hours:12});
  assert.deepEqual(selected.map(tab=>tab.tab),['older','old','exactly-idle']);
  assert.equal(rows.find(tab=>tab.tab==='older').lastAccessed,now-40*HOUR,'input order is not mutated');
});
test('one pass archives at most ten tabs',()=>{
  const rows=Array.from({length:15},(_,i)=>row('tab'+i,{lastAccessed:now-(20+i)*HOUR}));
  const selected=ArcArchive.due(rows,{now,hours:12});
  assert.equal(selected.length,10);
  assert.deepEqual(selected.map(tab=>tab.tab),Array.from({length:10},(_,i)=>'tab'+(14-i)));
});
test('idle hours read from preferences and zero disables',()=>{
  assert.equal(ArcArchive.hours(prefs()),12);
  assert.equal(ArcArchive.hours(prefs({'arc-ui.archive.hours':0})),0);
  assert.equal(ArcArchive.hours(prefs({'arc-ui.archive.hours':24})),24);
  assert.equal(ArcArchive.hours(prefs({'arc-ui.archive.hours':-3})),12);
  assert.equal(ArcArchive.hours({getIntPref(){throw new Error('no pref');}}),12);
  assert.equal(ArcArchive.due([row('old')],{now,hours:0}).length,0);
});
test('schedule closes due tabs once, announces and keeps running',()=>{
  const timers=clock();
  const closed=[],announced=[];
  const rows=[row('old'),row('fresh',{lastAccessed:now-HOUR}),row('pinned',{pinned:true})];
  const stop=ArcArchive.start({tabs:()=>rows,close:tab=>closed.push(tab.tab),announce:count=>announced.push(count),
    getHours:()=>12,now:()=>now,schedule:timers.schedule,cancel:timers.cancel,delay:10,interval:20});
  assert.equal(timers.queue.length,1);
  assert.equal(timers.queue[0].ms,10);
  timers.fire();
  assert.deepEqual(closed,['old']);
  assert.deepEqual(announced,[1]);
  assert.equal(timers.queue.length,1);
  assert.equal(timers.queue[0].ms,20);
  stop();
  assert.equal(timers.queue.length,0);
});
test('a stopped or closed window never closes tabs',()=>{
  const timers=clock();
  let closed=0,closedWindow=false;
  const stop=ArcArchive.start({tabs:()=>[row('old')],close:()=>closed++,isClosed:()=>closedWindow,
    schedule:timers.schedule,cancel:timers.cancel,delay:10,interval:20});
  closedWindow=true;
  timers.fire();
  assert.equal(closed,0);
  assert.equal(timers.queue.length,0,'a closed window does not reschedule');
  closedWindow=false;
  stop();
  assert.equal(timers.queue.length,0,'stopping drops the pending pass');
  assert.equal(closed,0);
});
test('a failing close is reported and the remaining tabs still archive',()=>{
  const timers=clock();
  const closed=[],errors=[];
  const rows=[row('oldest',{lastAccessed:now-30*HOUR}),row('old',{lastAccessed:now-20*HOUR})];
  ArcArchive.start({tabs:()=>rows,close:tab=>{if(tab.tab==='oldest')throw new Error('tab is closing');closed.push(tab.tab);},
    isClosed:()=>false,onError:error=>errors.push(error.message),schedule:timers.schedule,cancel:timers.cancel,delay:10,interval:20});
  timers.fire();
  assert.deepEqual(errors,['tab is closing']);
  assert.deepEqual(closed,['old']);
});
