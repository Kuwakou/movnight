# movnight

Watch movies together online. Each user watches on their OWN streaming account
(Netflix first, then Disney+, Apple TV) while a Chrome extension keeps playback in
sync and shows a voice/video call panel.

## Stack (decided — don't change without asking)
- TypeScript everywhere. pnpm workspaces monorepo.
- `apps/web` — React + Vite: accounts, rooms, invites
- `apps/extension` — Chrome Manifest V3 extension: player adapters, sync, call panel
- `packages/shared` — shared types and the sync protocol
- `supabase/` — schema, Row Level Security policies, edge functions
- Supabase: auth (email/password + Google; Apple later), Postgres, edge functions
- LiveKit Cloud: calls (WebRTC); playback sync goes over LiveKit data messages
- Free tiers only for now

## Current milestone
See the roadmap in the project brief. Work only on the current milestone.
Current: **M1 — prove the risky parts** (throwaway spike code in `spikes/`).

## Hard rules
- NEVER ask for, handle, store or log streaming-service credentials.
- Never put the Supabase service-role key or the LiveKit API secret in the web app or extension.
- Row Level Security on every table.
- LiveKit tokens: issued by an edge function only, short-lived, scoped to one room, room members only.
- Extension: minimum permissions; host access only for netflix.com, disneyplus.com,
  tv.apple.com and the movnight domain.
- Validate every incoming sync message (shape, room, sender).
- Secrets live in `.env*`, which is git-ignored. Commit a `.env.example` instead.

## Working style
- Propose a plan before writing code; wait for approval.
- Small steps; each step should be runnable. Tell me how to test it.
- Each streaming service gets its own player adapter behind a common interface.
- Explain non-obvious decisions briefly in the PR/commit message, not in long comments.
