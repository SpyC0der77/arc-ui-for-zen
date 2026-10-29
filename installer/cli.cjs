#!/usr/bin/env node
'use strict';
const engine=require('./engine.cjs');
const {launch}=require('./launch.cjs');
const HELP=`Arc UI for Zen
Usage: node installer/cli.cjs <discover|install|remove|open> [options]

  --installation <folder>  Zen application folder
  --profile <folder>       Zen profile containing prefs.js
  --open                   Open Zen after a successful install
  --help                   Show this help

Close Zen before install or remove. Existing installations must be removed
before reinstalling. This CLI installs Arc UI into an existing Zen browser.
Omitted folders are selected automatically only when discovery is unambiguous.`;
function parse(args){
 const options={};let command;
 for(let i=0;i<args.length;i++){
  const arg=args[i];
  if(['--help','-h'].includes(arg))options.help=true;
  else if(arg==='--open')options.open=true;
  else if(['--installation','--profile'].includes(arg)){
   if(!args[i+1]||args[i+1].startsWith('--'))throw new Error('Missing value for '+arg);
   const key=arg.slice(2);if(options[key])throw new Error('Repeated option '+arg);
   options[key]=args[++i];
  }else if(arg.startsWith('-'))throw new Error('Unknown option '+arg);
  else if(command)throw new Error('Unexpected argument '+arg);
  else command=arg;
 }
 if(options.help||!command)return {help:true};
 if(!['discover','install','remove','open'].includes(command))throw new Error('Unknown command '+command);
 if(options.open&&command!=='install')throw new Error('--open is only supported with install.');
 return {command,...options};
}
async function main(args,api={...engine,launch},write=console.log){
 const options=parse(args);if(options.help){write(HELP);return;}
 const info=await api.discover();
 if(options.command==='discover'){write(JSON.stringify(info,null,2));return;}
 const installation=options.installation||(info.apps.length===1?info.apps[0]:null);
 const profile=options.profile||(info.profiles.length===1?info.profiles[0].path:null);
 if(!installation||!profile)throw new Error('Specify --installation and --profile where discovery has zero or multiple matches. Run discover to list folders.');
 if(options.command==='open'){await api.launch(installation,profile);write('Zen opened.');return;}
 write((await api[options.command](installation,profile)).message);
 if(options.open){await api.launch(installation,profile);write('Zen opened.');}
}
if(require.main===module)main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={parse,main};
