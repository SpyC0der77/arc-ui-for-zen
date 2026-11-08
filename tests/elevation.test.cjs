const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {apply,worker,elevate,elevationScript}=require('../installer/elevation.cjs');
test('normal installs do not request administrator access',async()=>{
 assert.equal(await apply('install','app','profile',{engine:{install:async()=>42},platform:'win32',elevate:()=>assert.fail('unexpected elevation')}),42);
});
for(const action of ['install','remove'])for(const code of ['EPERM','EACCES'])test(`${action} requests elevation once for ${code} with exact selected paths`,async()=>{
 const calls=[];
 const result=await apply(action,'app with spaces','original profile',{platform:'win32',engine:{[action]:async()=>{throw Object.assign(new Error('denied'),{code});}},elevate:async(...args)=>{calls.push(args.slice(0,3));return 'done';}});
 assert.equal(result,'done');assert.deepEqual(calls,[[action,'app with spaces','original profile']]);
});
test('conflicts and non-Windows failures never elevate',async()=>{
 for(const [platform,code] of [['win32',undefined],['linux','EPERM']])await assert.rejects(apply('install','a','p',{platform,engine:{install:async()=>{throw Object.assign(new Error('conflict'),{code});}},elevate:()=>assert.fail('unexpected elevation')}),/conflict/);
});
test('elevated worker uses supplied paths and reports failure without retrying',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'arc-worker-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const result=path.join(root,'result.json'),calls=[];
 assert.equal(await worker(['install',root,root,result],{install:async(...args)=>{calls.push(args);throw new Error('receipt mismatch');}}),1);
 assert.deepEqual(calls,[[root,root]]);assert.deepEqual(JSON.parse(await fs.readFile(result,'utf8')),{ok:false,error:'receipt mismatch'});
 await assert.rejects(worker(['open',root,root,result],{}),/Invalid/);
});
test('UAC cancellation is actionable and not retried',async()=>{
 let calls=0;
 await assert.rejects(elevate('install','a','p',{appPath:process.cwd(),run:async()=>{calls++;throw Object.assign(new Error('cancelled'),{code:1223});}}),/permission was declined/);
 assert.equal(calls,1);
});
test('elevation transports quoted paths as data in encoded PowerShell',()=>{
 const script=elevationScript("C:\\O'Brien\\installer.exe",['C:\\a b\\','p"q','$(not-code)']);
 assert.match(script,/-Verb RunAs -Wait -PassThru/);assert.ok(script.includes("'C:\\O''Brien\\installer.exe'"));assert.ok(script.includes('$(not-code)'));
});
