"""Build a public local download page; no HTTP/dev server or browser UI mockup."""
import base64
import hashlib
import html
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
image=ROOT/'demo-video/assets/wallpaper.jpg'
folder=ROOT/'artifacts/arc-public-download'
folder.mkdir(parents=True,exist_ok=True)
filename='Mountain landscape - Arc UI Demo.jpg'
sequence=1
while (Path.home()/'Downloads'/filename).exists():
    sequence+=1
    filename=f'Mountain landscape {sequence} - Arc UI Demo.jpg'
uri='data:image/jpeg;base64,'+base64.b64encode(image.read_bytes()).decode()
page=folder/'download.html'
page.write_text('''<!doctype html><meta charset="utf-8"><title>Arc UI Demo download</title>
<style>body{margin:0;background:#faf8fb;color:#25202a;font:16px system-ui}main{padding:40px}h1{font-size:30px;font-weight:550}img{width:600px;height:338px;object-fit:cover;border-radius:12px}a{position:fixed;left:626px;top:266px;width:220px;height:48px;display:grid;place-items:center;background:#65556f;color:white;text-decoration:none;border-radius:8px}p{color:#65556f}</style>
<main><h1>A mountain landscape</h1><p>Save this image to your downloads.</p><img src="'''+uri+'''" alt="Mountain landscape"><a href="'''+uri+'" download="'+html.escape(filename,quote=True)+'">Download image</a></main>\n')
metadata={'page':page.as_uri(),'filename':filename,'expected_default_target':str(Path.home()/'Downloads'/filename),
          'sha256':hashlib.sha256(image.read_bytes()).hexdigest(),'size':image.stat().st_size,
          'window_click':[1000,300],'screen_click_at_80_80':[1080,380],
          'layout':'1592x896 Arc window,264px sidebar; button is220x48 centered at window(1000,300)'}
(folder/'fixture.json').write_text(json.dumps(metadata,indent=2)+'\n')
print(json.dumps(metadata,indent=2))
