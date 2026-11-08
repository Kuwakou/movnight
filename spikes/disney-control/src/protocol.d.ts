// Ambient types shared by content.ts, page.ts and popup.ts. Content scripts are
// classic scripts (no imports), so these are global declarations.

// Popup -> content.ts
type Command =
  | { cmd: "getState" }
  | { cmd: "play" }
  | { cmd: "pause" }
  | { cmd: "seek"; ms: number } // movie time
  // Diagnostics: each logs to the Disney+ tab's console.
  | { cmd: "dump" } // custom elements and every <video>
  | { cmd: "probeRanges" } // video.seekable / buffered
  | { cmd: "probeControls" } // sliders and skip/seek buttons in the player UI
  | { cmd: "probeKeys" } // synthetic ArrowRight: does the position jump?
  | { cmd: "probeApi" } // player element methods/fields (page.ts)
  | { cmd: "probeMediaPlayer" }; // mediaPlayer values, method sources, playhead getters (page.ts)

type SeekCheck = {
  targetMs: number;
  landedMs: number | null; // null until the check has run
};

type PlayerState = {
  onWatchPage: boolean;
  // "api": Disney+ mediaPlayer (movie time). "video": <video> fallback (local MSE time, not movie time).
  source: "api" | "video" | "none";
  videoPath: string | null; // e.g. "document > video"
  positionMs: number | null;
  durationMs: number | null;
  paused: boolean | null;
  lastSeek: SeekCheck | null;
};

type Reply = { ok: true; state: PlayerState; note?: string } | { ok: false; error: string };

// content.ts <-> page.ts (MAIN world) over window.postMessage.
type PageCmd = "apiState" | "apiPlay" | "apiPause" | "apiSeek" | "probeApi" | "probeMediaPlayer";
type ApiState = { positionMs: number; durationMs: number | null; paused: boolean | null };
type PageResult = { ok: true; api: ApiState | null; note?: string } | { ok: false; error: string };
type PageRequest = { tag: "movnight-spike"; dir: "req"; id: string; cmd: PageCmd; ms?: number };
type PageResponse = { tag: "movnight-spike"; dir: "res"; id: string; result: PageResult };
