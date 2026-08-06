# Vendored Powerline status modules

These files are copied from `pi-powerline-footer` v0.12.1 and make up its status-bar engine. Keep them byte-for-byte aligned with upstream whenever possible.

Vendored modules include configuration, presets, segment rendering, themes, icons, separators, Git polling, token/context accounting, currency conversion, paths, and render scheduling.

Package-specific code stays outside this directory:

- `../pi-powerline-simple.ts` builds upstream's `SegmentContext` and mounts the bar in Pi's native bottom footer.
- `../status-line.ts` applies upstream's adaptive primary/overflow-row fitting in the native bottom footer.
- `../extras.ts` publishes cache-hit and last-response through generic custom statuses.
- `../settings.ts` reads merged settings and persists `/powerline <preset>` changes.

The queue and shell segments remain upstream code, but their runtime state is empty because this package does not include those workflows.

Intentional vendor patch: `theme.ts` also checks `~/.pi/agent/powerline-simple/theme.json` before the legacy upstream theme path.
