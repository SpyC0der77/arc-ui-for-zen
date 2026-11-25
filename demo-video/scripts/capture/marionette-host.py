"""Hold one Marionette chrome session open and run Python snippets against it.

Zen 1.24b on macOS cannot open a second Marionette session after the demo
setup, so recording and iteration go through this long-lived host instead.

  python marionette-host.py --manifest SESSION --role themed --socket /path/sock [--setup]
  python marionette-host.py --send /path/sock 'm.execute_script("return 1")'

On Windows (no AF_UNIX in CPython) pass --socket tcp:PORT; the host listens on
127.0.0.1 only and --send takes the same tcp:PORT address.

Snippets run in one persistent namespace with `m` (the session), `info` and
`rv` (record-vanilla helpers). The value of `result`, if set, is returned as JSON.
"""
import argparse
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import sys
import traceback

HERE = Path(__file__).resolve().parent


def serve(args):
    spec = importlib.util.spec_from_file_location('rv', HERE / 'record-vanilla.py')
    rv = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rv)
    info = rv.session_info(args.manifest, args.role)
    # Bind first: a failure after setup would lose the only usable session.
    server = listen(args.socket)
    m = rv.connect(info)
    ns = {'m': m, 'info': info, 'rv': rv}
    if args.setup:
        print(json.dumps(rv.setup(m))[:400], flush=True)
    print('READY', flush=True)
    while True:
        conn, _ = server.accept()
        with conn:
            code = b''
            while not code.endswith(b'\0'):
                chunk = conn.recv(65536)
                if not chunk:
                    break
                code += chunk
            out = io.StringIO()
            ns.pop('result', None)
            try:
                with contextlib.redirect_stdout(out):
                    exec(code.rstrip(b'\0').decode(), ns)
                reply = {'ok': True, 'stdout': out.getvalue(), 'result': ns.get('result')}
            except SystemExit:
                conn.sendall(json.dumps({'ok': True, 'stdout': 'host exiting'}).encode())
                break
            except Exception:
                reply = {'ok': False, 'stdout': out.getvalue(), 'error': traceback.format_exc()}
            conn.sendall(json.dumps(reply, default=str).encode())


def listen(address):
    if address.startswith('tcp:'):
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.bind(('127.0.0.1', int(address[4:])))
    else:
        path = Path(address)
        with contextlib.suppress(FileNotFoundError):
            path.unlink()
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        server.bind(str(path))
        os.chmod(path, 0o600)
    server.listen(1)
    return server


def connect_host(address):
    if address.startswith('tcp:'):
        return socket.create_connection(('127.0.0.1', int(address[4:])))
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.connect(address)
    return client


def send(path, code):
    client = connect_host(path)
    client.sendall(code.encode() + b'\0')
    data = b''
    while chunk := client.recv(65536):
        data += chunk
    reply = json.loads(data)
    sys.stdout.write(reply.get('stdout', ''))
    if reply.get('result') is not None:
        print(json.dumps(reply['result'], indent=1))
    if not reply['ok']:
        sys.stderr.write(reply['error'])
        sys.exit(1)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--send', metavar='SOCKET')
    parser.add_argument('code', nargs='?')
    parser.add_argument('--manifest')
    parser.add_argument('--role', choices=['themed', 'vanilla'])
    parser.add_argument('--socket')
    parser.add_argument('--setup', action='store_true')
    a = parser.parse_args()
    if a.send:
        send(a.send, a.code if a.code is not None else sys.stdin.read())
    else:
        serve(a)
