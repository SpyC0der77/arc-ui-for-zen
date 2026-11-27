const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const engine=require('../installer/engine.cjs');
const {fixture}=require('./engine-fixture.cjs');
for(const platform of ['win32','darwin','linux'])test('install/remove preserves original files on '+platform,async t=>{
 const f=await fixture(t,platform),user=path.join(f.profile,'user.js');
 const original=Buffer.from('// original\r\nuser_pref("custom", true);\r\n');await fs.writeFile(user,original);
 await engine.install(f.app,f.profile,f.options);
 assert.ok(await fs.stat(path.join(f.resources,'zennia.cfg')));assert.ok(await fs.stat(path.join(f.profile,'chrome','zennia','zennia.uc.js')));
 assert.match(await fs.readFile(user,'utf8'),/BEGIN Zennia/);
 const installed=JSON.parse(await fs.readFile(engine.receiptFile(f.profile),'utf8'));
 assert.equal(installed.settings['gfx.font_rendering.cleartype_params.rendering_mode'],platform==='win32'?5:undefined);
 assert.equal(installed.settings['gfx.font_rendering.cleartype_params.cleartype_level'],platform==='win32'?0:undefined);
 assert.equal(installed.settings['widget.non-native-theme.scrollbar.style'],platform==='win32'?1:undefined);
 assert.equal(installed.settings['ui.useOverlayScrollbars'],platform==='win32'?1:undefined);
 assert.equal(installed.settings['general.smoothScroll.msdPhysics.enabled'],platform==='win32'?true:undefined);
 await engine.remove(f.app,f.profile,f.options);
 assert.deepEqual(await fs.readFile(user),original);assert.equal(await fs.readFile(path.join(f.profile,'prefs.js'),'utf8'),'user_pref("unrelated", "keep me");\nuser_pref("zen.urlbar.replace-newtab", false);\n');
 await assert.rejects(fs.access(path.join(f.resources,'zennia.cfg')));
});
for(const version of engine.SUPPORTED_VERSIONS)test('installs and removes supported Zen '+version,async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.resources,'application.ini'),`[App]\nVersion=${version}\n`);
 await engine.install(f.app,f.profile,f.options);await engine.remove(f.app,f.profile,f.options);
 await assert.rejects(fs.access(engine.receiptFile(f.profile)));
});
