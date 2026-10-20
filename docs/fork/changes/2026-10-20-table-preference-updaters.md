# Keep table preference updates outside React state updaters

The combined browser route sweep caught a React warning when the channel Streaming tab updated table preferences: a functional state updater notified settings subscribers while React was rendering the subtitle table.

Resolve visibility, pagination and sorting callbacks against their latest pending values before queuing concrete React state and persisting preferences. Consecutive functional updates still compose, direct values still work, and selection/reset behavior remains unchanged. No API, schema or scheduling behavior changed.

Validation: the StrictMode settings-subscriber regression reproduces the warning before the fix; all seven hook tests now pass, covering composed/direct updates, persisted remount values and existing selection/reset behavior. The focused Streaming route and subtitle browser suite passed all six tests including fixture seed. Web/E2E typechecks, changed-file lint, formatting and quick preflight passed.
