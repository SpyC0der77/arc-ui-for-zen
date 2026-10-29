const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../payload/content/split-actions.js'),'utf8');

function fixture(platform) {
  const context={};vm.runInNewContext(source,context);
  const listeners=new Map(),attrs=new Map([['tooltiptext','Close tab'],['data-l10n-id','tabbrowser-close-tabs-button']]);
  const rootAttrs=new Set();
  let detached=0;
  const container={};
  const tab={closest:selector=>selector==='tab-group[split-view-group]'&&tab.split,split:true,linkedBrowser:{closest:()=>container}};
  const button={getAttribute:key=>attrs.get(key)??null,setAttribute:(key,value)=>attrs.set(key,value),removeAttribute:key=>attrs.delete(key),closest:()=>tab};
  const win={navigator:{platform},document:{documentElement:{toggleAttribute:(key,on)=>on?rootAttrs.add(key):rootAttrs.delete(key)},querySelectorAll:()=>[button]},
    gBrowser:{tabContainer:{}},gZenViewSplitter:{removeTabFromSplit:(event,target)=>{assert.equal(target,container);detached++;}},
    MutationObserver:class {observe(){} disconnect(){}},
    addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)};
  const stop=context.ArcSplitActions.install(win);
  function emit(type,extra={}) {
    const event={target:win,ctrlKey:false,metaKey:false,button:0,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra,type};
    listeners.get(type)?.(event);return event;
  }
  return {emit,attrs,rootAttrs,stop,listeners,button,tab,get detached(){return detached;}};
}

for(const [platform,modifier,other] of [['Win32','ctrlKey','metaKey'],['MacIntel','metaKey','ctrlKey']]) {
  test(`${platform}: accelerator changes split action and restores labels on release, blur and cleanup`,()=>{
    const f=fixture(platform);
    f.emit('keydown',{[other]:true});assert.equal(f.rootAttrs.size,0);
    f.emit('keydown',{[modifier]:true});assert.equal(f.attrs.get('tooltiptext'),'Unsplit tab');
    assert.equal(f.attrs.has('data-l10n-id'),false);
    f.emit('keyup',{[modifier]:true});assert.equal(f.rootAttrs.size,1,'another key released while accelerator held');
    f.emit('keyup');assert.equal(f.attrs.get('tooltiptext'),'Close tab');
    assert.equal(f.attrs.get('data-l10n-id'),'tabbrowser-close-tabs-button');
    f.emit('keydown',{[modifier]:true});f.emit('blur',{target:{}});assert.equal(f.rootAttrs.size,1,'child focus changes keep mode');
    f.emit('blur');assert.equal(f.rootAttrs.size,0);
    f.emit('keydown',{[modifier]:true});f.stop();assert.equal(f.rootAttrs.size,0);
    assert.equal(f.attrs.get('tooltiptext'),'Close tab');assert.equal(f.listeners.size,0);
  });
  test(`${platform}: modified click detaches once; plain and middle clicks retain native behavior`,()=>{
    const f=fixture(platform),target={closest:()=>f.button};
    assert.equal(f.emit('click',{target}).prevented,undefined);
    f.emit('keydown',{[modifier]:true});
    assert.equal(f.emit('click',{target}).prevented,undefined,'stale keydown cannot turn plain close into unsplit');
    f.tab.split=false;
    assert.equal(f.emit('click',{target,[modifier]:true}).prevented,undefined,'ordinary tabs retain native close behavior');
    f.tab.split=true;
    assert.equal(f.emit('click',{target,button:1,[modifier]:true}).prevented,undefined);
    for(const type of ['pointerdown','mousedown','click'])assert.equal(f.emit(type,{target,[modifier]:true}).stopped,true);
    assert.equal(f.detached,1);
    f.emit('keyup');assert.equal(f.emit('click',{target}).prevented,undefined);
    f.stop();
  });
}
