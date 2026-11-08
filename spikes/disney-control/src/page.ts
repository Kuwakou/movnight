// MAIN world: the Disney+ player API (disney-web-player.mediaPlayer) lives in the
// page's JS realm, invisible from the isolated content script.
(() => {
  const TAG = "movnight-spike";
  const LOG = "[movnight spike]";
  const TARGETS = ["disney-web-player", "disney-web-player-ui"];
  const MAX_NESTED_KEYS = 40;

  function deepQueryAll(selector: string, root: Document | ShadowRoot = document, out: Element[] = []): Element[] {
    for (const el of Array.from(root.querySelectorAll("*"))) {
      if (el.matches(selector)) out.push(el);
      if (el.shadowRoot) deepQueryAll(selector, el.shadowRoot, out);
    }
    return out;
  }

  type MediaPlayer = Record<string, unknown> & {
    play?: (cause?: unknown) => Promise<unknown>;
    pause?: (cause?: unknown) => Promise<unknown>;
    seek?: (ms: number) => void;
    timeline?: { info?: { programDurationMs?: unknown } };
  };
  type PlayerHost = Element & { mediaPlayer?: MediaPlayer; getPlayheadPositionMs?: () => unknown };
  type UiHost = Element & { latestUiState?: { playback?: { isPaused?: unknown } } & Record<string, unknown> };

  const playerHost = () => deepQueryAll("disney-web-player")[0] as PlayerHost | undefined;
  const uiHost = () => deepQueryAll("disney-web-player-ui")[0] as UiHost | undefined;
  const finite = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  // --- Player API ---------------------------------------------------------

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

  // --- Probes (read-only) -------------------------------------------------

  function kind(desc: PropertyDescriptor): string {
    if (desc.get || desc.set) return desc.get && desc.set ? "get/set" : desc.get ? "get" : "set";
    const v = desc.value;
    return typeof v === "function" ? `fn(${(v as Function).length})` : typeof v;
  }

  function listElement(el: Element): string[] {
    const lines = [`${el.tagName.toLowerCase()} (shadowRoot visible here: ${!!el.shadowRoot})`];

    // Instance fields: data properties are safe to read; show one level of keys for objects.
    for (const name of Object.getOwnPropertyNames(el)) {
      const desc = Object.getOwnPropertyDescriptor(el, name)!;
      let extra = "";
      if ("value" in desc && desc.value && typeof desc.value === "object") {
        const keys = Object.keys(desc.value);
        extra = ` keys(${keys.length}): ${keys.slice(0, MAX_NESTED_KEYS).join(", ")}`;
      }
      lines.push(`  own  ${name}: ${kind(desc)}${extra}`);
    }

    // Prototype chain up to (not including) HTMLElement.prototype.
    for (let proto = Object.getPrototypeOf(el); proto && proto !== HTMLElement.prototype; proto = Object.getPrototypeOf(proto)) {
      const ctor = (proto.constructor as { name?: string } | undefined)?.name || "?";
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === "constructor") continue;
        lines.push(`  ${ctor}.${name}: ${kind(Object.getOwnPropertyDescriptor(proto, name)!)}`);
      }
    }
    return lines;
  }

  function probeApi(): string {
    const elements = TARGETS.flatMap((t) => deepQueryAll(t));
    const globals = Object.keys(window).filter((k) => /player|disney|dss|bam|playback|media/i.test(k));
    const lines = [
      `${LOG} player API probe (MAIN world)`,
      `window globals matching player|disney|dss|bam|playback|media: ${globals.join(", ") || "(none)"}`,
      ...elements.flatMap(listElement),
    ];
    console.log(lines.join("\n"));
    return `API listing for ${elements.length} element(s) logged to console`;
  }

  const SOURCE_OF = ["seek", "scrub", "quickFastForward", "quickRewind", "play", "pause", "seekToStart"];
  const MAX_SOURCE = 400;
  const MAX_JSON = 500;

  function json(v: unknown): string {
    try {
      const s = JSON.stringify(v);
      return s === undefined ? String(v) : s.length > MAX_JSON ? `${s.slice(0, MAX_JSON)}…` : s;
    } catch {
      return "(not serialisable)";
    }
  }

  function tryCall(label: string, fn: () => unknown): string {
    try {
      return `  ${label} = ${json(fn())}`;
    } catch (e) {
      return `  ${label} threw ${String(e)}`;
    }
  }

  // Values of data properties, source of key methods, and the read-only playhead getters.
  function probeMediaPlayer(): string {
    const host = playerHost();
    const mp = host?.mediaPlayer;
    if (!host || !mp) return "No disney-web-player.mediaPlayer found";

    const lines = [`${LOG} mediaPlayer probe`];
    for (const name of Object.keys(mp)) {
      const desc = Object.getOwnPropertyDescriptor(mp, name)!;
      if (!("value" in desc)) lines.push(`  ${name}: ${kind(desc)}`);
      else if (typeof desc.value === "function") {
        const fn = desc.value as Function;
        const src = SOURCE_OF.includes(name) ? `  src: ${fn.toString().slice(0, MAX_SOURCE).replace(/\s+/g, " ")}` : "";
        lines.push(`  ${name}: fn(${fn.length})${src}`);
      } else lines.push(`  ${name}: ${typeof desc.value} = ${json(desc.value)}`);
    }

    const el = host as unknown as Record<string, () => unknown>;
    lines.push("element playhead getters:");
    lines.push(tryCall("getPlayheadPositionMs()", () => el.getPlayheadPositionMs()));
    lines.push(tryCall("getContentPlayheadPosition()", () => el.getContentPlayheadPosition()));
    lines.push(tryCall("getCurrentProgramDateTimeMs()", () => el.getCurrentProgramDateTimeMs()));

    const ui = uiHost()?.latestUiState;
    lines.push("ui latestUiState:");
    lines.push(`  timeline = ${json(ui?.timeline)}`);
    lines.push(`  playback = ${json(ui?.playback)}`);

    const video = deepQueryAll("video").find((v) => (v as HTMLVideoElement).readyState > 0) as HTMLVideoElement | undefined;
    lines.push(`<video>.currentTime = ${video?.currentTime.toFixed(1)}s (for comparison)`);
    console.log(lines.join("\n"));
    return "mediaPlayer probe logged to console";
  }

  // --- Messaging ----------------------------------------------------------

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
      case "probeApi":
        return { ok: true, api: apiState(), note: probeApi() };
      case "probeMediaPlayer":
        return { ok: true, api: apiState(), note: probeMediaPlayer() };
    }
  }

  const PAGE_CMDS = new Set<string>(["apiState", "apiPlay", "apiPause", "apiSeek", "probeApi", "probeMediaPlayer"]);

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
