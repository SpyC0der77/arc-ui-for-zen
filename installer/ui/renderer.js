'use strict';
const $ = id => document.getElementById(id);
const api = window.zenInstaller;
const steps=['welcome','setup','profile-step','review','complete'];
let busy=false,currentStep='welcome',focusPending=false,pageTransition;
let errorSelection=null;
let discoveredInstances=[];
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
const track=$('page-track');
const screens=[...document.querySelectorAll('.screen')];
const imagesReady=Promise.all([...document.images].map(image=>image.decode().catch(()=>{})));
const selection=()=>({installation:$('installation').value.trim(),profile:$('profile').value.trim()});
function focusStep(){ $(currentStep).querySelector('.title').focus({preventScroll:true}); }
function finishPageMotion(){
 pageTransition?.cancel();pageTransition=null;
 if(!busy)focusStep();else focusPending=true;
}
reducedMotion.addEventListener('change',finishPageMotion);
function showStep(step){
 if(step===currentStep)return;
 const index=steps.indexOf(step);
 const from=getComputedStyle(track).transform;
 pageTransition?.cancel();pageTransition=null;
 currentStep=step;
 screens.forEach((screen,i)=>{screen.inert=i!==index;screen.setAttribute('aria-hidden',String(i!==index));});
 if(step==='review'){
  $('review-installation').textContent=selection().installation;
  $('review-profile').textContent=selection().profile;
  void refreshVersions();
 }
 const destination='translate3d('+(-index*100)+'%,0,0)';
 track.style.transform=destination;
 if(reducedMotion.matches){finishPageMotion();return;}
 const animation=track.animate([{transform:from==='none'?'translate3d(0,0,0)':from},{transform:destination}],{duration:520,easing:'cubic-bezier(.4,0,.2,1)'});
 pageTransition=animation;
 animation.finished.then(()=>{if(pageTransition===animation)finishPageMotion();}).catch(()=>{});
}
async function refreshVersions(){
 const choice=selection();
 $('review-versions').textContent='Reading installed Arc UI version...';
 try{
  const info=unwrap(await api.inspect(choice));
  if(JSON.stringify(choice)!==JSON.stringify(selection()))return;
  $('review-versions').textContent=info.installedVersion
   ? 'Arc UI installed: '+info.installedVersion+'. '+(info.installedVersion===info.targetVersion?'Reinstall version: ':'Install version: ')+info.targetVersion+'.'
   : 'Arc UI is not installed in this profile. Install version: '+info.targetVersion+'.';
 }catch(error){if(JSON.stringify(choice)===JSON.stringify(selection()))$('review-versions').textContent='Could not read installed version. '+error.message;}
}
function status(text,error=false){errorSelection=error?selection():null;$('status').textContent=text;$('review-error').textContent=error?text:'';$('review-error').hidden=!error;for(const copy of document.querySelectorAll('.status-copy')){copy.textContent=error&&currentStep==='review'?'Review the error above and try again.':text;copy.dataset.error=String(error);}}
function selectionChanged(key){
 $(key).setCustomValidity('');
 const value=selection();
 if(key==='installation')$('applications').value=value.installation;
 if(errorSelection&&(value.installation!==errorSelection.installation||value.profile!==errorSelection.profile))status('Review the selected folders before installing.');
}
function validFolder(key){
 const field=$(key);
 field.value=field.value.trim();
 const message=key==='installation'?'Choose a Zen application folder.':'Choose a Zen profile folder.';
 field.setCustomValidity(field.value?'':message);
 if(key==='installation'&&!field.value&&$('applications').options.length>1&&!$('manual-installation').open){
  status('Select a detected Zen installation.',true);$('applications').focus();return false;
 }
 if(!field.value)field.closest('details')?.setAttribute('open','');
 if(field.reportValidity())return true;
 status(message,true);field.focus();return false;
}
function unwrap(result){if(!result.ok)throw new Error(result.error);return result.value;}
async function execute(fn){
 if(busy)return;
 busy=true;for(const control of document.querySelectorAll('button,input,select'))control.disabled=true;
 try{await fn();}catch(error){status(error.message,true);}
 finally{busy=false;for(const control of document.querySelectorAll('button,input,select'))control.disabled=false;if(focusPending&&!pageTransition){focusPending=false;focusStep();}}
}
$('begin').addEventListener('click',()=>showStep('setup'));
for(const button of document.querySelectorAll('[data-back]'))button.addEventListener('click',()=>showStep(button.dataset.back));
$('browser-next').addEventListener('click',()=>{if(validFolder('installation'))showStep('profile-step');});
$('profile-next').addEventListener('click',()=>{if(validFolder('profile'))showStep('review');});
$('manage').addEventListener('click',()=>showStep('review'));
for(const key of ['installation','profile']){
 $(key).addEventListener('input',()=>selectionChanged(key));
 $('browse-'+key).addEventListener('click',()=>void execute(async()=>{const folder=unwrap(await api.chooseFolder());if(folder){$(key).value=folder;selectionChanged(key);}}));
}
$('profiles').addEventListener('change',()=>{if($('profiles').value){$('profile').value=$('profiles').value;selectionChanged('profile');}});
function selectDetectedApplication(){
 $('installation').value=$('applications').value;
 selectionChanged('installation');
 const matches=discoveredInstances.filter(instance=>instance.app===$('applications').value&&instance.profile);
 if(matches.length===1){$('profiles').value=matches[0].profile;$('profile').value=matches[0].profile;selectionChanged('profile');}
}
$('applications').addEventListener('change',selectDetectedApplication);
$('search-again').addEventListener('click',()=>void execute(searchForZen));
$('installer').addEventListener('submit',event=>{
 event.preventDefault();
 const missing=!selection().installation?'installation':!selection().profile?'profile':null;
 if(missing){showStep(missing==='installation'?'setup':'profile-step');validFolder(missing);return;}
 void execute(async()=>{status('Installing...');const result=unwrap(await api.apply('install',selection()));status(result.message);showStep('complete');});
});
$('remove').addEventListener('click',()=>void execute(async()=>{status('Removing...');status(unwrap(await api.apply('remove',selection())).message);await refreshVersions();}));
const openZen=()=>void execute(async()=>{unwrap(await api.launch(selection()));status('Zen opened.');});
$('launch').addEventListener('click',openZen);
$('finish').addEventListener('click',openZen);
async function searchForZen(){
 status('Looking for Zen...');
 const info=unwrap(await api.discover());
 await Promise.all([imagesReady,document.fonts.ready]);
 $('version').textContent=`Installer ${info.version} / Zen ${info.supportedZen} / ${info.platform}`;
 for(const copy of document.querySelectorAll('.version-copy'))copy.textContent=$('version').textContent;
 discoveredInstances=info.instances||[];
 const previous=selection();
 $('applications').replaceChildren(new Option(info.apps.length?'Select a Zen installation...':'No Zen installations found',''));
 for(const app of info.apps)$('applications').append(new Option(app,app));
 $('profiles').replaceChildren(new Option('Select a profile...',''));
 for(const profile of info.profiles){const option=document.createElement('option');option.value=profile.path;option.textContent=profile.name+(profile.installed?' (installed)':'');$('profiles').append(option);}
 if(info.profiles.some(p=>p.path===previous.profile))$('profiles').value=previous.profile;
 else if(!previous.profile&&info.profiles.length===1){$('profiles').value=info.profiles[0].path;$('profile').value=info.profiles[0].path;}
 const running=discoveredInstances.filter(instance=>instance.pid);
 const preferred=info.apps.includes(previous.installation)?previous.installation:
  !previous.installation?(running.length===1?running[0].app:discoveredInstances.length===1?discoveredInstances[0].app:info.apps.length===1?info.apps[0]:null):null;
 if(preferred){$('applications').value=preferred;selectDetectedApplication();}
 $('manual-installation').open=!info.apps.length;
 status(info.apps.length?'Zen found. Review the detected browser and profile during setup.':'No Zen found. Open Zen and search again, or choose its folder manually.');
}
void execute(async () => {
 await searchForZen();
 const update = unwrap(await api.updateSelection());
 if(update){
  $('installation').value=update.installation;
  $('profile').value=update.profile;
  showStep('review');
 }
});
