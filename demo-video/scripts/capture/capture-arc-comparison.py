"""Reproducible native Arc takes for the dedicated Arc UI Demo session.

All screenshots are from CG window 515; native AppleScript/AX/input only.
The dedicated profile and public tabs must already be prepared. Each take
records a measured native UI checkpoint; no recreation, personal profile reads,
or guessed readiness. Run short --shots batches to keep host focus throughout.
"""
import argparse
import concurrent.futures
import importlib.util
import json
import math
from pathlib import Path
import re
import subprocess
import tempfile
import time

SPEC=importlib.util.spec_from_file_location('session',Path(__file__).with_name('arc-native-session.py'))
S=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(S)
ROOT=S.ROOT;OUT=ROOT/'demo-video/recordings/comparison/arc-native-04'
META=ROOT/'demo-video/recordings/comparison/arc-04.json'
SX,SY=1920/1592,1080/896
REPLACE=False


def button(title):return any(n.get('role')=='AXButton' and (n.get('title')==title or n.get('identifier')==title) for n in S.visible())
def space(name):return any(n.get('identifier')=='sidebarSpaceName' and n.get('value')==name+' · Arc UI Demo' for n in S.visible())
def page(title):return any(n.get('role')=='AXWebArea' and title in n.get('title','') for n in S.visible())
def sidebar_width():
    areas=[n['bounds']['width'] for n in S.visible() if n['role']=='AXScrollArea' and n.get('bounds',{}).get('x',999)<100 and n['bounds']['height']>500 and n['bounds']['width']<500]
    return areas[0] if areas else 0
def folder():return S.find(lambda n:n.get('value')=='Web development')
def set_folder(expanded):
    n=folder();path='.'.join(n['path'].split('.')[:-2]);S.run(S.AX,'disclose',S.WINDOW,path,'Web development',str(expanded).lower())
    S.native('move',780,480)
def sidebar_toggle():
    n=S.find(lambda n:n.get('description') in ('Hide sidebar','Show sidebar'));S.press(n);S.native('move',780,480)
def resize(to):
    current=sidebar_width();S.native('drag',80+current,530,80+to,530,.4)
def command(query):
    S.native('key',53)
    S.menu('File','Open Command Bar')
    field=S.find(lambda n:n.get('identifier')=='commandBarTextField')
    S.run(S.AX,'set-value',S.WINDOW,field['path'],S.label(field),query)
def command_ready(query):return any(n.get('identifier')=='commandBarTextField' and n.get('value')==query for n in S.visible())
def webareas():return [n for n in S.visible() if n.get('role')=='AXWebArea']
def split(horizontal=False):
    S.native('key',53)
    if horizontal:
        command('Add Top Split');S.native('key',36)
    else:S.menu('View','Add Split View')
    field=S.find(lambda n:n.get('identifier')=='commandBarTextField')
    S.run(S.AX,'set-value',S.WINDOW,field['path'],S.label(field),'https://developer.mozilla.org/en-US/')
    S.native('key',36)
def split_ready(horizontal=False):
    areas=webareas()
    if len(areas)!=2:return False
    return abs(areas[0]['bounds']['y']-areas[1]['bounds']['y'])>100 if horizontal else abs(areas[0]['bounds']['x']-areas[1]['bounds']['x'])>100
def unsplit():S.native('key',53);S.menu('View','Separate Page from Split View')
def library_nodes():return S.visible()
def is_library(ns):return any(n.get('description')=='Archived Tabs' for n in ns)
def library_safe():
    ns=library_nodes()
    if not is_library(ns):return True
    if any(n.get('value') in ('Coding','School') or n.get('title') in ('Coding','School') for n in ns):return False
    own_grid=any(n['role']=='AXStaticText' and 'AXScrollToVisible' in n.get('actions',[]) and ('Arc UI Demo' in n.get('value','') or 'ArcUIDemo' in n.get('value','')) for n in ns)
    for n in ns:
        value=n.get('value','')
        if n['role']=='AXImage' and 'AXScrollToVisible' in n.get('actions',[]) and not own_grid:return False
        if n['role']=='AXStaticText' and n.get('actions')==['AXScrollToVisible'] and value:
            if not ('Arc UI Demo' in value or 'ArcUIDemo' in value or value.startswith(('JPEG','JPG','PNG','Image','File from','file:','No results'))):return False
    return any(n['role']=='AXTextField' and n.get('value')=='Arc UI Demo' for n in ns)
def library(kind):
    ns=library_nodes()
    opened=not is_library(ns)
    if opened:S.press(S.find(lambda n:n['role']=='AXButton' and n.get('description')=='Home'));time.sleep(.4)
    S.press(S.find(lambda n:n.get('role')=='AXButton' and n.get('description')==kind))
    time.sleep(.4)
    if kind!='Spaces':
        field=S.find(lambda n:n.get('role')=='AXTextField' and n.get('bounds',{}).get('y',999)<140)
        if field.get('value')!='Arc UI Demo':
            S.run(S.AX,'focus-node',S.WINDOW,field['path'],S.label(field));S.run(S.AX,'set-value',S.WINDOW,field['path'],S.label(field),'Arc UI Demo');S.native('key',0,'cmd');S.type_text('Arc UI Demo')
def spaces_crop():
    data=json.loads(S.run(S.AX,'outline',S.WINDOW,20,4000));ns=[n for n in data['nodes'] if n.get('visible')]
    if not data['frontmost']:return None
    names=[n for n in ns if n.get('value','') in ('Work · Arc UI Demo','Personal · Arc UI Demo','Reading · Arc UI Demo') and n.get('identifier')=='sidebarSpaceName']
    if len(names)!=3:return None
    parents={'.'.join(n['path'].split('.')[:-1]) for n in names}
    cards=[n['bounds'] for n in ns if n['path'] in parents and n['role']=='AXGroup']
    if len(cards)!=3:return None
    x=min(b['x'] for b in cards);y=min(b['y'] for b in cards);right=max(b['x']+b['width'] for b in cards);bottom=max(b['y']+b['height'] for b in cards)
    if not (80<=x<right<=1672 and 80<=y<bottom<=976):return None
    for n in ns:
        if n.get('value') in ('Coding','School') or n.get('title') in ('Coding','School'):
            b=n['bounds']
            if b['x']<right and b['x']+b['width']>x and b['y']<bottom and b['y']+b['height']>y:return None
    return tuple(round(v) for v in (x,y,right-x,bottom-y))
def downloads_crop():
    # Arc's global recent-download popover can contain unrelated personal
    # entries. Capture only the three verified demo rows and the dock below.
    ns=S.visible(); crop=(80,770,264,206)
    rows=[n for n in ns if n.get('role')=='AXButton' and n.get('description','').startswith('Download —') and n.get('bounds',{}).get('width',0)>200]
    visible=[n for n in rows if n['bounds']['y'] < 976 and n['bounds']['y']+n['bounds']['height'] > 770]
    if len(visible)!=3 or any('Arc UI Demo' not in n['description'] or n['bounds']['y']<770 for n in visible):return None
    return crop
def library_ready(kind):
    if kind=='Spaces':return spaces_crop() is not None
    ns=library_nodes()
    if not is_library(ns) or not any(n['role']=='AXTextField' and n.get('value')=='Arc UI Demo' for n in ns):return False
    return any(n.get('description')==kind and n.get('role')=='AXButton' for n in ns)
def close_library():
    back=S.find(lambda n:n['role']=='AXButton' and n.get('description')=='' and n.get('bounds',{}).get('x',999)<120 and n['bounds']['y']>900)
    S.press(back)


def take(name,action,predicate,target=(1320,780),camera=(0,0,720,1080),availability='native',notes='',caption=''):
    OUT.mkdir(parents=True,exist_ok=True)
    identifier=re.sub('[^a-z0-9]+','-',name.lower()).strip('-')
    output=OUT/(identifier+'.mp4')
    if output.exists():
        existing=json.loads(META.read_text()) if META.exists() else {'shots':[]}
        if any(s['id']==identifier for s in existing['shots']):
            if not REPLACE:raise RuntimeError('Refusing overwrite: '+str(output))
            existing['shots']=[s for s in existing['shots'] if s['id']!=identifier];META.write_text(json.dumps(existing,indent=2)+'\n')
        if identifier in ('library-downloads','media-library','library-spaces','boosts-library','return-from-library'):
            output.unlink()
            if output.with_suffix('.png').exists():output.with_suffix('.png').unlink()
        else:output.rename(output.with_suffix('.failed-'+str(int(time.time()))+'.mp4'))
    S.run(S.AX,'wake',S.WINDOW)
    S.run(S.AX,'dismiss-menus',S.WINDOW)
    names=[n.get('value') for n in S.visible() if n.get('identifier')=='sidebarSpaceName']
    if names and any(n not in ('Work · Arc UI Demo','Personal · Arc UI Demo','Reading · Arc UI Demo') for n in names):
        raise RuntimeError('Refusing capture outside the dedicated demo Spaces')
    previous=(1450,800)
    S.native('move',80+previous[0],80+previous[1])
    started=time.monotonic();frame=0;ready=None;quiet=None;last=None
    track=[[0,round(previous[0]*SX),round(previous[1]*SY)]]
    cropped=name in ('Library Spaces','Downloads hover menu')
    crop_for_shot=spaces_crop if name=='Library Spaces' else downloads_crop
    if name=='Downloads hover menu':
        vf='scale=720:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x101218,fps=30'
    else:
        vf='scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x101218,fps=30' if cropped else 'scale=1920:1080:flags=lanczos,fps=30'
    ff=subprocess.Popen(['ffmpeg','-y','-hide_banner','-loglevel','error','-f','image2pipe','-framerate','20','-vcodec','png','-i','-','-vf',vf,'-c:v','libx264','-preset','fast','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',str(output)],stdin=subprocess.PIPE)
    def perform():
        begin=time.monotonic()
        for i in range(11):
            u=i/10;smooth=u*u*(3-2*u)
            x=previous[0]+(target[0]-previous[0])*smooth;y=previous[1]+(target[1]-previous[1])*smooth
            S.native('move',80+x,80+y)
            delay=begin+(i+1)*.035-time.monotonic()
            if delay>0:time.sleep(delay)
        action()
        return time.monotonic()-started
    success=False
    protected=name in ('Library downloads','Library Spaces','Media library','Boosts library','Archive library','Downloads hover menu')
    try:
        with tempfile.TemporaryDirectory(prefix='arc-take-') as temp,concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future=pool.submit(perform);image=Path(temp)/'frame.png'
            while ready is None or time.monotonic()-started<ready+.3:
                if time.monotonic()-started>15:raise RuntimeError('Native checkpoint did not settle: '+name)
                if future.done():
                    future.result()
                    if predicate() and (not protected or cropped or library_safe()):
                        if quiet is None:quiet=time.monotonic()
                        if time.monotonic()-quiet>=.2 and ready is None:ready=time.monotonic()-started
                    else:quiet=None
                crop=crop_for_shot() if cropped else None
                allowed=crop is not None if cropped else (not protected or library_safe())
                if allowed:
                    capture=['screencapture','-x','-o']+(['-R',','.join(map(str,crop))] if cropped else ['-l',str(S.WINDOW)])+[str(image)]
                    subprocess.run(capture,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=5)
                    current=image.read_bytes()
                elif last:current=last
                else:
                    time.sleep(.05);continue
                due=math.floor((time.monotonic()-started)*20)+1
                pointer=json.loads(S.run(S.AX,'pointer'))
                if cropped and crop:
                    scale=min((720 if name=='Downloads hover menu' else 1920)/crop[2],1080/crop[3]);px=(pointer['x']-crop[0])*scale+(1920-crop[2]*scale)/2;py=(pointer['y']-crop[1])*scale+(1080-crop[3]*scale)/2
                else:px=(pointer['x']-80)*SX;py=(pointer['y']-80)*SY
                track.append([time.monotonic()-started,round(px),round(py)])
                while frame<due-1:ff.stdin.write(last or current);frame+=1
                ff.stdin.write(current);frame+=1;last=current
                delay=started+frame/20-time.monotonic()
                if delay>0:time.sleep(delay)
            (OUT/(identifier+'.png')).write_bytes(last)
            success=True
    finally:
        ff.stdin.close();status=ff.wait()
    if not success or status:raise RuntimeError('Incomplete Arc take: '+name)
    cursor=OUT/(identifier+'-cursor.json')
    cursor.write_text(json.dumps({'image':str(ROOT/'demo-video/assets/cursor.png'),'positions':track},indent=2)+'\n')
    shot={'id':identifier,'name':name,'source':str(output),'start':0,'end':frame/20,'ready':math.ceil(ready*30)/30,'camera':list(camera),'cursor_track':str(cursor),'availability':availability,'notes':notes}
    if name=='Library Spaces':shot.update(camera=[440,0,720,1080],caption='Native Spaces · demo region',notes='Only the three dedicated demo Space cards were captured directly with screencapture -R after foreground/bounds/privacy checks; global personal Spaces never entered a PNG.')
    if name=='Downloads hover menu':shot.update(camera=[600,0,720,1080],caption='Recent demo downloads',notes='Only the verified demo rows and dock were captured; unrelated recent downloads were excluded before capture.')
    if caption:shot['caption']=caption
    data=json.loads(META.read_text()) if META.exists() else {'fps':30,'width':1920,'height':1080,'shots':[]}
    if any(s['id']==identifier for s in data['shots']):raise RuntimeError('Duplicate metadata: '+name)
    data['shots'].append(shot);META.write_text(json.dumps(data,indent=2)+'\n')
    print('RECORDED '+name+' ready='+str(shot['ready'])+' duration='+str(shot['end']),flush=True)


def basic():
    return [
      ('Work space, Essentials and real documentation',lambda:S.select('CSS'),lambda:space('Work') and page('CSS'),(1450,800)),
      ('Collapsed folder',lambda:set_folder(False),lambda:not button('CSS: Cascading Style Sheets'),(106,245)),
      ('Expanded folder',lambda:set_folder(True),lambda:button('CSS: Cascading Style Sheets'),(106,245)),
      ('Personal Space',lambda:S.focus('Personal'),lambda:space('Personal') and page('Wikipedia'),(130,870)),
      ('Reading Space',lambda:S.focus('Reading'),lambda:space('Reading') and page('Hacker News'),(164,870)),
      ('Back to Work',lambda:S.focus('Work'),lambda:space('Work') and page('CSS'),(97,870)),
      ('Undock the sidebar',sidebar_toggle,lambda:sidebar_width()==0,(93,23)),
      ('Hover peek',lambda:S.native('move',81,480),lambda:sidebar_width()>0,(1,400)),
      ('Full page with hidden sidebar',lambda:S.native('move',780,480),lambda:sidebar_width()==0,(700,400)),
      ('Dock the sidebar',lambda:S.menu('View','Show Sidebar'),lambda:sidebar_width()>0,(93,23)),
      ('Resize sidebar',lambda:resize(320),lambda:abs(sidebar_width()-320)<3,(264,450)),
      ('Restore sidebar width',lambda:resize(264),lambda:abs(sidebar_width()-264)<3,(320,450)),
    ]


def main():
    global REPLACE
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--shots',nargs='+',type=int,required=True)
    parser.add_argument('--replace',action='store_true',help='Quarantine an earlier take and replace its metadata with a newly verified native recording')
    args=parser.parse_args()
    REPLACE=args.replace
    for prefix in ('library-downloads','media-library','library-spaces','boosts-library','return-from-library'):
        for invalid in OUT.glob(prefix+'.failed-*.mp4'):invalid.unlink()
    center=(600,0,720,1080)
    features=basic()+[
      ('Centered command bar',lambda:command('split'),lambda:command_ready('split'),(1320,780),center),
      ('Side by side split view',split,split_ready,(1320,780),center),
      ('Unsplit command',lambda:command('Separate Page from Split View'),lambda:command_ready('Separate Page from Split View'),(1320,780),center),
      ('Return to one page',unsplit,lambda:len(webareas())==1,(1320,780),center),
      ('Horizontal split command',lambda:command('Add Top Split'),lambda:command_ready('Add Top Split'),(1320,780),center),
      ('Top to bottom split',lambda:split(True),lambda:split_ready(True),(1320,780),center),
      ('Unsplit horizontal view',unsplit,lambda:len(webareas())==1,(1320,780),center),
      ('Downloads command',lambda:command('downloads'),lambda:command_ready('downloads'),(1320,780),center),
      ('Library downloads',lambda:library('Downloads'),lambda:library_ready('Downloads'),(55,313)),
      ('Library Spaces',lambda:library('Spaces'),lambda:library_ready('Spaces'),(55,523)),
      ('Media library',lambda:library('Media'),lambda:library_ready('Media'),(55,220)),
      ('Return from library',close_library,lambda:not is_library(S.visible()),(22,875)),
    ]
    features += [None]*12
    features[29]=('Boosts library',lambda:library('Boosts'),lambda:library_ready('Boosts'),(55,600))
    for index in args.shots:
        if features[index] is None:raise RuntimeError('Native feature recipe is not yet verified: '+str(index))
        take(*features[index])


if __name__=='__main__':main()
