"""Prepare public tabs in the dedicated Arc UI Demo profile through native APIs.

Attach only after creating the separate profile and Work demo Space in Arc.
The script never opens or edits browser profile files.
"""
import argparse
import json
from pathlib import Path
import subprocess
import time

ROOT=Path(__file__).resolve().parents[3]
AX=ROOT/'artifacts/arc-ax'
MARKER='Arc UI Demo'


def apple(code):
    return subprocess.check_output(['osascript','-e',code],text=True).strip()


def outline(window):
    return json.loads(subprocess.check_output([str(AX),'outline',str(window),'18','1800'],text=True))['nodes']


def wait_node(window,predicate,seconds=8):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        matches=[n for n in outline(window) if n.get('visible') and predicate(n)]
        if len(matches)==1:return matches[0]
        time.sleep(.15)
    raise RuntimeError('Expected dedicated Arc native control did not appear uniquely')


def ax(window,command,node,label,value=None):
    args=[str(AX),command,str(window),node['path'],label]
    if value is not None:args.append(value)
    subprocess.run(args,check=True,stdout=subprocess.DEVNULL)


def new_space(window,name):
    subprocess.run([str(AX),'menu-press',str(window),'Spaces','New Space…'],check=True,stdout=subprocess.DEVNULL)
    field=wait_node(window,lambda n:n['role']=='AXTextField' and n.get('value')=='')
    profile=wait_node(window,lambda n:n['role']=='AXButton' and n.get('description','').startswith('Profile,'))
    if profile['description']!='Profile, Arc UI Demo':
        raise RuntimeError('New Space is not assigned to the dedicated Arc UI Demo profile; no personal profile will be used')
    ax(window,'set-value',field,'',name)
    create=wait_node(window,lambda n:n.get('identifier')=='spaceCreationCreateSpaceButton' and n.get('enabled'))
    ax(window,'press',create,'spaceCreationCreateSpaceButton')
    wait_node(window,lambda n:n.get('identifier')=='sidebarSpaceName' and n.get('value')==name)


def new_tab(url):
    result=apple('tell application "Arc" to tell front window to make new tab with properties {URL:'+json.dumps(url)+'}')
    return result.split('tab id ',1)[1].split(' of ',1)[0]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--window-id',type=int,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--space',choices=['Work','Personal','Reading'],required=True)
    args=parser.parse_args()
    apple('tell application "Arc" to activate')
    window=args.window_id
    state=json.loads(args.output.read_text()) if args.output.exists() else {'window_id':window,'profile':MARKER,'spaces':{},'tabs':{}}
    if state['window_id']!=window:raise RuntimeError('Session window ID changed; inspect native state before continuing')
    if args.space in state['spaces']:raise RuntimeError('This Space is already prepared; refusing duplicate tabs')
    name=f'{args.space} · {MARKER}'
    if args.space=='Work':
        wait_node(window,lambda n:n.get('identifier')=='sidebarSpaceName' and n.get('value')==name)
    else:new_space(window,name)
    specs={'Work':[('MDN Web Docs','https://developer.mozilla.org/en-US/'),('CSS','https://developer.mozilla.org/en-US/docs/Web/CSS'),('Zen Browser','https://zen-browser.app/')],
           'Personal':[('Wikipedia','https://en.wikipedia.org/wiki/Main_Page'),('YouTube','https://www.youtube.com/'),('Spotify','https://open.spotify.com/')],
           'Reading':[('Hacker News','https://news.ycombinator.com/'),('NASA Science','https://science.nasa.gov/')]}
    state['spaces'][args.space]=name
    for title,url in specs[args.space]:
        tab=new_tab(url);state['tabs'][title]={'id':tab,'url':url,'space':args.space}
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(state,indent=2)+'\n')
        print(f'Prepared {title} in {args.space}',flush=True)
        time.sleep(.25)
    print(args.output.resolve())


if __name__=='__main__':main()
