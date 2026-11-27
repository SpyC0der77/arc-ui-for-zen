const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const engine=require('../installer/engine.cjs');
const {fixture}=require('./engine-fixture.cjs');
test('a local browser font is owned, preserved on reinstall, and cleared on request',async t=>{
 const f=await fixture(t),source=path.join(f.root,'My User Font.woff2');
 const {FACE,STYLES}=require('../installer/custom-font.cjs');
 const installed=relative=>path.join(f.profile,'chrome','zennia',relative);
 await fs.copyFile(path.join(__dirname,'../payload/content/geist-400.woff2'),source);
 await engine.install(f.app,f.profile,{...f.options,customFont:source});
 const bytes=await fs.readFile(installed(FACE));
 assert.deepEqual(bytes,await fs.readFile(source));
 assert.match(await fs.readFile(installed(STYLES),'utf8'),/format\("woff2"\)/);
 assert.equal((await engine.inspect(f.app,f.profile)).customFont,'My User Font.woff2');
 await fs.writeFile(source,'bad font');
 await assert.rejects(engine.install(f.app,f.profile,{...f.options,customFont:source}),/not a valid/);
 assert.deepEqual(await fs.readFile(installed(FACE)),bytes);
 await engine.install(f.app,f.profile,f.options);
 assert.deepEqual(await fs.readFile(installed(FACE)),bytes);
 await engine.install(f.app,f.profile,{...f.options,customFont:null});
 await assert.rejects(fs.access(installed(FACE)),{code:'ENOENT'});
 await assert.rejects(fs.access(installed(STYLES)),{code:'ENOENT'});
 assert.equal((await engine.inspect(f.app,f.profile)).customFont,undefined);
 assert.equal(await fs.readFile(source,'utf8'),'bad font');
});
test('browser font presets use bundled Geist or preserve the imported SF Pro file',async t=>{
 const f=await fixture(t);
 const {FACE,STYLES}=require('../installer/custom-font.cjs');
 const installed=relative=>path.join(f.profile,'chrome','zennia',relative);
 const source=path.join(f.root,'Example.woff2');
 const bundled=path.join(__dirname,'../payload/content/geist-400.woff2');
 await fs.copyFile(bundled,source);
 await assert.rejects(engine.install(f.app,f.profile,{...f.options,fontPreset:'sf-pro'}),/Choose a font file/);
 await engine.install(f.app,f.profile,{...f.options,customFont:'geist'});
 const css=await fs.readFile(installed(STYLES),'utf8');
 for(const weight of [400,500,600])assert.ok(css.includes(`url("../geist-${weight}.woff2")`));
 assert.equal((await engine.inspect(f.app,f.profile)).fontPreset,'geist');
 await assert.rejects(fs.access(installed(FACE)),{code:'ENOENT'});
 await engine.install(f.app,f.profile,f.options);
 assert.equal(await fs.readFile(installed(STYLES),'utf8'),css);
 await engine.install(f.app,f.profile,{...f.options,customFont:source,fontPreset:'sf-pro'});
 await engine.install(f.app,f.profile,f.options);
 const info=await engine.inspect(f.app,f.profile);
 assert.equal(info.fontPreset,'sf-pro');
 assert.equal(info.customFont,'Example.woff2');
 assert.deepEqual(await fs.readFile(installed(FACE)),await fs.readFile(source));
 await engine.install(f.app,f.profile,{...f.options,customFont:null});
 assert.equal((await engine.inspect(f.app,f.profile)).fontPreset,undefined);
 await assert.rejects(fs.access(installed(FACE)),{code:'ENOENT'});
});
// A minimal OpenType file that passes the importer's checks: the OTTO signature and one table inside it.
function otf(tag){
 const bytes=Buffer.alloc(64);bytes.write('OTTO',0,'latin1');bytes.writeUInt16BE(1,4);
 bytes.write('CFF ',12,'latin1');bytes.writeUInt32BE(28,20);bytes.writeUInt32BE(4,24);bytes.write(tag,40,'latin1');
 return bytes;
}
test('the SF Pro family imports every Text and Display face at its matching weight',async t=>{
 const f=await fixture(t);
 const {FAMILY,STYLES,stylesheet,readFamily}=require('../installer/custom-font.cjs');
 const installed=relative=>path.join(f.profile,'chrome','zennia',relative);
 const folder=path.join(f.root,'San-Francisco-Pro-Fonts-master');
 await fs.mkdir(folder);
 const files=['SF-Pro-Text-Regular.otf','SF-Pro-Text-Medium.otf','SF-Pro-Text-Semibold.otf','SF-Pro-Text-Bold.otf','SF-Pro-Text-RegularItalic.otf','SF-Pro-Display-Regular.otf','SF-Pro-Display-Bold.otf'];
 for(const file of files)await fs.writeFile(path.join(folder,file),otf(file));
 await fs.writeFile(path.join(folder,'README.md'),'not a font');
 await fs.writeFile(path.join(folder,'SF-Pro-Rounded-Regular.otf'),otf('rounded'));
 await engine.install(f.app,f.profile,{...f.options,customFont:folder,fontPreset:'sf-pro-family'});
 for(const file of files)assert.deepEqual(await fs.readFile(installed(path.join(FAMILY,file))),otf(file));
 await assert.rejects(fs.access(installed(path.join(FAMILY,'SF-Pro-Rounded-Regular.otf'))),{code:'ENOENT'});
 const css=await fs.readFile(installed(STYLES),'utf8');
 const offMac=stylesheet(await readFamily(folder),'win32').toString();
 // The file each @font-face uses for a family, weight and style, off macOS.
 const face=(family,weight,style='normal')=>{
  const rule=`@font-face { font-family: "${family}"; src: url("sf-pro/`;
  const tail=`") format("opentype"); font-weight: ${weight}; font-style: ${style}; }`;
  return offMac.split('\n').map(line=>line.trim()).find(line=>line.startsWith(rule)&&line.endsWith(tail))?.slice(rule.length,-tail.length);
 };
 // Each CSS weight uses its matching SF Pro cut on every platform.
 assert.equal(face('Zennia Custom',400),'SF-Pro-Text-Regular.otf');
 assert.equal(face('Zennia Custom',500),'SF-Pro-Text-Medium.otf');
 assert.equal(face('Zennia Custom',700),'SF-Pro-Text-Bold.otf');
 assert.equal(face('Zennia Custom',400,'italic'),'SF-Pro-Text-RegularItalic.otf');
 assert.equal(face('Zennia Custom Display',400),'SF-Pro-Display-Regular.otf');
 assert.equal(face('Zennia Custom Display',700),'SF-Pro-Display-Bold.otf');
 assert.match(css,/:is\(h1, h2\):not\(\.titlebar-button\) \{\s*font-family: "Zennia Custom Display"/);
 const info=await engine.inspect(f.app,f.profile);
 assert.deepEqual([info.fontPreset,info.customFont],['sf-pro-family','San-Francisco-Pro-Fonts-master']);
 // A plain reinstall keeps the imported family; choosing the default removes it.
 await engine.install(f.app,f.profile,f.options);
 assert.equal(await fs.readFile(installed(STYLES),'utf8'),css);
 assert.equal((await engine.inspect(f.app,f.profile)).fontPreset,'sf-pro-family');
 await engine.install(f.app,f.profile,{...f.options,customFont:null});
 await assert.rejects(fs.access(installed(path.join(FAMILY,files[0]))),{code:'ENOENT'});
 // On macOS each weight uses its own cut.
 const mac=require('../installer/custom-font.cjs').stylesheet(await require('../installer/custom-font.cjs').readFamily(folder),'darwin').toString();
 assert.match(mac,/sf-pro\/SF-Pro-Text-Regular\.otf"\) format\("opentype"\); font-weight: 400; font-style: normal;/);
 // A folder without SF Pro Text Regular is refused before anything changes.
 await fs.rm(path.join(folder,'SF-Pro-Text-Regular.otf'));
 await assert.rejects(engine.install(f.app,f.profile,{...f.options,customFont:folder,fontPreset:'sf-pro-family'}),/SF-Pro-Text-Regular\.otf/);
 await assert.rejects(engine.install(f.app,f.profile,{...f.options,fontPreset:'sf-pro-family'}),/Choose the folder/);
});
test('a reinstall stops before removing the old theme when its imported font is missing',async t=>{
 const {FAMILY,FACE,STYLES}=require('../installer/custom-font.cjs');
 const f=await fixture(t);
 const installed=relative=>path.join(f.profile,'chrome','zennia',relative);
 const folder=path.join(f.root,'SF Pro');
 await fs.mkdir(folder);
 await fs.writeFile(path.join(folder,'SF-Pro-Text-Regular.otf'),otf('regular'));
 await engine.install(f.app,f.profile,{...f.options,customFont:folder,fontPreset:'sf-pro-family'});
 await fs.rm(installed(FAMILY),{recursive:true});
 await assert.rejects(engine.install(f.app,f.profile,f.options),/Choose the font again/);
 assert.equal((await engine.inspect(f.app,f.profile)).fontPreset,'sf-pro-family');
 assert.ok(await fs.stat(installed(STYLES)));
 const g=await fixture(t),source=path.join(g.root,'Example.woff2');
 await fs.copyFile(path.join(__dirname,'../payload/content/geist-400.woff2'),source);
 await engine.install(g.app,g.profile,{...g.options,customFont:source});
 await fs.rm(path.join(g.profile,'chrome','zennia',FACE));
 await assert.rejects(engine.install(g.app,g.profile,g.options),/Choose the font again/);
 assert.equal((await engine.inspect(g.app,g.profile)).customFont,'Example.woff2');
 assert.ok(await fs.stat(path.join(g.profile,'chrome','zennia',STYLES)));
});
