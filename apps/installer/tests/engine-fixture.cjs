// Disposable Zen installation and profile shared by the engine test files.
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const engine=require('../installer/engine.cjs');
const options={checkClosed:async()=>{}};
async function fixture(t,platform=process.platform) {
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'zennia-test-')));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const app=path.join(root,'Zen App'),profile=path.join(root,'Profile ü');
 const layout=engine.layout(app,platform);await fs.mkdir(path.dirname(layout.exe),{recursive:true});await fs.mkdir(layout.resources,{recursive:true});await fs.mkdir(profile,{recursive:true});
 await fs.writeFile(layout.exe,'fixture');await fs.writeFile(path.join(layout.resources,'application.ini'),'[App]\nVersion=1.23.4b\n');await fs.writeFile(path.join(profile,'prefs.js'),'user_pref("unrelated", "keep me");\nuser_pref("zen.urlbar.replace-newtab", false);\n');
 return {root,app,profile,resources:layout.resources,options:{...options,platform}};
}
module.exports={options,fixture};
