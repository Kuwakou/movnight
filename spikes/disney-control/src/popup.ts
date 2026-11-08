(() => {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const posEl = $("pos");
  const metaEl = $("meta");
  const seekResultEl = $("seek-result");
  const errorEl = $("error");
  const pathEl = $("path");
  const noteEl = $("note");
  const targetEl = $<HTMLInputElement>("target");

  // Seek within this much of the target counts as landed.
  const LANDED_TOLERANCE_MS = 2000;

  let last: PlayerState | null = null;

  function fmt(ms: number | null): string {
    if (ms === null) return "--:--";
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, "0");
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
  }

  function parseTime(text: string): number | null {
    const parts = text.trim().split(":").map(Number);
    if (parts.length < 1 || parts.length > 3 || parts.some((p) => !Number.isInteger(p) || p < 0)) return null;
    return parts.reduce((acc, p) => acc * 60 + p, 0) * 1000;
  }

  async function send(command: Command): Promise<Reply> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return { ok: false, error: "No active tab" };
    try {
      return (await chrome.tabs.sendMessage(tab.id, command)) as Reply;
    } catch {
      return { ok: false, error: "Open a title on disneyplus.com (reload the tab if the extension was just loaded)" };
    }
  }

  function seekText(check: SeekCheck | null): string {
    if (!check) return "last seek: –";
    if (check.landedMs === null) return `last seek: target ${fmt(check.targetMs)} → checking…`;
    // Playback keeps running after the seek, so allow for the check delay.
    const drift = check.landedMs - check.targetMs;
    const ok = drift >= -LANDED_TOLERANCE_MS && drift <= LANDED_TOLERANCE_MS + 1500;
    return `last seek: target ${fmt(check.targetMs)} → landed ${fmt(check.landedMs)} ${ok ? "✓" : "✗"}`;
  }

  // Keep action errors visible; otherwise the next poll would clear them.
  let stickyErrorUntil = 0;

  function render(reply: Reply, fromAction = false) {
    if (!reply.ok) {
      errorEl.textContent = reply.error;
      if (fromAction) stickyErrorUntil = Date.now() + 4000;
      return;
    }
    if (Date.now() > stickyErrorUntil) errorEl.textContent = "";
    last = reply.state;
    const s = reply.state;
    posEl.textContent = `${fmt(s.positionMs)} / ${fmt(s.durationMs)}`;
    const playing = s.paused === null ? "?" : s.paused ? "paused" : "playing";
    metaEl.textContent = !s.onWatchPage
      ? "not on a /play/ page"
      : s.source === "none"
        ? "no player found"
        : `source: ${s.source}${s.source === "video" ? " (not movie time!)" : ""} · ${playing}`;
    seekResultEl.textContent = seekText(s.lastSeek);
    pathEl.textContent = `video: ${s.videoPath ?? "–"}`;
    if (reply.note) noteEl.textContent = reply.note;
  }

  async function act(command: Command) {
    render(await send(command), true);
  }

  const relSeek = (deltaMs: number) => {
    if (last?.positionMs == null) return;
    void act({ cmd: "seek", ms: Math.max(0, last.positionMs + deltaMs) });
  };

  $("back").addEventListener("click", () => relSeek(-10_000));
  $("fwd").addEventListener("click", () => relSeek(10_000));
  $("toggle").addEventListener("click", () => void act({ cmd: last?.paused ? "play" : "pause" }));
  $("seek").addEventListener("click", () => {
    const ms = parseTime(targetEl.value);
    if (ms === null) errorEl.textContent = "Use mm:ss or h:mm:ss";
    else void act({ cmd: "seek", ms });
  });
  for (const cmd of ["dump", "probeRanges", "probeApi", "probeControls", "probeKeys", "probeMediaPlayer"] as const) {
    $(cmd).addEventListener("click", () => {
      noteEl.textContent = "running…";
      void act({ cmd });
    });
  }

  const poll = () => send({ cmd: "getState" }).then((r) => render(r));
  void poll();
  setInterval(poll, 500);
})();
