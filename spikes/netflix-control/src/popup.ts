(() => {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const posEl = $("pos");
  const metaEl = $("meta");
  const errorEl = $("error");
  const targetEl = $<HTMLInputElement>("target");

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
      return { ok: false, error: "Open a netflix.com/watch page (reload it if the extension was just loaded)" };
    }
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
    metaEl.textContent = !s.onWatchPage
      ? "not on a /watch page"
      : `source: ${s.source} · ${s.paused === null ? "?" : s.paused ? "paused" : "playing"}`;
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
  $("raw").addEventListener("click", () => {
    if (last?.positionMs != null) void act({ cmd: "rawSeek", ms: last.positionMs + 10_000 });
  });

  const poll = () => send({ cmd: "getState" }).then((r) => render(r));
  void poll();
  setInterval(poll, 500);
})();
