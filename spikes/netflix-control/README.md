# Spike: Netflix control (M1 part A)

> **Status: parked, untested.** Builds, but never run against Netflix. Disney+ was
> prioritised first; see `spike/disney-control`.

Throwaway. Goal: from an MV3 popup, read the playback position on `netflix.com/watch`
and play / pause / seek the player without breaking it.

## How it works

```
popup ──chrome.tabs.sendMessage──▶ bridge.js (isolated world)
                                       │ window.postMessage (tagged, request id)
                                       ▼
                                   page.js (MAIN world) ──▶ Netflix player API
```

- Seeking uses Netflix's internal player API (undocumented, times in ms):
  `netflix.appContext.state.playerApp.getAPI().videoPlayer`
  → `getVideoPlayerBySessionId(getAllPlayerSessionIds()[…])` → `seek(ms)`.
- Setting `<video>.currentTime` directly is reported to crash the player with **M7375**,
  so normal seeks never do it. The Diagnostics button does it on purpose to confirm.
- If the API isn't found, position/play/pause fall back to the `<video>` element and
  seek is refused. The popup shows which one is in use (`source: api | video`).
- Scripts match all of `www.netflix.com/*` because Netflix navigates browse → watch
  without a page load; `page.js` checks `location.pathname` per request.

## Run

```sh
cd spikes/netflix-control
corepack pnpm install   # or `pnpm install` if pnpm is on PATH
corepack pnpm build
```

Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → pick `dist/`.
After rebuilding, click the reload icon on the extension card **and** reload the Netflix tab.

## Test checklist

1. Open a title on netflix.com/watch, open the popup. Position ticks, `source: api`.
2. Play/Pause toggles playback.
3. −10s / +10s and "Seek to mm:ss" jump correctly with no Netflix error; position matches the scrubber.
4. Seek past the end → clamps to 1s before the end.
5. From the browse page, start a title **without reloading** → controls still work.
6. On a non-watch Netflix page → "not on a /watch page". On another site → "Open a netflix.com/watch page".
7. Diagnostics → Raw currentTime +10s → expect M7375 (reload the tab afterwards).

## Findings

_Fill in after testing (date, Chrome version):_

- API path still works?
- Session id format (`watch-…`?) and whether browse previews add extra sessions:
- Seek latency / accuracy:
- Raw `currentTime` → M7375 confirmed?
- Notes for the real extension: the page can see and forge our `postMessage` traffic;
  fine for this spike, needs a better design (e.g. no sensitive data over that channel).
