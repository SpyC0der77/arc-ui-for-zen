"""Run the ORIGINAL themed-demo actions, adding checkpoint metadata externally.

No original recorder is edited. Native screenshot/input calls remain Marionette.
Use a prepared disposable session from prepare-comparison.cjs on port 2828.
"""
import argparse
import atexit
import ast
import base64
import hashlib
import json
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DEMO = ROOT / 'demo-video'
sys.path.insert(0, str(ROOT / 'artifacts/test-python'))


class RetainedTakeFinished(Exception):
    """The original edit uses no later footage from this take."""


def original_cursor_tracks():
    """Evaluate only the original cursor author's coordinate/track declarations."""
    tree = ast.parse((DEMO / 'scripts/add-cursor.py').read_text())
    declarations = []
    for node in tree.body:
        if isinstance(node, ast.Assign):
            names = {n.id for target in node.targets for n in ast.walk(target) if isinstance(n, ast.Name)}
            if names and names <= {'sx', 'sy', 'p', 'park', 'tracks'}:
                declarations.append(node)
    namespace = {}
    exec(compile(ast.Module(body=declarations, type_ignores=[]), 'original cursor declarations', 'exec'), namespace)
    return namespace['tracks'], namespace['park']


class RecordingPaths(ast.NodeTransformer):
    def __init__(self, output):
        self.output = output

    def visit_Assign(self, node):
        # Original actions and initialization are preserved; isolate new media.
        if any(isinstance(target, ast.Name) and target.id == 'OUT' for target in node.targets):
            node.value = ast.Call(func=ast.Name(id='Path', ctx=ast.Load()),
                                  args=[ast.Constant(str(self.output))], keywords=[])
        elif (any(isinstance(target, ast.Name) and target.id == 'm' for target in node.targets)
              and isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name)
              and node.value.func.id == 'Marionette'):
            node.value = ast.Name(id='comparison_session', ctx=ast.Load())
        return self.generic_visit(node)

    def visit_BinOp(self, node):
        node = self.generic_visit(node)
        if (isinstance(node.left, ast.Name) and node.left.id == 'DEMO'
                and isinstance(node.op, ast.Div) and isinstance(node.right, ast.Constant)
                and node.right.value in ('review', 'timeline')):
            node.left = ast.Call(func=ast.Name(id='Path', ctx=ast.Load()),
                                 args=[ast.Constant(str(self.output.parent))], keywords=[])
        return node

    def visit_Constant(self, node):
        # Recorder predates the source split. Read the same installed functions
        # from their current source location, without changing their contents.
        if node.value == 'payload/arc.uc.js':
            return ast.Constant('payload/content/features/archive/auto-archive.js')
        return node

    def visit_FunctionDef(self, node):
        if node.name == 'shot':
            return ast.parse('def shot(name,s=None,duration=3.5):\n return comparison_shot(globals(),name,s,duration)').body[0]
        return self.generic_visit(node)

    def visit_Expr(self, node):
        if (isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Attribute)
                and isinstance(node.value.func.value, ast.Name)
                and node.value.func.value.id == 'm'
                and node.value.func.attr in ('start_session', 'delete_session')):
            return ast.Pass()
        if (isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Attribute)
                and isinstance(node.value.func.value, ast.Name)
                and node.value.func.value.id == 'm' and node.value.func.attr == 'set_context'):
            return [node, ast.parse('comparison_verify_profile(m)').body[0]]
        return self.generic_visit(node)


def comparison_shot(scope, name, action, duration):
    if scope['frame'] / 20 >= scope['comparison_end']:
        raise RetainedTakeFinished()
    scope['m'].execute_script('''
      window.demoCaptureObserver?.disconnect();window.demoCaptureMutations=0;
      window.demoCaptureObserver=new MutationObserver(()=>window.demoCaptureMutations++);
      demoCaptureObserver.observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});
    ''')
    if action:
        scope['later'](action)
    frame = scope['frame']
    fps = 20
    scope['shots'].append({'name': name, 'start': frame / fps, 'duration': duration})
    started = time.monotonic()
    ready = None
    quiet_since = None
    mutations = -1
    activity = []
    for i in range(round((duration + 6) * fps)):
        image = scope['comparison_capture'](scope['m'])
        scope['ff'].stdin.write(image)
        scope['frame'] += 1
        # Ignore infinite decorative animations. Require a quiet period after
        # the original recorder's deferred 140ms action before the checkpoint.
        state = scope['m'].execute_script('''return {
          busy:document.getAnimations().some(a=>a.playState==='running' && Number.isFinite(a.effect?.getComputedTiming().endTime)),
          mutations:window.demoCaptureMutations};''')
        busy = state['busy'] or state['mutations'] != mutations
        mutations = state['mutations']
        activity.append([i / fps, bool(busy), mutations])
        if i >= 6 and not busy:
            if quiet_since is None:
                quiet_since = i
            if i - quiet_since >= 4 and ready is None:
                ready = (i + 1) / fps
        else:
            quiet_since = None
            # A deferred action can begin after an earlier quiet period (the
            # hidden-sidebar flight starts 790ms in). Keep the LAST settled
            # checkpoint, so the editor cannot trim that feature away.
            ready = None
        finished = i >= round(duration * fps) - 1 and ready is not None
        if finished or i == round((duration + 6) * fps) - 1:
            (scope['comparison_output'] / 'review' / f'{scope["comparison_take"]}-{len(scope["shots"]):02}.png').write_bytes(image)
        if finished:
            break
        delay = started + (i + 1) / fps - time.monotonic()
        if delay > 0:
            time.sleep(delay)
    if ready is None:
        # Never quietly guess a completion checkpoint for an unsettled shot.
        raise RuntimeError(f'No settled checkpoint for {name}; inspect its recording before use')
    scope['m'].execute_script('window.demoCaptureObserver.disconnect()')
    tracks, park = original_cursor_tracks()
    cues = tracks[f'{scope["comparison_take"]}.mp4']
    active = next((position for t, position in reversed(cues) if t <= frame / fps), park)
    positions = [[0, *active]]
    positions.extend([t - frame / fps, *position] for t, position in cues
                     if frame / fps < t <= frame / fps + ready)
    cursor_path = scope['comparison_output'] / 'timeline' / f'{scope["comparison_take"]}-{len(scope["shots"]):02}-cursor.json'
    cursor_path.write_text(json.dumps({'image': str(DEMO / 'assets/cursor.png'), 'positions': positions}, indent=2) + '\n')
    scope['comparison_shots'].append({
        'name': name, 'file': f'recordings/{scope["comparison_take"]}.mp4',
        'start': frame / fps, 'end': scope['frame'] / fps,
        'ready': ready, 'ready_method': 'last 200ms quiet period after all observed chrome mutations/finite animations',
        'activity': activity,
        'cursor_track': str(cursor_path),
    })
    print(name, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, help='Disposable prepare-comparison session manifest, required to record')
    parser.add_argument('--setup', action='store_true', help='Prepare demo tabs in this same recording connection')
    parser.add_argument('--take', choices=['browser', 'controls', 'details', 'archive-real'], action='append')
    parser.add_argument('--check', action='store_true', help='Verify original scripts can be wrapped without connecting')
    parser.add_argument('--mac-screen-backdrop-pid', type=int, help='Capture the composited Mac window over this controlled backdrop process')
    args = parser.parse_args()
    output = args.output.resolve()
    if not args.check and args.manifest is None:
        parser.error('--manifest is required to record; personal profiles are never automated')
    if not args.check:
        sys.path.insert(0, str(Path(__file__).parent))
        from importlib import import_module
        shared = import_module('record-vanilla')
        info = shared.session_info(args.manifest, 'themed')
        if info['port'] != 2828:
            parser.error('Original recording scripts require disposable port 2828')
        session = shared.connect(info)
        if args.setup:
            print(json.dumps(shared.setup(session)), flush=True)
        if args.mac_screen_backdrop_pid:
            if sys.platform != 'darwin':
                parser.error('--mac-screen-backdrop-pid requires macOS')
            guard = ROOT / 'artifacts/screen-guard'
            if not guard.is_file():
                parser.error('Compile demo-video/scripts/capture/screen-guard.swift to artifacts/screen-guard first')
            guard_args = [str(guard), str(info['pid']), str(args.mac_screen_backdrop_pid), '0', '30', '1592', '896']
            # A persistent native screen stream avoids the launch latency of a
            # separate screencapture process for every original 20 fps frame.
            stream = subprocess.Popen([
                'ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'avfoundation',
                '-framerate', '20', '-pixel_format', 'bgr0', '-i', '0:none',
                '-vf', 'crop=1592:896:0:30', '-fps_mode', 'passthrough',
                '-c:v', 'png', '-compression_level', '1',
                '-f', 'image2pipe', 'pipe:1',
            ], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0)
            atexit.register(lambda: stream.poll() is None and stream.terminate())
            condition = threading.Condition()
            latest = {'time': 0, 'data': None, 'error': None}
            def read_exact(size):
                chunks = []
                while size:
                    chunk = stream.stdout.read(size)
                    if not chunk:
                        raise RuntimeError('Native screen stream ended unexpectedly')
                    chunks.append(chunk); size -= len(chunk)
                return b''.join(chunks)
            def read_frames():
                try:
                    while True:
                        signature = read_exact(8)
                        if signature != b'\x89PNG\r\n\x1a\n':
                            raise RuntimeError('Native screen stream returned an invalid PNG')
                        parts = [signature]
                        while True:
                            header = read_exact(8)
                            size = int.from_bytes(header[:4], 'big')
                            if size > 32 * 1024 * 1024:
                                raise RuntimeError('Native screen stream returned an invalid PNG chunk')
                            parts.extend([header, read_exact(size + 4)])
                            if header[4:] == b'IEND': break
                        with condition:
                            latest.update(time=time.monotonic(), data=b''.join(parts))
                            condition.notify_all()
                except Exception as error:
                    with condition:
                        latest['error'] = error
                        condition.notify_all()
            threading.Thread(target=read_frames, daemon=True).start()
            def capture_composited(_m):
                subprocess.run(guard_args, check=True, stdout=subprocess.DEVNULL)
                after_guard = time.monotonic()
                with condition:
                    if not condition.wait_for(lambda: latest['time'] > after_guard or latest['error'], timeout=5):
                        raise RuntimeError('Timed out waiting for the native screen stream')
                    if latest['error']: raise latest['error']
                    data = latest['data']
                subprocess.run(guard_args, check=True, stdout=subprocess.DEVNULL)
                return data
            shared.screenshot_png = capture_composited

    def verify_profile(m):
        actual = m.execute_script('return Services.dirsvc.get("ProfD",Ci.nsIFile).path')
        if Path(actual).resolve() != Path(info['profile']).resolve():
            m.delete_session()
            raise RuntimeError('The original recorder is connected to the wrong profile')

    takes = args.take or ['browser', 'controls', 'details', 'archive-real']
    retained = json.loads((DEMO / 'timeline/edit.json').read_text())['segments']
    for folder in ['recordings', 'review', 'timeline']:
        (output / folder).mkdir(parents=True, exist_ok=True)
    for take in takes:
        original = Path(__file__).with_name(f'record-{take}.py')
        source = original.read_bytes()
        tree = ast.fix_missing_locations(RecordingPaths(output / 'recordings').visit(ast.parse(source)))
        code = compile(tree, str(original), 'exec')
        if args.check:
            print(f'Original recorder preserved: {original.name}, SHA256 {hashlib.sha256(source).hexdigest()}')
            continue
        destination = output / 'recordings' / f'{take}.mp4'
        if destination.exists():
            raise SystemExit(f'Refusing to overwrite an existing take: {destination}')
        scope = {'__file__': str(original), '__name__': '__main__',
                 'comparison_shot': comparison_shot, 'comparison_take': take,
                 'comparison_output': output, 'comparison_shots': [],
                 'comparison_verify_profile': verify_profile,
                 'comparison_capture': shared.screenshot_png if not args.check else None,
                 'comparison_end': max(end for file, start, end in retained if file == f'{take}.mp4'),
                 'comparison_session': session if not args.check else None}
        complete = False
        try:
            exec(code, scope)
            complete = scope['ff'].returncode == 0
        except RetainedTakeFinished:
            complete = scope['ff'].returncode == 0
        finally:
            metadata = {'source_script': str(original.relative_to(ROOT)),
                        'source_sha256': hashlib.sha256(source).hexdigest(),
                        'complete': complete,
                        'shots': scope['comparison_shots']}
            (output / 'timeline' / f'{take}-checkpoints.json').write_text(json.dumps(metadata, indent=2) + '\n')
            if original.read_bytes() != source:
                raise RuntimeError(f'Original recording code changed during capture: {original}')
        if scope['ff'].returncode != 0:
            raise SystemExit(f'FFmpeg failed for {take}')
    if not args.check:
        session.delete_session()


if __name__ == '__main__':
    main()
