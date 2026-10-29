import sys,json,time,base64
from pathlib import Path
sys.path.insert(0,'artifacts/test-python')
from marionette_driver.marionette import Marionette
m=Marionette('localhost',port=2828,socket_timeout=60);m.start_session();m.set_context('chrome')
js=r'''
const done=arguments[arguments.length-1];(async()=>{
const work=gZenWorkspaces.getWorkspaces()[0];work.name='Work';work.icon='💼';gZenWorkspaces.saveWorkspace(work);
const personal=await gZenWorkspaces.createAndSaveWorkspace('Personal','🏡',false,0);
const reading=await gZenWorkspaces.createAndSaveWorkspace('Reading','📚',false,0);
await gZenWorkspaces.changeWorkspaceWithID(work.uuid);
const specs=[['GitHub','https://github.com/','Work'],['MDN Web Docs','https://developer.mozilla.org/en-US/','Work'],['CSS: Cascading Style Sheets','https://developer.mozilla.org/en-US/docs/Web/CSS','Work'],['Zen Browser','https://zen-browser.app/','Work'],['Wikipedia','https://en.wikipedia.org/wiki/Main_Page','Personal'],['YouTube','https://www.youtube.com/','Personal'],['Spotify','https://open.spotify.com/','Personal'],['Hacker News','https://news.ycombinator.com/','Reading'],['NASA Science','https://science.nasa.gov/','Reading']];
window.demoTabs=[];window.demoSpaces={Work:work.uuid,Personal:personal.uuid,Reading:reading.uuid};
for(const [title,url,space] of specs){const tab=gBrowser.addTab(url,{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal(),skipAnimation:true});gZenWorkspaces.moveTabToWorkspace(tab,demoSpaces[space]);demoTabs.push({tab,title,url,space});}
gZenFolders.createFolder(demoTabs.filter(t=>t.title.includes('MDN')||t.title.startsWith('CSS')).map(t=>t.tab),{label:'Web development',workspaceId:work.uuid,renameFolder:false,collapsed:false});
gZenPinnedTabManager.addToEssentials(demoTabs[0].tab);
await gZenWorkspaces.changeWorkspaceWithID(work.uuid);gBrowser.selectedTab=demoTabs[1].tab;
for(const tab of [...gBrowser.tabs])if(tab.linkedBrowser.currentURI.spec==='about:blank')gBrowser.removeTab(tab,{animate:false});
const style=document.createElementNS('http://www.w3.org/1999/xhtml','style');style.textContent='#remote-control-box{display:none!important}';document.documentElement.append(style);
done(true);
})().catch(e=>done({error:String(e),stack:e.stack}));
'''
print(m.execute_async_script(js));time.sleep(12)
Path('artifacts/product-demo/setup.png').write_bytes(base64.b64decode(m.screenshot()))
print(m.execute_script('return demoTabs.map(t=>({title:t.tab.label,url:t.tab.linkedBrowser.currentURI.spec,icon:t.tab.image}))'))
m.delete_session()
