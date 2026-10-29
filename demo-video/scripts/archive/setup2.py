import sys,time,base64,json
from pathlib import Path
sys.path.insert(0,'artifacts/test-python')
from marionette_driver.marionette import Marionette
m=Marionette('localhost',port=2828,socket_timeout=60);m.start_session();m.set_context('chrome')
icons={n:'data:image/svg+xml;base64,'+base64.b64encode(Path('artifacts/product-demo/'+f+'.svg').read_bytes()).decode() for n,f in [('Work','briefcase-business'),('Personal','house'),('Reading','book-open')]}
print(m.execute_async_script('''const icons=arguments[0],done=arguments[arguments.length-1];(async()=>{for(const s of gZenWorkspaces.getWorkspaces()){s.icon=icons[s.name];gZenWorkspaces.saveWorkspace(s)};window.demoSpaces=Object.fromEntries(gZenWorkspaces.getWorkspaces().map(s=>[s.name,s.uuid]));window.demoTabs=[];const specs=[['GitHub','https://github.com/','Work'],['MDN Web Docs','https://developer.mozilla.org/en-US/','Work'],['CSS','https://developer.mozilla.org/en-US/docs/Web/CSS','Work'],['Zen Browser','https://zen-browser.app/','Work'],['Wikipedia','https://en.wikipedia.org/wiki/Main_Page','Personal'],['YouTube','https://www.youtube.com/','Personal'],['Spotify','https://open.spotify.com/','Personal'],['Hacker News','https://news.ycombinator.com/','Reading'],['NASA Science','https://science.nasa.gov/','Reading']];for(const [title,url,space] of specs){await gZenWorkspaces.changeWorkspaceWithID(demoSpaces[space]);const tab=gBrowser.addTab(url,{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal(),skipAnimation:true});demoTabs.push({tab,title,url,space});await new Promise(r=>setTimeout(r,300))}await gZenWorkspaces.changeWorkspaceWithID(demoSpaces.Work);gBrowser.selectedTab=demoTabs[1].tab;done(true)})().catch(e=>done(String(e)))''',script_args=[icons]));time.sleep(18)
print(m.execute_script('return demoTabs.map(t=>({title:t.tab.label,url:t.tab.linkedBrowser?.currentURI?.spec}))'))
print(m.execute_script('return [outerWidth,outerHeight,innerWidth,innerHeight]'))
Path('artifacts/product-demo/setup2.png').write_bytes(base64.b64decode(m.screenshot()));m.delete_session()

