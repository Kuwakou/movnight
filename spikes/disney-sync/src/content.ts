// Isolated world. Detects local play/pause/seek from <video> events, reads movie
// time from the player API (page.ts), sends to background; applies remote state.
(() => {
  const TAG = "movnight-spike";
  const LOG = "[movnight sync]";
  const PAGE_TIMEOUT_MS = 2000;
  // Local events within this window after applying a remote one are ours, not the user's.
  const SUPPRESS_MS = 2000;
  // Only seek if further apart than this (pause aims for the same frame).
  const SEEK_THRESHOLD_MS = 1000;
  const PAUSE_SEEK_THRESHOLD_MS = 300;

  const onWatchPage = () => /^\/(?:[a-z]{2}-[a-z]{2}\/)?(?:play|video)\//.test(location.pathname);
  const fmt = (ms: number) => new Date(ms).toISOString().slice(11, 19);

  // --- page.ts relay ------------------------------------------------------

  function isValidPageResult(r: unknown): r is PageResult {
    if (typeof r !== "object" || r === null) return false;
    const res = r as { ok?: unknown; api?: unknown; error?: unknown };
    if (res.ok === false) return typeof res.error === "string";
    if (res.ok !== true) return false;
    if (res.api === null) return true;
    const a = res.api as Record<string, unknown>;
    const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
    return (
      typeof a === "object" && finite(a.positionMs) &&
      (a.durationMs === null || finite(a.durationMs)) && (a.paused === null || typeof a.paused === "boolean")
    );
  }

  function askPage(cmd: PageCmd, ms?: number): Promise<PageResult> {
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        resolve({ ok: false, error: "Page script did not respond" });
      }, PAGE_TIMEOUT_MS);
      function onMessage(event: MessageEvent) {
        if (event.source !== window) return;
        const data = event.data as Partial<PageResponse> | null;
        if (!data || data.tag !== TAG || data.dir !== "res" || data.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve(isValidPageResult(data.result) ? data.result : { ok: false, error: "Malformed reply from page" });
      }
      window.addEventListener("message", onMessage);
      const req: PageRequest = { tag: TAG, dir: "req", id, cmd, ms };
      window.postMessage(req, location.origin);
    });
  }

  // --- Background port ----------------------------------------------------

  let port: chrome.runtime.Port | null = null;

  function connectPort() {
    if (!chrome.runtime?.id) return; // extension reloaded: this script is orphaned
    port = chrome.runtime.connect({ name: "sync" });
    port.onMessage.addListener(onPortMessage);
    // The worker can be restarted by Chrome; reconnect.
    port.onDisconnect.addListener(() => {
      port = null;
      setTimeout(connectPort, 1000);
    });
  }

  // --- Local -> remote ----------------------------------------------------

  let suppressUntil = 0;

  // The page also has an idle spare <video>; only react to the one that's playing content.
  const isMainVideo = (t: EventTarget | null): t is HTMLVideoElement =>
    t instanceof HTMLVideoElement && t.readyState > 0 && t.clientWidth > 0;

  async function onLocal(type: SyncType, target: EventTarget | null) {
    if (!onWatchPage() || !isMainVideo(target)) return;
    if (Date.now() < suppressUntil) return console.log(`${LOG} suppressed local ${type} (caused by remote)`);
    const res = await askPage("apiState");
    if (!res.ok || !res.api) return console.log(`${LOG} local ${type} not sent: player API unavailable`);
    const playing = type === "play" ? true : type === "pause" ? false : !target.paused;
    const out: PortOut = { t: "local", type, playing, positionMs: res.api.positionMs };
    port?.postMessage(out);
    console.log(`${LOG} sent ${type} ${playing ? "playing" : "paused"} @ ${fmt(out.positionMs)}`);
  }

  // Media events don't bubble, but capture on document still sees them.
  const EVENTS: [string, SyncType][] = [["play", "play"], ["pause", "pause"], ["seeked", "seek"]];
  for (const [event, type] of EVENTS) {
    document.addEventListener(event, (e) => void onLocal(type, e.target), true);
  }

  // --- Remote -> local ----------------------------------------------------

  function isValidPortIn(m: unknown): m is PortIn {
    if (typeof m !== "object" || m === null) return false;
    const { t, msg } = m as { t?: unknown; msg?: Partial<SyncMsg> };
    return (
      t === "remote" && typeof msg === "object" && msg !== null &&
      typeof msg.playing === "boolean" && typeof msg.positionMs === "number" && Number.isFinite(msg.positionMs) &&
      typeof msg.sentAt === "number" && typeof msg.type === "string"
    );
  }

  // Align to the sender's state. Idempotent: an echo of our own state is a no-op.
  async function applyRemote(msg: SyncMsg) {
    if (!onWatchPage()) return;
    const res = await askPage("apiState");
    if (!res.ok || !res.api) return console.log(`${LOG} remote ${msg.type} not applied: player not ready`);
    const cur = res.api;

    const latency = msg.playing ? Math.max(0, Date.now() - msg.sentAt) : 0;
    const target = msg.positionMs + latency;
    const threshold = msg.playing ? SEEK_THRESHOLD_MS : PAUSE_SEEK_THRESHOLD_MS;
    const needSeek = Math.abs(cur.positionMs - target) > threshold;
    const needPlay = msg.playing && cur.paused !== false;
    const needPause = !msg.playing && cur.paused !== true;
    if (!needSeek && !needPlay && !needPause) return console.log(`${LOG} remote ${msg.type}: already in sync`);

    suppressUntil = Date.now() + SUPPRESS_MS;
    // Pause first so the seek lands on a frozen frame; seek before play.
    if (needPause) await askPage("apiPause");
    if (needSeek) await askPage("apiSeek", target);
    if (needPlay) await askPage("apiPlay");
    console.log(
      `${LOG} applied remote ${msg.type}: ${msg.playing ? "playing" : "paused"} @ ${fmt(target)}` +
        ` (was ${fmt(cur.positionMs)}, latency ${latency}ms, seek=${needSeek} play=${needPlay} pause=${needPause})`,
    );
  }

  // Apply in order, one at a time.
  let applying = Promise.resolve();
  function onPortMessage(m: unknown) {
    if (!isValidPortIn(m)) return;
    applying = applying.then(() => applyRemote(m.msg)).catch((e) => console.log(`${LOG} apply failed:`, e));
  }

  connectPort();
})();
