# Performance and cleanup — 0.4.44

## Implemented

- Native per-window show/hide/minimize/restore visibility gates visual
  `usePosition` intervals. DOM visibility alone proved insufficient: the hidden
  offscreen window still reported `document.visibilityState === 'visible'`.
  Playback observations continue updating TransportClock, and showing a window
  immediately projects the latest position. Foreground80/160ms cadence, audio
  capture, native observations and transport serialization are unchanged.
- Settings-only persistence reuses the serialized immutable library fragment.
  No debounce, dropped writes or new storage keys; synchronous durability and
  the existing JSON/version schema are retained. Cache/dedup markers commit only
  after successful storage, including when serialization or quota writes fail.
  This avoids repeated traversal and temporary whole-library JSON allocations;
  it does not eliminate localStorage's full-value write or its latency.

## Verification

- 884 normal tests passed/39 explicit-local tests skipped; TypeScript and build
  pass. The optional synthetic benchmark passed separately.
- Actual source and packaged secondary-only performance fixtures passed all7
  checks and observedexit0. Packaged `.qa-perf/qa-0444-perf-package.log`:
  initial hidden ticks0/samples4;2s visible adds24ticks; subsequent2s hidden
  stays at24ticks while samples rise8→10; restore immediately shows the current
  position (within1.2s of native media projection, including displayed rounding).
  Only the isolated fixture appeared briefly/inactively on the secondary screen.
- Packaged150%DPI overlay/display-recovery9 checks passed/exit0, with bounds
  unchanged and native coverage intact. This is not a hardware wake reproduction.
- 60 package identity checks passed. Current asar SHA256:
  `43b5dd3895cfe7d3a5e08504213b7db9d53a3496f78d81b8f5d3114111e19817`.
- Reproducible `SYLLABLE_STORAGE_BENCH=1` opt-in benchmark in
  `src/store/storage-benchmark.test.ts`:300 synthetic documents/63,000 lines,
  6,255,729-byte JSON,100 settings updates. Full serialization2290.3ms versus
  cached23.2ms; lyric getters visited6,300,000 versus63,000 times. These are
  serialization-only measurements, not a whole-app100× speed claim.
- Main/native audit found four app processes with one shared renderer and no
  resident model. Parsing the actual55,325-byte restore snapshot averaged0.199ms
  over2000 runs, so no speculative native clock/cache rewrite was made. No
  reliable whole-app RAM reduction is claimed from these short comparisons.

## Cleanup and recovery

- Reviewed35 obsolete release entries totaling11,220,029,299 bytes (~10.45GiB)
  were moved to the Windows Recycle Bin, NOT permanently deleted. They include
  old ZIP/Setup/blockmaps, staging builds, duplicate candidates and old rollbacks.
  Disk space is not necessarily reclaimed until the Recycle Bin is emptied.
- 74 historical root logs/screenshots (8,717,464 bytes) were moved without deletion
  to `.qa-history/root-artifacts-20261023`;32 test-profile directories moved to
  `.qa-history/test-profiles-20261023`. Historical paths in older notes may refer
  to their former root locations. Build metadata is `.qa-history/packaging-0444`.
- Current0.4.44, previous0.4.43 rollback,0.4.42 backup and the previously protected
  0.4.38 tree remain. No source, user preview/output file, model/runtime, recording,
  current profile, calibration or active sync evidence was deleted.
- `scripts/cleanup-release.ps1` defaults to dry-run and requires a reviewed
  inventory. It validates exact one-level release paths, names, sizes/counts,
  running executables and reparse points before applying recoverable recycling.
  It is intentionally a narrow cleanup for these known old builds, not a generic
  recursive deletion tool. Do not replay the old inventory after cleanup.

## Handoff

Fixed `release/current/Syllable.exe` is0.4.44/PID43388 at deployment. Desktop and
Start Menu shortcuts still target it without arguments. Previous0.4.43 is
`release/current-0.4.43-backup-20261023`; normal settings backup is ignored
`.qa-user-data-preupdate-0444`. Staged/verified directories were renamed into
place, with terminating errors and bounded file-lock retries; no nested copies.
Normal configuration did not opt into new audio/model work. General automatic
audible lyric synchronization remains unfinished and is outside this performance
patch; this change must not be represented as fixing every song's timing.
