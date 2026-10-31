'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);

async function indexedApplications(platform,runCommand=run) {
  if(platform!=='darwin')return [];
  try {
    const {stdout}=await runCommand('mdfind',["kMDItemCFBundleIdentifier == 'app.zen-browser.zen'"],{timeout:4000,maxBuffer:2*1024*1024});
    return stdout.split('\n').map(p=>p.trim()).filter(p=>p.endsWith('.app'));
  } catch {return [];}
}

function applicationDirectories(platform,home,env) {
  if(platform==='darwin')return ['/Applications',path.join(home,'Applications')];
  if(platform==='win32')return [env.ProgramFiles,env['ProgramFiles(x86)'],path.join(env.LOCALAPPDATA||path.join(home,'AppData','Local'),'Programs'),env.LOCALAPPDATA||path.join(home,'AppData','Local'),path.join(home,'Desktop'),path.join(home,'Downloads')].filter(Boolean);
  return ['/opt','/usr/lib',path.join(home,'.local','opt'),path.join(home,'Applications')];
}
async function scanApplications(directories,platform) {
  const exe=platform==='win32'?'zen.exe':platform==='darwin'?'Contents/MacOS/zen':'zen';
  const groups=await Promise.all(directories.map(async directory=>{
    const entries=await fs.readdir(directory,{withFileTypes:true}).catch(()=>[]);
    const found=await Promise.all(entries.filter(e=>e.isDirectory()&&(platform!=='darwin'||e.name.endsWith('.app'))).map(async e=>{
      const folder=path.join(directory,e.name);
      return await fs.access(path.join(folder,exe)).then(()=>folder,()=>null);
    }));
    return found.filter(Boolean);
  }));
  return groups.flat();
}
async function profileFromCommand(command) {
  const match=/(?:^|\s)--?profile(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(.+?)(?=\s+--?[\w-]+(?:\s|$)|$))/i.exec(command.trim());
  if(!match)return null;
  let candidate=(match[1]||match[2]||match[3]).trim();
  // ps does not preserve argument quotes. Validate the longest existing profile
  // prefix so paths containing spaces and trailing launch URLs work too.
  while(candidate){
    if(path.isAbsolute(candidate)&&await fs.access(path.join(candidate,'prefs.js')).then(()=>true,()=>false))return candidate;
    const end=candidate.lastIndexOf(' ');if(end<0)break;candidate=candidate.slice(0,end);
  }
  return null;
}
async function runningInstances(platform,runCommand=run) {
  const options={timeout:4000,maxBuffer:2*1024*1024,windowsHide:true};
  try {
    let processes;
    if(platform==='win32') {
      const {stdout}=await runCommand('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Get-CimInstance Win32_Process -Filter \"Name='zen.exe'\" | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress"],options);
      const data=stdout.trim()?JSON.parse(stdout):[];
      processes=(Array.isArray(data)?data:[data]).filter(p=>p.ExecutablePath).map(p=>({pid:p.ProcessId,exe:p.ExecutablePath,command:p.CommandLine||''}));
    } else {
      const {stdout}=await runCommand('ps',['-axo','pid=,comm='],options);
      const entries=stdout.split('\n').map(line=>line.match(/^\s*(\d+)\s+(.+?)\s*$/)).filter(m=>m&&/(?:^|\/)zen(?:-bin)?$/i.test(m[2])).slice(0,32);
      processes=await Promise.all(entries.map(async m=>({pid:Number(m[1]),exe:m[2],command:await runCommand('ps',['-p',m[1],'-o','args='],options).then(r=>r.stdout,()=> '')})));
    }
    return await Promise.all(processes.map(async p=>({pid:p.pid,app:platform==='darwin'?p.exe.split('/Contents/')[0]:path.dirname(p.exe),profile:await profileFromCommand(p.command)})));
  } catch {return [];}
}
module.exports={applicationDirectories,scanApplications,profileFromCommand,runningInstances,indexedApplications};
