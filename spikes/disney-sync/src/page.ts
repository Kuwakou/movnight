// MAIN world: the Disney+ player API (disney-web-player.mediaPlayer) lives in the
// page's JS realm, invisible from the isolated content script. See spikes/disney-control.
(() => {
  const TAG = "movnight-spike";
  const LOG = "[movnight sync]";

  function deepQueryAll(selector: string, root: Document | ShadowRoot = document, out: Element[] = []): Element[] {
    for (const el of Array.from(root.querySelectorAll("*"))) {
      if (el.matches(selector)) out.push(el);
      if (el.shadowRoot) deepQueryAll(selector, el.shadowRoot, out);
    }
    return out;
  }

  type MediaPlayer = Record<string, unknown> & {
    timeline?: { info?: { programDurationMs?: unknown } };
  };
  type PlayerHost = Element & { mediaPlayer?: MediaPlayer; getPlayheadPositionMs?: () => unknown };
  type UiHost = Element & { latestUiState?: { playback?: { isPaused?: unknown } } };

  const playerHost = () => deepQueryAll("disney-web-player")[0] as PlayerHost | undefined;
  const uiHost = () => deepQueryAll("disney-web-player-ui")[0] as UiHost | undefined;
  const finite = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  function apiState(): ApiState | null {
    const host = playerHost();
    if (!host?.mediaPlayer || typeof host.getPlayheadPositionMs !== "function") return null;
    const positionMs = finite(host.getPlayheadPositionMs());
    if (positionMs === null) return null;
    const isPaused = uiHost()?.latestUiState?.playback?.isPaused;
    return {
      positionMs,
      durationMs: finite(host.mediaPlayer.timeline?.info?.programDurationMs),
      paused: typeof isPaused === "boolean" ? isPaused : null,
    };
  }

  function call(name: "play" | "pause" | "seek", ...args: number[]): PageResult {
    const mp = playerHost()?.mediaPlayer;
    const fn = mp?.[name];
    if (!mp || typeof fn !== "function") return { ok: false, error: `mediaPlayer.${name} not found` };
    const result = (fn as Function).apply(mp, args);
    // play/pause return promises; surface rejections in the console.
    if (result instanceof Promise) result.catch((e) => console.log(`${LOG} mediaPlayer.${name} rejected:`, e));
    return { ok: true, api: apiState() };
  }

  function seek(ms: number): PageResult {
    const durationMs = apiState()?.durationMs;
    const target = Math.round(Math.max(0, durationMs ? Math.min(ms, durationMs - 1000) : ms));
    return call("seek", target);
  }

  function handle(cmd: PageCmd, ms: unknown): PageResult {
    switch (cmd) {
      case "apiState":
        return { ok: true, api: apiState() };
      case "apiPlay":
        return call("play");
      case "apiPause":
        return call("pause");
      case "apiSeek":
        if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return { ok: false, error: "Invalid seek target" };
        return seek(ms);
    }
  }

  const PAGE_CMDS = new Set<string>(["apiState", "apiPlay", "apiPause", "apiSeek"]);

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as Partial<PageRequest> | null;
    if (!data || data.tag !== TAG || data.dir !== "req" || typeof data.id !== "string") return;
    if (typeof data.cmd !== "string" || !PAGE_CMDS.has(data.cmd)) return;
    let result: PageResult;
    try {
      result = handle(data.cmd, data.ms);
    } catch (e) {
      result = { ok: false, error: `${data.cmd} failed: ${String(e)}` };
    }
    const res: PageResponse = { tag: TAG, dir: "res", id: data.id, result };
    window.postMessage(res, location.origin);
  });
})();
