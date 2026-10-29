const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {validate,prepare}=require('../scripts/release.cjs');
const {version}=require('../package.json');
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
 assert.equal(fs.readFileSync(path.join(dir,'SHA256SUMS.txt'),'utf8'),names.sort().map(n=>`${hash}  ${n}\n`).join(''));
 assert.match(fs.readFileSync(notes,'utf8'),new RegExp(require('../installer/engine.cjs').SUPPORTED.replaceAll('.','\\.')));
});
