'use strict';
const {spawn}=require('node:child_process');
const engine=require('./engine.cjs');
async function launch(installation,profile){
 const target=await engine.validate(installation,profile,{checkClosed:async()=>{},requireVersion:false});
 const child=spawn(target.exe,['-purgecaches','-profile',target.profile],{detached:true,stdio:'ignore',windowsHide:false});
 await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
 child.unref();return true;
}
module.exports={launch};
