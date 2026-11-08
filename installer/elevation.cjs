'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const FLAG='--arc-elevated-operation';
const psQuote=value=>"'"+value.replace(/'/g,"''")+"'";
// Start-Process joins ArgumentList, so quote each argument for CommandLineToArgvW.
function winQuote(value){return '"'+value.replace(/(\\*)"/g,'$1$1\\"').replace(/(\\+)$/,'$1$1')+'"';}
function elevationScript(executable,args){
 return `$ErrorActionPreference='Stop'; try { $p=Start-Process -FilePath ${psQuote(executable)} -ArgumentList ${psQuote(args.map(winQuote).join(' '))} -Verb RunAs -Wait -PassThru; exit $p.ExitCode } catch { if ($_.Exception.NativeErrorCode -eq 1223 -or $_.Exception.InnerException.NativeErrorCode -eq 1223) { exit 1223 }; [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;
}
async function elevate(action,installation,profile,{executable=process.execPath,appPath,packaged=false,run=promisify(execFile)}={}){
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'arc-elevation-'));
 const resultFile=path.join(folder,'result.json');
 try{
  const args=[...(packaged?[]:[appPath]),FLAG,action,path.resolve(installation),path.resolve(profile),resultFile];
  const script=elevationScript(executable,args);
  let failure;
  try{await run(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true});}
  catch(error){failure=error;}
  if(failure?.code===1223)throw new Error('Administrator permission was declined. Try again and approve the Windows prompt to continue.');
  let result;
  try{result=JSON.parse(await fs.readFile(resultFile,'utf8'));}
  catch{throw new Error('The administrator operation did not complete. '+(failure?.stderr?.trim()||'Try again and approve the Windows prompt.'));}
  if(!result.ok)throw new Error(result.error);
  return result.value;
 }finally{await fs.rm(folder,{recursive:true,force:true});}
}
async function apply(action,installation,profile,{engine,platform=process.platform,elevate:request=elevate,...settings}){
 if(!['install','remove'].includes(action))throw new Error('Unknown operation.');
 try{return await engine[action](installation,profile);}
 catch(error){
  if(platform!=='win32'||!['EACCES','EPERM'].includes(error.code))throw error;
  return request(action,installation,profile,settings);
 }
}
async function worker(args,engine){
 const [action,installation,profile,resultFile]=args;
 if(args.length!==4||!['install','remove'].includes(action)||![installation,profile,resultFile].every(p=>typeof p==='string'&&path.isAbsolute(p)))throw new Error('Invalid administrator operation.');
 let result;
 try{result={ok:true,value:await engine[action](installation,profile)};}
 catch(error){result={ok:false,error:error.message};}
 await fs.writeFile(resultFile,JSON.stringify(result),{flag:'wx',mode:0o600});
 return result.ok?0:1;
}
module.exports={FLAG,apply,elevate,worker,elevationScript,winQuote};
