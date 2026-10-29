import json,math
from pathlib import Path
DEMO=Path(__file__).resolve().parents[1]
OUT=DEMO/'timeline'; edit=json.loads((OUT/'edit.json').read_text())
# Positions are authored against the actual 1592 x 896 browser captures.
sx,sy=1920/1592,1080/896
p=lambda x,y:(round(x*sx),round(y*sy))
park=p(1450,800)
# For keyboard commands, keep the arrow clear of the command text.
tracks={
'browser.mp4':[(0,park),(10.5,p(130,870)),(14,p(164,870)),(17.5,p(97,870)),(21,p(22,25)),(24.5,p(1,400)),(28,p(700,400)),(31.5,p(22,25)),(35,p(1320,780)),(38.5,p(1320,780)),(42.5,p(1320,780)),(46,p(1320,780)),(49.5,p(1320,780)),(53,p(55,313)),(57,p(55,523)),(61,p(55,220)),(65,p(22,875)),(68.5,p(17,870)),(72.5,p(1000,300)),(76.5,p(22,25)),(77.15,p(1100,350)),(81,p(22,25)),(84.5,p(1320,780))],
'controls.mp4':[(0,p(106,211)),(3.5,p(106,211)),(11,p(320,450)),(14.5,p(264,450))],
'details.mp4':[(7,p(1320,780)),(10.5,p(1320,780)),(14.5,p(1320,780)),(18,p(102,340)),(33.5,p(55,418))],
'archive-real.mp4':[(0,p(1260,780)),(3.5,p(1260,780)),(7.5,p(55,626)),(11.5,p(230,107)),(16,p(116,610))]
}
# Keyframes, rather than OS mouse input, keep this revision fully programmatic.
keys=[(0,(1170,800))]
def key(t,xy): keys.append((max(0,t),xy))
# The real installer moves at these times in the source take.
for t,xy in [(3,(960,652)),(6.6,(805,715)),(10.2,(805,767)),(14,(805,762)),(18.88,(467,604))]:
 key(t-.65,keys[-1][1]);key(t-.08,xy);key(t+.32,xy)
# Track each cut and each visible interaction in the retained source ranges.
offset=0
for filename,start,end in edit['segments']:
 if filename=='onboarding.mp4': offset+=end-start;continue
 cues=tracks[filename];active=next((xy for t,xy in reversed(cues) if t<=start),park)
 key(offset,active)
 for t,xy in cues:
  if start < t < end:
   moment=offset+t-start
   # Start movement during the preceding hold and arrive with the UI action.
   prev=keys[-1][1]
   key(moment-.58,prev);key(moment+.10,xy);key(moment+.48,xy)
 offset+=end-start
# Stable ordering lets cuts intentionally reset the pointer to the new view.
keys.sort(key=lambda k:k[0]);dedup={round(t,6):xy for t,xy in keys};keys=sorted(dedup.items())
commands=[];idx=0;positions=[]
for frame in range(round(edit['duration']*30)):
 t=frame/30
 while idx+1<len(keys) and keys[idx+1][0]<=t:idx+=1
 a,pa=keys[idx]
 if idx+1<len(keys):
  b,pb=keys[idx+1];u=min(1,max(0,(t-a)/(b-a))) if b>a else 1;u=u*u*(3-2*u)
  x=round(pa[0]+(pb[0]-pa[0])*u);y=round(pa[1]+(pb[1]-pa[1])*u)
 else:x,y=pa
 commands.append(f'{t:.6f} overlay@cursor x {x}, overlay@cursor y {y};');positions.append([t,x,y])
(OUT/'cursor-commands.txt').write_text('\n'.join(commands)+'\n')
(OUT/'cursor-track.json').write_text(json.dumps({'cursor':'Windows aero_arrow.cur','size':[25,38],'positions':positions,'keyframes':keys},indent=2))
print(len(commands),'cursor frames')
