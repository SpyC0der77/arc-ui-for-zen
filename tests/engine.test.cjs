const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const engine=require('../installer/engine.cjs');
const options={checkClosed:async()=>{}};
async function fixture(t,platform=process.platform) {
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'zen-arc-test-')));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const app=path.join(root,'Zen App'),profile=path.join(root,'Profile ü');
 const layout=engine.layout(app,platform);await fs.mkdir(path.dirname(layout.exe),{recursive:true});await fs.mkdir(layout.resources,{recursive:true});await fs.mkdir(profile,{recursive:true});
 await fs.writeFile(layout.exe,'fixture');await fs.writeFile(path.join(layout.resources,'application.ini'),'[App]\nVersion=1.23.4b\n');await fs.writeFile(path.join(profile,'prefs.js'),'user_pref("unrelated", "keep me");\nuser_pref("zen.urlbar.replace-newtab", false);\n');
 return {root,app,profile,resources:layout.resources,options:{...options,platform}};
}
for(const platform of ['win32','darwin','linux'])test('install/remove preserves original files on '+platform,async t=>{
 const f=await fixture(t,platform),user=path.join(f.profile,'user.js');
 const original=Buffer.from('// original\r\nuser_pref("custom", true);\r\n');await fs.writeFile(user,original);
 await engine.install(f.app,f.profile,f.options);
 assert.ok(await fs.stat(path.join(f.resources,'zen-arc.cfg')));assert.ok(await fs.stat(path.join(f.profile,'chrome','zen-arc','arc.uc.js')));
 assert.match(await fs.readFile(user,'utf8'),/BEGIN Arc Skeleton/);
 const installed=JSON.parse(await fs.readFile(engine.receiptFile(f.profile),'utf8'));
 assert.equal(installed.settings['gfx.font_rendering.cleartype_params.rendering_mode'],platform==='win32'?5:undefined);
 assert.equal(installed.settings['gfx.font_rendering.cleartype_params.cleartype_level'],platform==='win32'?0:undefined);
 await engine.remove(f.app,f.profile,f.options);
 assert.deepEqual(await fs.readFile(user),original);assert.equal(await fs.readFile(path.join(f.profile,'prefs.js'),'utf8'),'user_pref("unrelated", "keep me");\nuser_pref("zen.urlbar.replace-newtab", false);\n');
 await assert.rejects(fs.access(path.join(f.resources,'zen-arc.cfg')));
});
test('rejects unsupported versions before modifying',async t=>{const f=await fixture(t);await fs.writeFile(path.join(f.resources,'application.ini'),'[App]\nVersion=99\n');await assert.rejects(engine.install(f.app,f.profile,f.options),/supports Zen/);await assert.rejects(fs.access(engine.receiptFile(f.profile)));});
test('refuses existing startup loaders',async t=>{const f=await fixture(t);const dir=path.join(f.resources,'defaults','pref');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'other.js'),'pref("general.config.filename", "other.cfg");');await assert.rejects(engine.install(f.app,f.profile,f.options),/Another AutoConfig/);await assert.rejects(fs.access(engine.receiptFile(f.profile)));});
test('refuses running Zen without killing it',async t=>{const f=await fixture(t);await assert.rejects(engine.install(f.app,f.profile,{checkClosed:async()=>{throw new Error('running');}}),/running/);await assert.rejects(fs.access(engine.receiptFile(f.profile)));});
test('preserves edits added to user.js after installation',async t=>{const f=await fixture(t),file=path.join(f.profile,'user.js');await engine.install(f.app,f.profile,f.options);await fs.appendFile(file,'user_pref("later", "preserve");\n');await engine.remove(f.app,f.profile,f.options);assert.match(await fs.readFile(file,'utf8'),/later/);assert.doesNotMatch(await fs.readFile(file,'utf8'),/BEGIN Arc Skeleton/);});
test('restores persisted settings but preserves later user changes',async t=>{const f=await fixture(t);await engine.install(f.app,f.profile,f.options);const receipt=JSON.parse(await fs.readFile(engine.receiptFile(f.profile)));const lines=Object.entries(receipt.settings).map(([k,v])=>`user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`);await fs.writeFile(path.join(f.profile,'prefs.js'),lines.join('\n')+'\nuser_pref("unrelated", "keep");\n');await engine.remove(f.app,f.profile,f.options);const text=await fs.readFile(path.join(f.profile,'prefs.js'),'utf8');assert.match(text,/replace-newtab", false/);assert.match(text,/unrelated/);assert.doesNotMatch(text,/download-animation/);});
test('does not remove edited patch files',async t=>{const f=await fixture(t);await engine.install(f.app,f.profile,f.options);const file=path.join(f.profile,'chrome','zen-arc','arc.css');await fs.appendFile(file,'/* edited */');await assert.rejects(engine.remove(f.app,f.profile,f.options),/edited after/);assert.ok(await fs.stat(engine.receiptFile(f.profile)));});
test('rejects tampered receipt paths',async t=>{const f=await fixture(t);await engine.install(f.app,f.profile,f.options);const file=engine.receiptFile(f.profile),r=JSON.parse(await fs.readFile(file));r.files[0].path=path.join(f.root,'unrelated');await fs.writeFile(file,JSON.stringify(r));await assert.rejects(engine.remove(f.app,f.profile,f.options),/Invalid path/);});
test('refuses duplicate installations and preserves receipt',async t=>{const f=await fixture(t);await engine.install(f.app,f.profile,f.options);const before=await fs.readFile(engine.receiptFile(f.profile));await assert.rejects(engine.install(f.app,f.profile,f.options),/already installed/);assert.deepEqual(await fs.readFile(engine.receiptFile(f.profile)),before);});
test('cannot overwrite unrelated owned-path files',async t=>{const f=await fixture(t);const file=path.join(f.profile,'chrome','zen-arc','arc.css');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'user theme');await assert.rejects(engine.install(f.app,f.profile,f.options),/would be overwritten/);assert.equal(await fs.readFile(file,'utf8'),'user theme');await assert.rejects(fs.access(engine.receiptFile(f.profile)));});
test('profile discovery respects absolute and relative paths',async t=>{const f=await fixture(t);const home=path.join(f.root,'home'),root=path.join(home,'.zen');await fs.mkdir(root,{recursive:true});await fs.writeFile(path.join(root,'profiles.ini'),`[Profile0]\nName=Personal\nIsRelative=0\nPath=${f.profile}\n`);const result=await engine.discover({platform:'linux',home,env:{}});assert.equal(result.profiles[0].path,f.profile);assert.equal(result.profiles[0].name,'Personal');});
