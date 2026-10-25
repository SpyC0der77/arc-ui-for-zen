'use strict';
const $ = id => document.getElementById(id);
const api = window.zenInstaller;
let busy = false;
const selection = () => ({installation:$('installation').value.trim(),profile:$('profile').value.trim()});
function status(text,error=false){$('status').textContent=text;$('status').dataset.error=String(error);}
function unwrap(result){if(!result.ok)throw new Error(result.error);return result.value;}
async function execute(fn){
  if(busy)return;busy=true;for(const control of document.querySelectorAll('button,input,select'))control.disabled=true;
  try{await fn();}catch(error){status(error.message,true);}
  finally{busy=false;for(const control of document.querySelectorAll('button,input,select'))control.disabled=false;}
}
for(const key of ['installation','profile'])$('browse-'+key).addEventListener('click',()=>void execute(async()=>{const folder=unwrap(await api.chooseFolder());if(folder)$(key).value=folder;}));
$('profiles').addEventListener('change',()=>{if($('profiles').value)$('profile').value=$('profiles').value;});
$('installer').addEventListener('submit',event=>{event.preventDefault();void execute(async()=>{status('Installing…');const result=unwrap(await api.apply('install',selection()));status(result.message+'\nThe preview opens after onboarding. Ctrl+B or Cmd+B toggles the sidebar.');});});
$('remove').addEventListener('click',()=>void execute(async()=>{status('Removing…');status(unwrap(await api.apply('remove',selection())).message);}));
$('launch').addEventListener('click',()=>void execute(async()=>{unwrap(await api.launch(selection()));status('Zen opened.');}));
void execute(async()=>{
 const info=unwrap(await api.discover());
 $('version').textContent=`Installer ${info.version} · Supports Zen ${info.supportedZen} · ${info.platform}`;
 if(info.apps.length)$('installation').value=info.apps[0];
 for(const profile of info.profiles){const option=document.createElement('option');option.value=profile.path;option.textContent=profile.name+(profile.installed?' (installed)':'');$('profiles').append(option);}
 if(info.profiles.length===1){$('profiles').value=info.profiles[0].path;$('profile').value=info.profiles[0].path;}
 status(info.apps.length?'Choose your Zen profile, then close Zen and install.':'Choose your Zen application folder and profile to continue.');
});
