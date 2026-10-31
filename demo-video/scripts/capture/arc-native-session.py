"""Helpers for the dedicated, public-data Arc comparison session. Code only."""
import argparse
import json
from pathlib import Path
import subprocess
import time

ROOT=Path(__file__).resolve().parents[3]
AX=ROOT/'artifacts/arc-ax';NATIVE=ROOT/'artifacts/mac-native'
WINDOW=54;AS_WINDOW='6F89B73C-71F2-407B-823F-892B5ACC765A'
SESSION=ROOT/'artifacts/arc-comparison-session.json'


def run(*args,timeout=10):return subprocess.check_output(list(map(str,args)),text=True,timeout=timeout).strip()
def native(*args):
    if args[0]=='click':return run(AX,'click-at',WINDOW,*args[1:])
    if args[0]=='key':
        modifiers={'cmd':'command down','shift':'shift down','option':'option down','control':'control down'}
        code='tell application "System Events" to key code '+str(args[1])
        if len(args)>2:code+=' using {'+','.join(modifiers[m] for m in args[2:])+'}'
        return run('osascript','-e',code,timeout=5)
    return run(NATIVE,*args)
def type_text(value):return run('osascript','-e','tell application "System Events" to keystroke '+json.dumps(value,ensure_ascii=False),timeout=5)
def wake():run(AX,'wake',WINDOW);run(AX,'dismiss-menus',WINDOW);native('key',53);time.sleep(.3)
def apple(code):return run('osascript','-e','tell application "Arc" to tell window id '+json.dumps(AS_WINDOW)+'\n'+code+'\nend tell',timeout=6)
def focus(space):
    name=space+' · Arc UI Demo'
    menu('Spaces',name)
    time.sleep(.3)
def select(title):
    state=json.loads(SESSION.read_text());tab=state['tabs'][title]
    focus(tab['space'])
    prefixes={'CSS':'CSS: Cascading Style Sheets','Wikipedia':'Wikipedia','Hacker News':'Hacker News','Zen Browser':'Zen Browser','MDN Web Docs':'Web APIs'}
    prefix=prefixes.get(title,title)
    if title=='CSS' and not any(n.get('role')=='AXButton' and (n.get('title','').startswith(prefix) or n.get('identifier','').startswith(prefix)) for n in visible()):
        f=find(lambda n:n.get('value')=='Web development');path='.'.join(f['path'].split('.')[:-2]);run(AX,'disclose',WINDOW,path,'Web development','true')
    for _ in range(9):
        if any(n.get('role')=='AXWebArea' and prefix in n.get('title','') for n in visible()):return
        menu('Tabs','Next Tab');time.sleep(.2)
    raise RuntimeError('Public demo tab did not activate through native Next Tab')
def nodes():
    for attempt in range(4):
        try:return json.loads(run(AX,'outline',WINDOW,20,4000))['nodes']
        except subprocess.CalledProcessError:
            if attempt==3:raise
            time.sleep(.12)
def visible():return [n for n in nodes() if n.get('visible')]
def label(n):return n.get('title') or n.get('description') or n.get('value') or n.get('identifier') or ''
def find(predicate,seconds=3):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        matches=[n for n in visible() if predicate(n)]
        if len(matches)==1:return matches[0]
        time.sleep(.1)
    raise RuntimeError('Native control not uniquely available')
def press(n):
    for attempt in range(3):
        try:
            if 'AXPress' in n.get('actions',[]) or any(a.startswith('Name:press') for a in n.get('actions',[])):run(AX,'press',WINDOW,n['path'],label(n))
            else:
                b=n['bounds'];native('click',b['x']+b['width']/2,b['y']+b['height']/2)
            return
        except subprocess.CalledProcessError:
            if attempt==2:raise
            name=label(n);role=n['role'];time.sleep(.15);n=find(lambda node:node['role']==role and label(node)==name)
def menu(*labels):
    result=run(AX,'menu-press',WINDOW,*labels)
    run(AX,'dismiss-menus',WINDOW)
    return result
def summary():
    return [{k:n[k] for k in ('path','role','title','description','value','identifier','bounds','selected') if k in n}
            for n in visible() if label(n) or n.get('role') in ('AXDialog','AXSheet','AXTextField')]


def prepare_folder():
    select('CSS')
    if any(n.get('value')=='Web development' or n.get('title')=='Web development' for n in visible()):
        print('Folder already exists');return
    try:
        menu('Tabs','New Folder…')
        field=find(lambda n:n['role']=='AXTextField')
        run(AX,'set-value',WINDOW,field['path'],label(field),'Web development')
        create=find(lambda n:n['role']=='AXButton' and n.get('description')=='Create')
        press(create);time.sleep(.4)
        print(json.dumps(summary(),ensure_ascii=False))
    except Exception:
        native('key',53);native('key',53);raise


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['inspect','prep-folder','work','menus','screenshot'])
    args=parser.parse_args();wake()
    if args.command=='prep-folder':prepare_folder()
    elif args.command=='work':select('CSS');print(json.dumps(summary(),ensure_ascii=False))
    elif args.command=='menus':
        data=json.loads(run(AX,'menu-list',WINDOW,8,3000))
        print(json.dumps([n for n in data['nodes'] if n.get('title') and n['path'].startswith(('menu.2.','menu.4.','menu.6.','menu.7.','menu.9.0.1'))],ensure_ascii=False))
    elif args.command=='screenshot':
        path=ROOT/'artifacts/arc-current.png';subprocess.run(['screencapture','-x','-o','-l',str(WINDOW),str(path)],check=True);print(path)
    else:print(json.dumps(summary(),ensure_ascii=False))


if __name__=='__main__':main()
