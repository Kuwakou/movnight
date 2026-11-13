# movnight — Progress report: Milestone 1 so far

_covers 2026-11-08 to 2026-11-13_

## 1. What this project is for

movnight lets two people watch a movie together online while each uses **their own
streaming account**. A Chrome extension keeps both players in sync (play, pause, seek)
and shows a video call next to the movie.

The first goal is personal: my girlfriend and I watching one movie together, in sync,
while on a video call. If it works well it may become public later.

How it fits together (planned):

- **Web app** (React) for accounts, rooms and invite links.
- **Chrome extension** that controls the streaming player and shows the call panel.
- **Supabase** for sign-in and the database; **LiveKit** for the video call, and for
  carrying the sync messages in the same connection.
- Each person signs in to the streaming service on its own site. movnight never sees
  streaming passwords.

The roadmap starts with **Milestone 1 (M1): prove the risky parts** with throwaway code
before building anything real:

- **M1-A:** control a streaming player from an extension, then keep two windows in sync.
- **M1-B:** run a camera/mic call inside the extension on the streaming site.

## 2. Challenges and how they were solved

### 2.1 Netflix breaks when you jump to a time directly

**Challenge.** The obvious way to seek a web video is to set the `<video>` element's
time. Research showed Netflix detects this and stops playback with error **M7375**.

**Solution.** Developers have found that Netflix has its own internal player API
(`videoPlayer.seek(ms)`) that seeks safely. It's only reachable from code running inside
the page itself, so the extension injects a small script into the page ("MAIN world")
and talks to it through validated messages.

**Status.** Built (`spikes/netflix-control`), but **never tested**: I don't have my own
Netflix account, only a family one. It's parked on its own branch for later.

### 2.2 Changing the plan: Disney+ first

**Challenge.** I couldn't test Netflix properly.

**Solution.** I have my own Disney+ account, so I made **Disney+ the first service**
(then Netflix, then Apple TV). The project rules (`CLAUDE.md`) and the brief were updated
to match. Each service gets its own "adapter" anyway, so the order doesn't change the design.

### 2.3 On Disney+, the video's clock isn't the movie's clock

**Challenge.** The first Disney+ spike controlled the `<video>` element directly.
Reading the time and play/pause worked, but:

- Seeking far ahead silently did nothing.
- The time shown by the extension didn't match Disney+'s own time display at all.
- The video reported its length as "infinite".

**Investigation.** I added diagnostic buttons that log what's on the page. They showed:

- Disney+ streams the movie in chunks, and the `<video>` element's clock **restarts at
  0** for each viewing session (e.g. `<video>` said 0:26 while the movie was at 4:45).
- The browser only lets you seek within the part that has already loaded (about the
  first 40 seconds).
- There's a second, idle `<video>` element on the page that has to be ignored.

So `<video>` time is useless for sync: it means something different for each person.

**Solution.** Another probe listed the properties of Disney+'s player element and found
its internal API:

- `getPlayheadPositionMs()` → the real movie time.
- `mediaPlayer.seek(ms)`, `play()`, `pause()` → control through Disney+'s own player.
- The player's timeline → the full movie length, and it confirms the whole movie is seekable.

With these, far seeks work and Disney+'s own controls stay in sync. Like Netflix, this
API is only visible from inside the page, so the same MAIN-world script approach is used.
Every seek checks itself afterwards (target vs. where it actually landed).

**Status.** ✅ One-machine control works (`spikes/disney-control`).

### 2.4 Syncing two windows: where the connection can live

**Challenge.** To sync, both windows need to talk through a relay (a small server that
forwards messages). The first idea was to open that connection from the extension's
script on the Disney+ page, but the page's security policy (CSP) blocks connections
to unknown servers.

**Solution.** The connection lives in the extension's **background service worker**,
which isn't bound by Disney+'s rules. The page script passes messages to it.

A second problem: Chrome shuts background workers down after 30 seconds of inactivity.
Since Chrome 116, WebSocket traffic keeps them alive, so the worker sends a small ping
every 20 seconds and reconnects automatically if the connection drops.

### 2.5 Avoiding endless ping-pong

**Challenge.** When window B copies window A's pause, B's player also fires a "pause"
event. If B sent that back, A would react to it, and the two would bounce forever.

**Solution.** Two layers:

- After applying a remote action, a window ignores its own player events for 2 seconds.
- Applying is "idempotent": each message carries the full state (playing/paused +
  position), and a window only acts if it's actually different. If an echo slips
  through, the other side is already in that state and does nothing.

### 2.6 Security along the way

- **No streaming passwords**, ever. Users sign in on the streaming site.
- **Every message is validated**: shape, room, sender, and a sequence number so old or
  repeated messages are dropped.
- **The local relay could be reached by any website** open in the browser (websites can
  connect to `localhost`). It now only listens on this Mac and **rejects anything that
  isn't a Chrome extension**.
- The extension asks for **no extra permissions**; it only runs on disneyplus.com.

### 2.7 Setup gotchas found while testing

- Chrome must load the built **`dist/`** folder, not the source folder.
- Pages open *before* the extension is (re)loaded don't get its scripts: **reload the
  Disney+ tab** after reloading the extension. The popup now says so.
- Two tabs in the same Chrome profile share one connection, so testing uses **two Chrome
  profiles**.
- Two spike extensions on the same site can interfere: keep only one enabled.

**Status.** ✅ The M1-A demo works: two Chrome windows on the same Disney+ title,
pausing in one pauses the other (`spikes/disney-sync`).

## 3. What's next

### Immediately: M1-B — the video call inside the extension

The second big risk. Test two ways of showing a camera/mic call on disneyplus.com:

- Chrome's **side panel** (sits next to the page).
- An **iframe injected into the page** (could float over the movie).

Questions to answer: Does camera/mic permission work in each? Does Disney+'s security
policy allow the iframe? What happens in fullscreen? If either part of M1 fails, the
plan says to re-plan before building anything else.

### Then: the real build (M2 → M6)

- **M2 Foundations:** monorepo, Supabase project, sign up / sign in (email + Google).
- **M3 Rooms & invites:** create a room, share a hard-to-guess expiring invite link.
- **M4 Call:** secure LiveKit tokens from a server function; call panel with mute/camera/leave.
- **M5 Sync:** a proper sync protocol over LiveKit. Things the spike deliberately skipped:
  - a late joiner catching up to the current position,
  - correcting slow drift during the movie,
  - handling buffering and ad breaks,
  - clocks that differ between two computers,
  - a real user action within 2 seconds of a remote one is currently ignored.
- **M6 Movie night:** polish, then the real thing with my girlfriend. 🎬

### Risks to keep in mind

- The Disney+ and Netflix player APIs are **undocumented** and can change without
  notice. They stay behind per-service adapters, and the extension should say clearly
  when one stops working.
- Watching on two accounts needs each plan to allow the stream; ad-supported plans will
  have ad breaks that don't line up.

## Where things are

| Branch / folder | What |
|---|---|
| `spike/netflix-control` → `spikes/netflix-control` | Netflix control, parked, untested |
| `spike/disney-control` → `spikes/disney-control` | Disney+ control + diagnostic probes |
| `spike/disney-sync` → `spikes/disney-sync` | Two-window sync through a local relay |
| `movnight-brief.md` | Project brief and roadmap |
| `CLAUDE.md` | Project rules for Claude Code |
