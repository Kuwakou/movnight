# Spike: Disney+ control (M1 part A)

Throwaway. Goal: from an MV3 popup, read the playback position on a Disney+ title
and play / pause / seek the player without breaking it. **Result: works** (see Findings).

## How it works

```
popup ──chrome.tabs.sendMessage──▶ content.js (isolated world)
                                       │ window.postMessage (tagged, request id, validated)
                                       ▼
                                   page.js (MAIN world) ──▶ disney-web-player.mediaPlayer
```

- **Position**: `disneyWebPlayer.getPlayheadPositionMs()` — movie time in ms.
- **Duration**: `mediaPlayer.timeline.info.programDurationMs`.
- **Paused**: `disney-web-player-ui.latestUiState.playback.isPaused`.
- **Play / pause**: `mediaPlayer.play()` / `mediaPlayer.pause()` (return promises).
- **Seek**: `mediaPlayer.seek(ms)` with movie time in ms, clamped to 1s before the end.
- `page.js` must run in the MAIN world: `mediaPlayer` is a JS property on the custom
  element, invisible from the isolated content script.
- `<video>` is only a fallback for reading and play/pause (popup shows `source: video`).
  It is never used to seek — see Findings.
- Scripts match all of `www.disneyplus.com/*` because navigation is client-side; the
  path (`/play/…`, optional locale prefix like `/en-gb/`) is checked per request.

## Run

```sh
cd spikes/disney-control
corepack pnpm install   # or `pnpm install` if pnpm is on PATH
corepack pnpm build
```

Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → pick `dist/`.
After rebuilding, click the reload icon on the extension card **and** reload the Disney+ tab.

## Test checklist

1. Play a title on disneyplus.com (address bar shows `/play/…`), open the popup.
2. Shows `source: api`; the time matches Disney+'s on-screen time; duration is the full length.
3. Play/Pause changes both the picture and Disney+'s own play button.
4. −10s / +10s and "Seek to h:mm:ss" (including far jumps) show ✓ and Disney+'s time display follows.
5. Seeking past the end clamps to 1s before the end.

Diagnostics buttons (log to the Disney+ tab's console) were used to discover the API;
kept for when Disney+ changes its player.

## Findings (2026-11-08)

- **`<video>` is not usable for sync.** Disney+ uses Media Source Extensions:
  `duration=Infinity`, and `currentTime` is a local timeline that starts at 0 per playback
  session (e.g. `<video>` 26.7s while the movie was at 4:45). `seekable` only covers what's
  loaded (`0–45s`), so seeks inside it land but far seeks are ignored. No error overlay
  (unlike Netflix's M7375) — it just doesn't do what we need.
- **Disney+ has a player API** on the `disney-web-player` element (`mediaPlayer`; the same
  object is `mediaPlayerApi` on `disney-web-player-ui`): `play`, `pause`, `seek`, `scrub`,
  `quickFastForward(offset)`, `quickRewind(offset)`, `seekToStart`, `timeline`, `on/off`.
  The timeline reports the whole programme as seekable.
- **Seeking via `mediaPlayer.seek(ms)` works**, including far jumps; Disney+'s UI stays in sync.
- The page also has a second, idle `<video>` (0×0, `readyState=0`); pick the loaded one.
- Synthetic ArrowRight key events don't seek. No timeline slider is exposed with
  `role=slider`/`input[type=range]`, so driving the UI isn't a practical alternative.
- `mediaPlayer.on/off` exist — worth exploring for event-driven state (instead of
  polling) in the real adapter.

## Notes for the real adapter

- This API is undocumented and minified-app internal; it can change without notice.
  Keep it behind the Disney+ adapter and fail loudly (`source` ≠ `api`) when it disappears.
- The page can see and forge our `postMessage` traffic. Fine for play/pause/seek; never
  send anything sensitive over that channel, and validate every message (done here).
