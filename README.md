# pi-powerline-simple

A status-only fork of [`pi-powerline-footer`](https://github.com/nicobailon/pi-powerline-footer), based on v0.12.1. It preserves Powerline's status engine while mounting its adaptive one-or-two-line layout in Pi's native footer **below the editor**.

It does not replace or wrap the editor, intercept input, change `/compact`, or include Powerline's queue/inbox, bash mode, stash, welcome, working-vibes, prompt-history, or other workflow features.

## Source boundary

- `src/upstream/` vendors Powerline's status modules: configuration, presets, segments, themes, icons, separators, Git polling, token/context accounting, currency conversion, and render scheduling.
- `src/pi-powerline-simple.ts` supplies status state and mounts the native footer.
- `src/status-line.ts` retains upstream ordering and adaptive primary/overflow-row fitting.
- `src/extras.ts` separately publishes cache-hit and last-response when their status keys are configured as custom items.

Local extras do not add built-in segment IDs. Gondolin, usage, remote-admin, cache-hit, and last-response all use upstream's generic `customItems` mechanism. Cache-hit and last-response are opt-in, so an unconfigured installation retains the upstream default contents.

## Install

```sh
pi install /Users/travis/coding/pi/pi-powerline-simple
```

Restart Pi or run `/reload`.

## Default display

The default preset is unchanged from upstream:

```text
model  thinking  shell mode  path  git  queue  context  cache read  cost  extension statuses
```

Segments without values are hidden. `shell_mode` and `queue` remain valid but stay hidden because this package has no backing shell or queue workflow. Upstream's `subagents` segment is also inert; subagent **cost** is still included when session results provide it.

The footer remains one line while everything fits. At narrower widths, the first non-fitting segment and the segments after it move to a second footer line, matching upstream's two-row limit. As in upstream, `right` describes ordering rather than physical screen-right alignment.

Powerline-style notification statuses—extension status values beginning with `[`—are excluded from the compact bar and rendered as separate temporary lines above the editor. A status promoted to a configured custom item stays in that item instead.

## Configuration

The normal upstream settings shape is supported:

```json
{
  "powerline": {
    "preset": "default",
    "separator": "powerline-thin",
    "disabledSegments": ["cost"],
    "path": { "mode": "basename" },
    "git": { "polling": "full", "hostIcon": false },
    "context": { "format": "full" },
    "cache_read": { "format": "tokens" },
    "cost": {
      "subscriptionDisplay": "subscription",
      "currency": "USD"
    }
  }
}
```

Global settings come from `~/.pi/agent/settings.json` or `PI_CODING_AGENT_DIR`. Project `.pi/settings.json` values override them.

### Presets and command

Presets: `default`, `minimal`, `compact`, `full`, `nerd`, and `ascii`.

- `/powerline` toggles between this footer and Pi's native footer for the current process.
- `/powerline <preset>` applies and persists a preset while preserving object configuration.

### Custom statuses

```json
{
  "powerline": {
    "customItems": [
      {
        "id": "gondolin",
        "statusKey": "gondolin-vm",
        "position": "left",
        "prefix": "🏰",
        "color": "accent"
      },
      {
        "id": "cache-hit",
        "statusKey": "powerline-cache-hit",
        "position": "left",
        "color": "muted"
      },
      {
        "id": "last-response",
        "statusKey": "powerline-last-response",
        "position": "left"
      },
      {
        "id": "usage",
        "statusKey": "usage",
        "position": "right",
        "color": "accent"
      }
    ],
    "layout": {
      "left": ["custom:gondolin", "model", "thinking", "path", "git", "context_pct", "custom:cache-hit", "custom:last-response"],
      "right": ["custom:usage"],
      "secondary": ["extension_statuses"]
    }
  }
}
```

Custom item fields: `id`, `statusKey`, `position`, `prefix`, `color`, `hideWhenMissing`, and `excludeFromExtensionStatuses`. Colors accept Pi theme names or `#RRGGBB`.

### Status options retained from upstream

- `model.showThinkingLevel`, `model.display`
- `path.mode`, `path.maxLength`
- `git.showBranch`, `showStaged`, `showUnstaged`, `showUntracked`, `polling`, `hostIcon`
- `time.format`, `time.showSeconds`
- `cost.subscriptionDisplay`, `cost.currency`
- `context.format`
- `cache_read.format`
- `disabledSegments`, `layout`, and `separator`

Currencies: `USD`, `CNY`, `EUR`, `GBP`, `JPY`, `CAD`, `AUD`, `CHF`, `INR`, and `KRW`. Non-USD conversion retains upstream's lazy daily rate cache.

Separators: `powerline`, `powerline-thin`, `slash`, `pipe`, `dot`, `chevron`, `star`, `block`, `none`, and `ascii`.

## Nerd Fonts and theming

Nerd Fonts are detected for Ghostty, iTerm, WezTerm, Kitty, and Alacritty. Override detection with `POWERLINE_NERD_FONTS=1` or `POWERLINE_NERD_FONTS=0`.

Theme lookup order:

1. `~/.pi/agent/powerline-simple/theme.json`
2. Legacy `~/.pi/agent/extensions/powerline-footer/theme.json`
3. A `theme.json` beside the vendored theme module

```json
{
  "colors": {
    "model": "#d787af",
    "path": "#00afaf",
    "gitClean": "success"
  },
  "icons": {
    "folder": "󰉋"
  }
}
```

## Deliberate differences from upstream

- Uses `ctx.ui.setFooter()` below Pi's unchanged editor
- Places both upstream adaptive rows below the editor in the native footer
- Does not implement queue or shell runtime state
- Omits all workflow/editor features and input interception
- Ignores upstream placement because this package is always a bottom footer
- Retains upstream's separate above-editor widget for bracket-prefixed notification statuses
- Bundles independently loadable cache-hit/last-response status producers

## Development

```sh
devbox run -- npm test
npm pack --dry-run
```
