const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {validate,prepare}=require('../scripts/release.cjs');
const {version}=require('../package.json');
const {releaseChanges}=require('../scripts/release.cjs');

test('release notes include direct commits and PR notes across all comparison pages',()=>{
 const calls=[];
 const commit={sha:'abcdef123456',commit:{message:'Fix sidebar\n\nDetails'}};
 const notes=releaseChanges('owner/repo','v2',args=>{
  calls.push(args);
  if(args.includes('tag_name=v2'))return {body:'## What\'s Changed\n* A merged PR\n\n**Full Changelog**: https://github.com/owner/repo/compare/v1...v2'};
  return {commits:args[1].endsWith('&page=1')?Array(100).fill(commit):[{...commit,commit:{message:'Direct fix *with markup*'}}]};
 });
 assert.equal(calls.length,3);
 assert.match(calls[1][1],/compare\/v1\.\.\.v2\?per_page=100&page=1/);
 assert.match(notes,/Fix sidebar/);
 assert.match(notes,/Direct fix \\\*with markup\\\*/);
 assert.match(notes,/A merged PR/);
 assert.match(notes,/commit\/abcdef123456/);
 assert.doesNotMatch(notes,/Details/);
});

test('first release lists commits and API failures stop publication',()=>{
 const notes=releaseChanges('owner/repo','v1',args=>args.includes('tag_name=v1')?{body:''}:[{sha:'123456789',commit:{message:'Initial release'}}]);
 assert.match(notes,/Initial release/);
 assert.throws(()=>releaseChanges('owner/repo','v1',()=>{throw new Error('API unavailable');}),/API unavailable/);
});
test('release requires an existing matching tag',()=>{
 validate({GITHUB_REF_TYPE:'tag',GITHUB_REF_NAME:`v${version}`});
 assert.throws(()=>validate({GITHUB_REF_TYPE:'branch',GITHUB_REF_NAME:'main'}),/existing version tag/);
 assert.throws(()=>validate({GITHUB_REF_TYPE:'tag',GITHUB_REF_NAME:'v9.9.9'}),/matching package.json/);
});
test('release fails without every distribution and hashes actual file contents',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arc-release-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const notes=path.join(dir,'notes.md');
 assert.throws(()=>prepare(dir,notes),/Missing release asset/);
 const names=['Windows.exe','macOS-arm64.dmg','macOS-arm64.zip','Linux-x64.AppImage'].map(s=>`Arc-UI-Zen-${version}-${s}`);
 for(const name of names)fs.writeFileSync(path.join(dir,name),'example installer');
 prepare(dir,notes);
 const hash=crypto.createHash('sha256').update('example installer').digest('hex');
 const updateName = `Arc-UI-Zen-${version}-Update.json`;
 const update = fs.readFileSync(path.join(dir, updateName));
 const bundle = JSON.parse(update);
 assert.equal(bundle.version, version);
 assert.equal(Buffer.from(bundle.files['arc.uc.js'],'base64').toString(), fs.readFileSync(path.join(__dirname,'../payload/arc.uc.js'),'utf8'));
 const expected = [...names,updateName].sort().map(n=>`${n===updateName ? crypto.createHash('sha256').update(update).digest('hex') : hash}  ${n}\n`).join('');
 assert.equal(fs.readFileSync(path.join(dir,'SHA256SUMS.txt'),'utf8'),expected);
 assert.match(fs.readFileSync(notes,'utf8'),new RegExp(require('../installer/engine.cjs').SUPPORTED.replaceAll('.','\\.')));
});

