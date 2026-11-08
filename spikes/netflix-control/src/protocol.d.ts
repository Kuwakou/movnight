// Ambient types shared by page.ts, bridge.ts and popup.ts. Content scripts are
// classic scripts (no imports), so these are global declarations.

type Command =
  | { cmd: "getState" }
  | { cmd: "play" }
  | { cmd: "pause" }
  | { cmd: "seek"; ms: number }
  // Diagnostic: sets <video>.currentTime directly. Expected to trigger M7375.
  | { cmd: "rawSeek"; ms: number };

type PlayerState = {
  onWatchPage: boolean;
  source: "api" | "video" | "none";
  positionMs: number | null;
  durationMs: number | null;
  paused: boolean | null;
};

type Reply = { ok: true; state: PlayerState } | { ok: false; error: string };

// window.postMessage envelopes between bridge (isolated world) and page (MAIN world).
type PageRequest = { tag: "movnight-spike"; dir: "req"; id: string; command: Command };
type PageResponse = { tag: "movnight-spike"; dir: "res"; id: string; reply: Reply };
