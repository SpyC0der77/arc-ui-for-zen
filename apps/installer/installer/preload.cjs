const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('zenInstaller',Object.freeze({
  discover:()=>ipcRenderer.invoke('zennia:discover'),
  updateSelection:()=>ipcRenderer.invoke('zennia:update-selection'),
  inspect:selection=>ipcRenderer.invoke('zennia:inspect',selection),
  chooseFolder:()=>ipcRenderer.invoke('zennia:folder'),
  openFontSource:preset=>ipcRenderer.invoke('zennia:font-source',preset),
  chooseFont:preset=>ipcRenderer.invoke('zennia:font',preset),
  apply:(action,selection,fontChoice)=>ipcRenderer.invoke('zennia:apply',action,selection,fontChoice),
  launch:selection=>ipcRenderer.invoke('zennia:launch',selection),
}));
