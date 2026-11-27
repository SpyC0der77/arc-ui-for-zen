"""Windows driver for the real-time Zen takes and bento captures.

    python demo-video/scripts/capture/live_windows.py start  SESSION themed|vanilla
    python demo-video/scripts/capture/live_windows.py take   SESSION themed|vanilla [--out DIR] [--only f_peek ...]
    python demo-video/scripts/capture/live_windows.py bento  SESSION [--out DIR]
    python demo-video/scripts/capture/live_windows.py close  SESSION themed|vanilla

SESSION is the session.json printed by `prepare-comparison.cjs create`.

`start` launches the disposable copy through prepare-comparison.cjs (Marionette
and MOZ_REMOTE_ALLOW_SYSTEM_ACCESS only on that child), pushes its window
behind yours without taking focus, and starts a detached marionette-host.py on
127.0.0.1 that runs the demo setup. Zen 1.24b allows one Marionette session per
launch, so setup, takes and bento captures all go through that host.

`take` runs live_zen.py in the host: the Zen window comes to the front and is
recorded by window-recorder.exe; it goes back behind your windows afterwards.
Synthetic Marionette input is used, so the real pointer is only parked
outside the window. Keep the screen unlocked.

`close` stops the host and asks Zen to quit gracefully (never force-killed).
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
import win_native as W  # noqa: E402

PORTS = {'themed': 47828, 'vanilla': 47829}


def host_send(role, code, timeout=900):
    r = subprocess.run([sys.executable, str(HERE / 'marionette-host.py'), '--send', f'tcp:{PORTS[role]}', code],
                       capture_output=True, text=True, timeout=timeout)
    sys.stdout.write(r.stdout)
    if r.returncode:
        sys.stderr.write(r.stderr)
        raise SystemExit(r.returncode)
    return r.stdout


def start(session, role):
    previous = W.foreground()
    out = subprocess.check_output(['node', str(HERE / 'prepare-comparison.cjs'), 'start', session, role], text=True)
    launcher = json.loads(out)['pid']
    # Keep the new window behind the user's work while it starts.
    deadline = time.time() + 40
    seen = False
    while time.time() < deadline:
        kids = subprocess.check_output(['powershell', '-NoProfile', '-Command',
                                        f"(Get-CimInstance Win32_Process -Filter \"ParentProcessId={launcher} and Name='zen.exe'\").ProcessId"],
                                       text=True).split()
        wins = [w for k in kids for w in W.windows(int(k)) if w['class'] == 'MozillaWindowClass' and w['onscreen']]
        for w in wins:
            W.to_back(w['id'])
        if wins:
            if seen:
                break
            seen = True
            time.sleep(1.0)
            continue
        time.sleep(.05)
    if previous and W.foreground() != previous:
        W.give_back(previous)
    log = Path(session).parent / f'host-{role}.log'
    flags = 0x00000008 | 0x00000200 | 0x08000000  # DETACHED_PROCESS | NEW_PROCESS_GROUP | NO_WINDOW
    with open(log, 'w') as fh:
        subprocess.Popen([sys.executable, '-u', str(HERE / 'marionette-host.py'), '--manifest', session, '--role', role,
                          '--socket', f'tcp:{PORTS[role]}', '--setup'], stdout=fh, stderr=subprocess.STDOUT,
                         cwd=str(ROOT), creationflags=flags, close_fds=True)
    deadline = time.time() + 120
    while time.time() < deadline:
        text = log.read_text(errors='replace')
        if 'READY' in text:
            print(text.strip())
            return
        if 'Traceback' in text and 'READY' not in text:
            time.sleep(1)
            raise SystemExit('Host failed:\n' + log.read_text(errors='replace'))
        time.sleep(.5)
    raise SystemExit('Host did not become ready; see ' + str(log))


def take(role, out, only):
    out = Path(out).resolve()
    if W.screen_locked():
        raise SystemExit('The screen is locked: Windows delivers no input or frames. Unlock it first.')
    code = (f"import sys\nsys.path.insert(0, {str(HERE)!r})\nimport win_native as W\n"
            f"PREVIOUS_FOREGROUND = W.foreground()\n"
            f"LANE = {role!r}\nOUT = {str(out)!r}\n" + (f"ONLY = {only!r}\n" if only else "") +
            f"exec(open({str(HERE / 'live_zen.py')!r}, encoding='utf-8').read())\n"
            "try:\n    result = record()\nfinally:\n"
            "    W.to_back(W.main_window(browser_pid())['id'])\n    W.give_back(PREVIOUS_FOREGROUND)\n")
    host_send(role, code)


def bento(out, only):
    out = Path(out).resolve()
    code = (f"OUT = {str(out)!r}\n"
            f"exec(open({str(HERE / 'bento_zen.py')!r}, encoding='utf-8').read())\n"
            f"result = capture({only!r})\n")
    host_send('themed', code)


def close(session, role):
    try:
        host_send(role, 'raise SystemExit', timeout=30)
    except (SystemExit, Exception):
        pass
    time.sleep(1.5)
    env = dict(os.environ, ARC_DEMO_PYTHON=sys.executable)
    r = subprocess.run(['node', str(HERE / 'prepare-comparison.cjs'), 'close', session, role], text=True,
                       capture_output=True, env=env, timeout=240)
    print(r.stdout or r.stderr)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('action', choices=['start', 'take', 'bento', 'close'])
    p.add_argument('session')
    p.add_argument('role', nargs='?', default='themed', choices=['themed', 'vanilla'])
    p.add_argument('--out')
    p.add_argument('--only', nargs='*')
    a = p.parse_args()
    session = str(Path(a.session).resolve())
    if a.action == 'start':
        start(session, a.role)
    elif a.action == 'take':
        take(a.role, a.out or ROOT / 'demo-video/recordings/windows', a.only)
    elif a.action == 'bento':
        bento(a.out or ROOT / 'demo-video/recordings/windows/bento', a.only)
    else:
        close(session, a.role)


if __name__ == '__main__':
    main()
