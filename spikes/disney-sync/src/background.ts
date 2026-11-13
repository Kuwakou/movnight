// Service worker: owns the relay WebSocket (the page's CSP would block it in a
// content script) and passes sync messages between the relay and Disney+ tabs.
(() => {
  const RELAY_URL = "ws://127.0.0.1:8787";
  const PING_MS = 20_000; // < 30s idle limit; WebSocket traffic keeps the worker alive (Chrome 116+)
  const MAX_BACKOFF_MS = 10_000;
  const LOG_SIZE = 10;
  const ROOM_RE = /^[\w-]{1,64}$/;
  const TYPES = new Set(["play", "pause", "seek"]);

  // Not persisted: resets to "test" if Chrome restarts the worker.
  let room = "test";
  let ws: WebSocket | null = null;
  let connection: Status["connection"] = "disconnected";
  let inRoom = 0;
  let backoffMs = 1000;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  const log: LogEntry[] = [];

  // One entry per connected Disney+ tab; `id` is that tab's `from` on the wire.
  const tabs = new Map<chrome.runtime.Port, { id: string; seq: number }>();
  const lastSeqFrom = new Map<string, number>();

  function addLog(dir: LogEntry["dir"], m: { type: SyncType; playing: boolean; positionMs: number }) {
    log.unshift({ dir, type: m.type, playing: m.playing, positionMs: m.positionMs, at: Date.now() });
    log.length = Math.min(log.length, LOG_SIZE);
  }

  const relaySend = (m: RelayOut) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));

  // --- Relay --------------------------------------------------------------

  function connect() {
    if (ws && ws.readyState <= WebSocket.OPEN) return;
    connection = "connecting";
    const socket = new WebSocket(RELAY_URL);
    ws = socket;

    socket.onopen = () => {
      connection = "connected";
      backoffMs = 1000;
      relaySend({ t: "join", room });
      clearInterval(pingTimer);
      pingTimer = setInterval(() => relaySend({ t: "ping" }), PING_MS);
    };
    socket.onmessage = (event) => onRelayMessage(String(event.data));
    socket.onclose = () => {
      if (ws !== socket) return;
      ws = null;
      connection = "disconnected";
      inRoom = 0;
      clearInterval(pingTimer);
      setTimeout(connect, backoffMs);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    };
  }

  function isValidSyncMsg(m: unknown): m is SyncMsg {
    if (typeof m !== "object" || m === null) return false;
    const s = m as Record<string, unknown>;
    const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
    return (
      s.v === 0 &&
      typeof s.room === "string" &&
      typeof s.from === "string" && s.from.length <= 64 &&
      Number.isInteger(s.seq) &&
      typeof s.type === "string" && TYPES.has(s.type) &&
      typeof s.playing === "boolean" &&
      finite(s.positionMs) && (s.positionMs as number) >= 0 &&
      finite(s.sentAt)
    );
  }

  function onRelayMessage(raw: string) {
    let m: RelayIn;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m?.t === "presence" && m.room === room && Number.isInteger(m.count)) {
      inRoom = m.count;
      return;
    }
    if (m?.t !== "sync") return;

    // Validate shape, room and sender (CLAUDE.md rule).
    const msg = m.msg;
    if (!isValidSyncMsg(msg)) return console.log("dropped malformed sync message", msg);
    if (msg.room !== room) return console.log("dropped sync for another room", msg.room);
    if ([...tabs.values()].some((t) => t.id === msg.from)) return; // our own tab
    if (msg.seq <= (lastSeqFrom.get(msg.from) ?? -1)) return console.log("dropped stale/replayed sync", msg);
    lastSeqFrom.set(msg.from, msg.seq);

    addLog("in", msg);
    const out: PortIn = { t: "remote", msg };
    for (const port of tabs.keys()) port.postMessage(out);
  }

  // --- Tabs ---------------------------------------------------------------

  function isValidPortOut(m: unknown): m is PortOut {
    if (typeof m !== "object" || m === null) return false;
    const s = m as Record<string, unknown>;
    return (
      s.t === "local" &&
      typeof s.type === "string" && TYPES.has(s.type) &&
      typeof s.playing === "boolean" &&
      typeof s.positionMs === "number" && Number.isFinite(s.positionMs) && s.positionMs >= 0
    );
  }

  chrome.runtime.onConnect.addListener((port) => {
    const url = port.sender?.url ? new URL(port.sender.url) : null;
    if (port.name !== "sync" || port.sender?.id !== chrome.runtime.id || !port.sender.tab || url?.hostname !== "www.disneyplus.com") {
      port.disconnect();
      return;
    }
    const tab = { id: crypto.randomUUID(), seq: 0 };
    tabs.set(port, tab);
    connect();

    port.onMessage.addListener((m: unknown) => {
      if (!isValidPortOut(m)) return;
      const msg: SyncMsg = {
        v: 0, room, from: tab.id, seq: tab.seq++, type: m.type, playing: m.playing, positionMs: m.positionMs, sentAt: Date.now(),
      };
      addLog("out", msg);
      relaySend({ t: "sync", msg });
    });
    port.onDisconnect.addListener(() => tabs.delete(port));
  });

  // --- Popup --------------------------------------------------------------

  chrome.runtime.onMessage.addListener((m: PopupCmd, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return; // popup only
    if (m?.t === "setRoom") {
      if (typeof m.room !== "string" || !ROOM_RE.test(m.room)) return sendResponse({ error: "Room: 1–64 letters, digits, - or _" });
      room = m.room;
      inRoom = 0;
      relaySend({ t: "join", room });
    }
    connect();
    const status: Status = { room, connection, inRoom, tabs: tabs.size, log };
    sendResponse(status);
  });
})();
