const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('zenInstaller',Object.freeze({
  discover:()=>ipcRenderer.invoke('zennia:discover'),
  updateSelection:()=>ipcRenderer.invoke('zennia:update-selection'),
  inspect:selection=>ipcRenderer.invoke('zennia:inspect',selection),
  chooseFolder:()=>ipcRenderer.invoke('zennia:folder'),
  apply:(action,selection)=>ipcRenderer.invoke('zennia:apply',action,selection),
  launch:selection=>ipcRenderer.invoke('zennia:launch',selection),
}));
