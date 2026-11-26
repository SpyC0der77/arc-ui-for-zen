'use strict';
const $ = id => document.getElementById(id);
const api = window.zenInstaller;
const steps=['welcome','setup','profile-step','review','complete'];
let busy=false,currentStep='welcome',focusPending=false,pageTransition;
let errorSelection=null;
let discoveredInstances=[];
let installedFont, installedFontChoice='default', fontChoice, pickedFont, previewFace, platform;
const reviewTabs=[$('installation-tab'),$('appearance-tab')];
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
 $('review-versions').textContent='Reading installed Zennia version...';
 try{
  const info=unwrap(await api.inspect(choice));
  if(JSON.stringify(choice)!==JSON.stringify(selection()))return;
  installedFont=info.customFont;
  installedFontChoice=info.fontPreset||(installedFont?'custom':'default');
  renderFont();
  $('review-versions').textContent=info.installedVersion
   ? 'Zennia installed: '+info.installedVersion+'. '+(info.installedVersion===info.targetVersion?'Reinstall version: ':'Install version: ')+info.targetVersion+'.'
   : 'Zennia is not installed in this profile. Install version: '+info.targetVersion+'.';
 }catch(error){if(JSON.stringify(choice)===JSON.stringify(selection()))$('review-versions').textContent='Could not read installed version. '+error.message;}
}
function status(text,error=false){errorSelection=error?selection():null;$('status').textContent=text;$('review-error').textContent=error?text:'';$('review-error').hidden=!error;for(const copy of document.querySelectorAll('.status-copy')){copy.textContent=error&&currentStep==='review'?'Review the error above and try again.':text;copy.dataset.error=String(error);}}
function selectionChanged(key){
 $(key).setCustomValidity('');
 // The pending font choice is not tied to a profile, so it survives the change; only the
 // installed font, which belongs to the old profile, is forgotten until review reads it again.
 installedFont=undefined;
 installedFontChoice='default';
 renderFont();
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
function activateReviewTab(tab){
 for(const button of reviewTabs){
  const selected=button===tab;
  button.setAttribute('aria-selected',String(selected));
  button.tabIndex=selected?0:-1;
  $(button.getAttribute('aria-controls')).hidden=!selected;
 }
}
for(const [index,tab] of reviewTabs.entries()){
 tab.addEventListener('click',()=>activateReviewTab(tab));
 tab.addEventListener('keydown',event=>{
  const next={ArrowLeft:1-index,ArrowRight:1-index,Home:0,End:1}[event.key];
  if(next===undefined)return;
  event.preventDefault();
  activateReviewTab(reviewTabs[next]);
  reviewTabs[next].focus();
 });
}
function clearFontPreview(){
 if(previewFace)document.fonts.delete(previewFace);
 previewFace=undefined;
}
function resetFontChoice(){
 fontChoice=undefined;
 pickedFont=undefined;
 clearFontPreview();
}
// Text for the choices that import files; the custom file needs no download help.
const FONT_IMPORTS={
 'sf-pro':{help:'Download SF-Pro.ttf from GitHub, then choose the file here.',source:'Open SF-Pro.ttf on GitHub',choose:'Choose file…',missing:'Choose the downloaded SF-Pro.ttf before installing.',empty:'No file selected'},
 'sf-pro-family':{help:'On GitHub, choose Code › Download ZIP and unzip it. Then choose that folder here: Zennia loads every SF Pro Text and Display weight from it.',source:'Open the SF Pro fonts on GitHub',choose:'Choose folder…',missing:'Choose the folder with the SF Pro fonts before installing.',empty:'No folder selected'},
 custom:{choose:'Choose file…',missing:'Choose a font file before installing.',empty:'No file selected'},
};
function renderFont(){
 const choice=fontChoice??installedFontChoice;
 const imports=FONT_IMPORTS[choice];
 const name=pickedFont||(choice===installedFontChoice?installedFont:undefined);
 // macOS already draws its interface in SF Pro, so Default is SF Pro there and the
 // import choices are only offered elsewhere (or kept visible while one is installed).
 const mac=platform==='darwin';
 for(const option of $('font-preset').options){
  if(option.value==='default')option.textContent=mac?'Default (SF Pro)':'Default';
  if(FONT_IMPORTS[option.value]?.help)option.hidden=mac&&option.value!==choice;
 }
 $('font-preset').value=choice;
 $('font-import').hidden=!imports;
 $('sf-pro-help').hidden=!imports?.help||!!name;
 $('sf-pro-help').textContent=imports?.help||'';
 $('font-source').hidden=!imports?.source;
 $('font-source').textContent=imports?.source||'';
 $('choose-font').textContent=imports?.choose||'Choose file…';
 $('font-name').textContent=$('font-name').title=name||imports?.empty||'No file selected';
 $('font-preview').hidden=choice!=='geist'&&!previewFace;
 // Default is Zen's own font off macOS, so point those users at the closest SF Pro match.
 const suggest=!!platform&&!mac&&choice==='default';
 $('font-suggestion').hidden=!suggest;
 // Describe the select by the suggestion only while it is shown.
 $('font-preset').setAttribute('aria-describedby',suggest?'font-help font-suggestion-text':'font-help');
}
$('font-preset').addEventListener('change',()=>{
 resetFontChoice();
 fontChoice=$('font-preset').value;
 renderFont();
 status('Font choice updated. Install to apply it.');
});
$('use-sf-pro-family').addEventListener('click',()=>{
 const field=$('font-preset');
 field.value='sf-pro-family';
 field.dispatchEvent(new Event('change'));
 // The button hides with the suggestion, so keep keyboard focus on the select.
 field.focus();
});
$('font-source').addEventListener('click',()=>void execute(async()=>unwrap(await api.openFontSource($('font-preset').value))));
$('choose-font').addEventListener('click',()=>void execute(async()=>{
 const font=unwrap(await api.chooseFont($('font-preset').value));
 if(!font)return;
 clearFontPreview();
 pickedFont=undefined;
 renderFont();
 const face=new FontFace('Zennia Font Preview',new Uint8Array(font.bytes));
 try{await face.load();}catch{throw new Error('This font could not be loaded. Choose another OTF, TTF, or WOFF2 file.');}
 document.fonts.add(face);
 previewFace=face;
 pickedFont=font.name;
 renderFont();
 status(fontChoice==='sf-pro-family'?'SF Pro fonts selected for this installation.':'Font selected for this installation.');
}));
$('installer').addEventListener('submit',event=>{
 event.preventDefault();
 const missing=!selection().installation?'installation':!selection().profile?'profile':null;
 if(missing){showStep(missing==='installation'?'setup':'profile-step');validFolder(missing);return;}
 const choice=fontChoice??installedFontChoice;
 if(FONT_IMPORTS[choice]&&!pickedFont&&!(choice===installedFontChoice&&installedFont)){
  activateReviewTab($('appearance-tab'));
  $('choose-font').focus();
  status(FONT_IMPORTS[choice].missing,true);
  return;
 }
 const request=pickedFont?(choice==='custom'?'selected':choice):fontChoice==='default'?null:fontChoice==='geist'?'geist':undefined;
 void execute(async()=>{
  status('Installing...');
  const result=unwrap(await api.apply('install',selection(),request));
  resetFontChoice();
  status(result.message);
  showStep('complete');
 });
});
$('remove').addEventListener('click',()=>void execute(async()=>{status('Removing...');status(unwrap(await api.apply('remove',selection())).message);resetFontChoice();await refreshVersions();}));
const openZen=()=>void execute(async()=>{unwrap(await api.launch(selection()));status('Zen opened.');});
$('launch').addEventListener('click',openZen);
$('finish').addEventListener('click',openZen);
async function searchForZen(){
 status('Looking for Zen...');
 const info=unwrap(await api.discover());
 await Promise.all([imagesReady,document.fonts.ready]);
 platform=info.platform;
 renderFont();
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
 const update = unwrap(await api.updateSelection());
 try{await searchForZen();}
 catch(error){
  if(!update)throw error;
  status('Automatic discovery failed. Review the supplied folders. '+error.message);
 }
 if(update){
  $('installation').value=update.installation;
  $('profile').value=update.profile;
  showStep('review');
 }
});
