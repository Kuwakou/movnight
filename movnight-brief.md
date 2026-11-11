# movnight — Project Brief & Roadmap

_Owner: Kou · PM: Claude · Builder: Kou with Claude Code · Created: 2026-11-08_

## 1. Goal
A way for Kou and his girlfriend to watch movies together online, each on their own streaming account, while on a video call. Personal project first; a public release may follow if it works well.

## 2. Confirmed decisions
| # | Decision |
|---|---|
| D1 | First version runs in **desktop Chrome/Edge only**. Mobile app comes later (see Risks). |
| D2 | Pieces: **web app** (accounts, rooms, invites) + **Chrome extension** (sync + call panel on the streaming page) + **backend**. |
| D3 | **TypeScript everywhere**: React web app, TypeScript extension, TypeScript backend. |
| D4 | **Supabase** for accounts and database. Sign-in with email/password and Google first. **Apple sign-in added before public release** (needs a paid Apple Developer account). |
| D5 | **LiveKit** (hosted, WebRTC) for voice/video calls. Calling is required. Chat is out of scope for now. |
| D6 | Users sign in to the streaming service **on the service's own site**. movnight never asks for, sees or stores streaming passwords. |
| D7 | Services in order: **Netflix → Disney+ → Apple TV**. |
| D8 | **Free tiers only** while proving it works. A few dollars a month is OK later. |
| D9 | **First goal:** Kou and his girlfriend watch one Netflix movie in sync while on a video call. |

## 3. Proposed architecture (to confirm at Milestone 2)
- **Monorepo** (pnpm workspaces): `apps/web`, `apps/extension`, `packages/shared` (types, sync protocol), `supabase/` (database schema, edge functions).
- **No separate always-on server at first.** Supabase handles accounts, the database (rooms, invites) and edge functions. One edge function issues short-lived LiveKit tokens.
- **Playback sync runs over LiveKit data messages** in the same room as the call. That's one realtime connection instead of two, and it stays free.
- The extension loads only on the three streaming sites and adds a small control/call panel to the page.

## 4. User flow (first version)
1. Sign in to movnight (email or Google).
2. Create a room → choose a service (Netflix) → paste or choose a movie link → copy the invite link.
3. Partner opens the invite → signs in → joins the room.
4. Both click "Open in Netflix" → sign in to Netflix if needed → the extension detects the player.
5. The call panel connects. Play, pause and seek stay in sync for both.

## 5. Roadmap
Each milestone ends with a demo you can run. Don't start the next one until the current demo works.

**M1 — Prove the risky parts (throwaway code)**
- A: A minimal extension that can read and control the Netflix player (play, pause, seek) on one machine, then two machines synced through a simple relay.
- B: A camera and mic call working *inside the extension UI on netflix.com* (side panel vs injected iframe — test both).
- Demo: two browser windows, one pauses, the other pauses.
- _If either part fails, we re-plan before building anything else._

**M2 — Foundations**
- Monorepo, linting, shared types. Supabase project. Web app with sign up, sign in and sign out (email + Google). Profile row protected by Row Level Security.
- Demo: create an account, sign out, sign back in.

**M3 — Rooms & invites**
- Create a room. Invite link that's hard to guess and expires. Join the room. Choose service + movie. Room page in the web app.
- Demo: you create a room, a second account joins via the link.

**M4 — Call**
- Edge function that issues LiveKit tokens (short-lived, valid only for that room and only for room members). Call panel in the extension: mute, camera off, leave.
- Demo: video call between two accounts while on netflix.com.

**M5 — Sync (Netflix)**
- Sync protocol in `packages/shared`: playing/paused, position, timestamp, who acted. Join catch-up (a late joiner jumps to the current position). Drift correction. Buffering handling. Loop prevention (applying a remote event must not send it back out).
- Demo: a full movie with pausing, seeking and one person reloading the page.

**M6 — Movie night 🎬**
- Polish, error messages, a "use headphones" tip. Install the extension unpacked on both laptops (no Chrome Web Store needed for two people).
- Demo: the real thing. **First goal reached.**

**Later (in rough order)**
- M7 Disney+ adapter · M8 Apple TV adapter
- Apple sign-in · text chat
- Security review → Chrome Web Store listing → terms-of-use review per service → public release
- Mobile app research (call only vs sync)

## 6. Risks
| Risk | Plan |
|---|---|
| Netflix's player may break or error when seeked directly | Each service gets its own adapter; spike in M1. |
| Camera/mic permission inside the extension on streaming sites | Spike in M1 (side panel vs iframe). |
| Netflix plans with ads: ad breaks won't line up between users | Detect ads → pause the other person until both are back. Note it for M5. |
| Echo between call audio and movie audio | Recommend headphones; LiveKit echo cancellation. |
| Mobile/TV apps can't run extensions | Treat mobile as a separate product decision later. |
| Streaming services' terms of use | Review before any public release. |
| Free-tier limits (Supabase pauses idle projects; LiveKit has minute caps) | Check the current limits at setup; fine for two users. |

## 7. Security rules (always on)
- Never handle streaming credentials.
- Supabase Row Level Security on every table; no service key in the web app or extension.
- LiveKit tokens are issued only by the server side, are short-lived and are scoped to one room.
- Extension: minimum permissions, host access limited to the three streaming sites + movnight; validate every incoming sync message.
- Secrets live in `.env` files that are git-ignored.

## 8. How we work with Claude Code
- `CLAUDE.md` at the repo root holds the context and the rules.
- One milestone (or one part of one) per session. Ask for a plan first, approve it, then build.
- Kou reviews every diff and commits after each working step.
- Bring the demo result back to PM (this project) to tick off the milestone and plan the next one.

## 9. Status
- [x] Requirements & decisions (2026-11-08)
- [ ] M1 Prove risky parts
- [ ] M2 Foundations
- [ ] M3 Rooms & invites
- [ ] M4 Call
- [ ] M5 Sync
- [ ] M6 Movie night
