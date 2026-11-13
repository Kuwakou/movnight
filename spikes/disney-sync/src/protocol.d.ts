// Ambient types shared by the extension scripts. Content scripts and the service
// worker are classic scripts (no imports), so these are global declarations.

type SyncType = "play" | "pause" | "seek";

// Sync protocol v0 (throwaway). Every message carries the sender's full state;
// `type` is only what caused it. Receivers align to the state.
type SyncMsg = {
  v: 0;
  room: string;
  from: string; // random id per tab connection
  seq: number; // increases per sender
  type: SyncType;
  playing: boolean;
  positionMs: number; // movie time
  sentAt: number; // Date.now() at the sender
};

// background <-> relay
type RelayOut = { t: "join"; room: string } | { t: "sync"; msg: SyncMsg } | { t: "ping" };
type RelayIn = { t: "presence"; room: string; count: number } | { t: "sync"; msg: SyncMsg } | { t: "pong" };

// content <-> background (runtime port "sync")
type PortOut = { t: "local"; type: SyncType; playing: boolean; positionMs: number };
type PortIn = { t: "remote"; msg: SyncMsg };

// popup <-> background
type PopupCmd = { t: "status" } | { t: "setRoom"; room: string };
type LogEntry = { dir: "in" | "out"; type: SyncType; playing: boolean; positionMs: number; at: number };
type Status = {
  room: string;
  connection: "connecting" | "connected" | "disconnected";
  inRoom: number;
  tabs: number;
  log: LogEntry[];
};

// content.ts <-> page.ts (MAIN world) over window.postMessage
type PageCmd = "apiState" | "apiPlay" | "apiPause" | "apiSeek";
type ApiState = { positionMs: number; durationMs: number | null; paused: boolean | null };
type PageResult = { ok: true; api: ApiState | null } | { ok: false; error: string };
type PageRequest = { tag: "movnight-spike"; dir: "req"; id: string; cmd: PageCmd; ms?: number };
type PageResponse = { tag: "movnight-spike"; dir: "res"; id: string; result: PageResult };
