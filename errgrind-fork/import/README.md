# Imported ErrGrind sessions

English | [中文](README.zh.md)

`data/` holds the historical learner records migrated from the legacy
Python product so the set travels with the repository instead of living on
one machine.

- `data/sessions/<id>/` — one `session.v4.jsonl.zstd` log per Session
  (8 imported Errors, 2 live Drill sessions, 1 archived Error).
- `data/attachments/v1/` — content-addressed attachment blobs the logs
  reference, in the runtime's own three-view layout.
- `data/workspace-state.json` — the session id list and which ids are
  archived.
- `restore.py` — copies the data into a `~/.errgrind` home and registers
  the sessions on the workspace for a given project path.
- `import.py` — the importer that generated these logs. Kept for
  provenance; its input database (`errgrind-vps.db`) is not in the
  repository.

## Restoring

Launch the app once in the project directory so `~/.errgrind` and its
workspace store exist, then:

```sh
python3 errgrind-fork/import/restore.py --cwd /path/to/ErrGrind
```

The script derives the Session directory key from `--cwd` the same way
`session-persistence-jsonl`'s `projectKey` does, so the logs land under
whatever path the target machine uses. Re-running is idempotent: session
ids merge into `sessionIds` and `archivedSessionIds` without duplicates.
