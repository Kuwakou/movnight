# Spike: Disney+ sync through a local relay (M1 part A, step 2)

Throwaway. Goal (M1 demo): two browser windows on the same Disney+ title — one
pauses / plays / seeks **with Disney+'s own controls**, the other follows.

## How it works

```
Disney+ tab A                          relay (Node, your Mac)                    Disney+ tab B
page.js ⇄ content.js ⇄ background.js ⇄ ws://127.0.0.1:8787 ⇄ background.js ⇄ content.js ⇄ page.js
(player API) (detect/apply) (WebSocket)    (rooms, broadcast)
```

- **page.js** (MAIN world): the Disney+ adapter from `spikes/disney-control`
  (`getPlayheadPositionMs()`, `mediaPlayer.play/pause/seek(ms)`).
- **content.js**: detects local actions from `<video>` `play` / `pause` / `seeked`
  events, reads movie time from the adapter, sends it. Applies remote state.
- **background.js** (service worker): owns the WebSocket — a content script's socket
  would be blocked by disneyplus.com's CSP. Pings every 20s (keeps the worker alive,
  Chrome 116+) and reconnects with backoff.
- **relay/server.ts**: rooms + forward to the *other* members. Listens on 127.0.0.1 only and
  rejects non-extension origins (any website could otherwise connect to localhost).

### Sync message (v0)

`{ v: 0, room, from, seq, type: "play"|"pause"|"seek", playing, positionMs, sentAt }`

Every message carries the sender's full state (`playing`, `positionMs` in movie time);
`type` is only the cause. The background validates shape, room, sender (not one of our
own tabs) and that `seq` increases per sender before passing it to the tab.

### Applying remote state / loop prevention

- Receiver aligns to the sender's state: pause first, seek if more than 1s apart
  (0.3s when paused, so both freeze on the same frame), then play. Adds transit time
  to the position when playing.
- Local events within 2s after applying a remote one are ours, not the user's, so
  they're not sent.
- Applying is idempotent: if an echo slips through (e.g. a far seek finishing after 2s),
  the other side is already in that state and does nothing. Loops die out.

## Run

```sh
cd spikes/disney-sync
corepack pnpm install
corepack pnpm build
corepack pnpm relay        # keep this terminal open: "relay listening on ws://127.0.0.1:8787"
```

Load `dist/` unpacked in **two Chrome profiles** (profile icon → Add). Two profiles = two
extension instances. (Two tabs in the *same* profile share one connection and don't sync
with each other.)

## Test checklist

1. In both profiles: log in to Disney+, open the **same title**, mute one window.
   Your plan must allow 2 simultaneous streams.
2. Each popup: `connected · 2 in room "test"`, `1 Disney+ tab(s) attached`.
3. Window A, using Disney+'s controls: pause → B pauses on the same frame; play → B plays;
   drag the timeline / ±10s → B jumps. Popup logs show `→ out` in A and `← in` in B.
4. Repeat from B. No ping-pong: each action appears once per side.
5. Stop the relay (Ctrl+C) and restart it → both popups reconnect within ~10s.
6. Change the room in one popup → that window stops syncing; change it back → syncs again.

Console (DevTools on the Disney+ tab) shows `[movnight sync] sent …`, `applied remote …`,
`suppressed local …` lines.

## Findings

_Fill in after testing (date, Chrome version):_

- Pause / play / seek follow? Typical delay?
- Same frame on pause?
- Any loops, missed events or double events?
- Does opening/reloading a title make the other window jump (autoplay sends `play`/`seek`)?
- Reconnect after relay restart?

## Known limits (left for M5)

- No join catch-up, ongoing drift correction, buffering handling or ad handling.
- A genuine user action within 2s of a remote one is swallowed.
- `sentAt` latency compensation assumes both clocks agree (true on one machine).
- Room resets to `test` if Chrome restarts the service worker.
- Two machines need a reachable `wss://` relay (e.g. a tunnel); real version uses LiveKit (M4).
