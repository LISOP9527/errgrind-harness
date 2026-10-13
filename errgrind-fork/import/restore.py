#!/usr/bin/env python3
"""Restore the bundled ErrGrind session data into a fresh ~/.errgrind home.

Copies the session logs under data/sessions/ and the attachment blobs under
data/attachments/ into the target home, then registers the session ids on the
workspace row for --cwd (creating the row when it does not exist yet).

Usage:
    python3 restore.py --cwd /path/to/ErrGrind [--home ~/.errgrind]

Requirements: the app must have been launched once so that
<home>/storages/workspace.json exists.
"""

import argparse
import json
import os
import re
import shutil
import sys
import uuid
from datetime import datetime, timezone

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')

_SAFE = re.compile(r'^[A-Za-z0-9._-]$')


def project_key(cwd):
    """Mirror session-persistence-jsonl projectKey(): separators collapse to
    '-', unsafe code units escape as ~XXXX, and the slug wraps in --..--."""
    if not cwd:
        raise ValueError('empty project path')
    readable = []
    separator_run = False
    for ch in cwd:
        if ch in '/\\:':
            if not separator_run:
                readable.append('-')
            separator_run = True
        elif ch != '~' and _SAFE.match(ch):
            readable.append(ch)
            separator_run = False
        else:
            readable.append('~%04X' % ord(ch))
            separator_run = False
    slug = ''.join(readable).lstrip('-') or 'root'
    return '--' + slug[:251] + '--'


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--cwd', required=True,
                    help='project path the restored sessions belong to')
    ap.add_argument('--home', default=os.path.expanduser('~/.errgrind'))
    ap.add_argument('--data-dir', default=DATA_DIR)
    args = ap.parse_args()

    home = os.path.abspath(args.home)
    ws_json = os.path.join(home, 'storages', 'workspace.json')
    if not os.path.isfile(ws_json):
        sys.exit(f'{ws_json} missing — launch the app once in {args.cwd} first, '
                 'then re-run this script.')

    state = json.load(open(os.path.join(args.data_dir, 'workspace-state.json')))
    session_ids = state['sessionIds']

    # 1. session logs
    dst_root = os.path.join(home, 'sessions', project_key(args.cwd))
    for sid in session_ids:
        src = os.path.join(args.data_dir, 'sessions', sid)
        if not os.path.isdir(src):
            sys.exit(f'{src} missing — data dir is incomplete')
        dst = os.path.join(dst_root, sid)
        if os.path.isdir(dst):
            shutil.rmtree(dst)
        shutil.copytree(src, dst)

    # 2. attachment blobs (content-addressed; merge tree)
    att_src = os.path.join(args.data_dir, 'attachments')
    if os.path.isdir(att_src):
        for root, _dirs, files in os.walk(att_src):
            rel = os.path.relpath(root, att_src)
            for name in files:
                dst_dir = os.path.join(home, 'attachments', rel)
                os.makedirs(dst_dir, exist_ok=True)
                shutil.copy2(os.path.join(root, name),
                             os.path.join(dst_dir, name))

    # 3. workspace membership
    ws = json.load(open(ws_json))
    table = ws['tables']['workspaces']
    row = next((r for _wid, r in table.items() if r['path'] == args.cwd), None)
    if row is None:
        wid = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        row = {'path': args.cwd, 'title': os.path.basename(args.cwd.rstrip('/')),
               'sessionIds': [], 'createdAt': now, 'updatedAt': now}
        table[wid] = row
        ws['global'].setdefault('workspaceIds', []).append(wid)
        if not ws['global'].get('defaultWorkspaceId'):
            ws['global']['defaultWorkspaceId'] = wid
    row['sessionIds'] = list(dict.fromkeys(row['sessionIds'] + session_ids))
    now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    row['updatedAt'] = now
    archived = ws['global'].setdefault('archivedSessionIds', [])
    for sid in state.get('archivedSessionIds', []):
        if sid not in archived:
            archived.append(sid)
    tmp = ws_json + '.restore-tmp'
    with open(tmp, 'w') as f:
        json.dump(ws, f, ensure_ascii=False, indent=2)
    os.replace(tmp, ws_json)

    # 4. drop stale projection cache for the restored sessions
    cache_dir = os.path.join(home, 'storages', 'session_projcache', 'sessions')
    for sid in session_ids:
        stale = os.path.join(cache_dir, sid + '.json')
        if os.path.isfile(stale):
            os.remove(stale)

    print(f'restored {len(session_ids)} sessions into {dst_root}')
    print('open the app in that project directory to see them in the sidebar.')


if __name__ == '__main__':
    main()
