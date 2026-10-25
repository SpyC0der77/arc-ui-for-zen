const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('zenInstaller',Object.freeze({
  discover:()=>ipcRenderer.invoke('arc:discover'),
  chooseFolder:()=>ipcRenderer.invoke('arc:folder'),
  apply:(action,selection)=>ipcRenderer.invoke('arc:apply',action,selection),
  launch:selection=>ipcRenderer.invoke('arc:launch',selection),
}));
