// Isolated-world content script. Playback goes through the Disney+ player API via
// page.ts (MAIN world). <video> is only a read/play/pause fallback: its currentTime
// is a local MSE timeline, not movie time, so it's never used to seek.
(() => {
  const TAG = "movnight-spike";
  const SEEK_CHECK_DELAY_MS = 1500;
  const PAGE_TIMEOUT_MS = 2000;
  const LOG = "[movnight spike]";

  let lastSeek: SeekCheck | null = null;

  const onWatchPage = () => /^\/(?:[a-z]{2}-[a-z]{2}\/)?(?:play|video)\//.test(location.pathname);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  function describe(el: Element): string {
    return el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "");
  }

  // Visit every element, descending into open shadow roots.
  function walk(root: Document | ShadowRoot, path: string, visit: (el: Element, path: string) => void) {
    for (const el of Array.from(root.querySelectorAll("*"))) {
      visit(el, path);
      if (el.shadowRoot) walk(el.shadowRoot, `${path} > ${describe(el)}#shadow`, visit);
    }
  }

  type Found = { video: HTMLVideoElement; path: string };

  function findVideos(): Found[] {
    const out: Found[] = [];
    walk(document, "document", (el, path) => {
      if (el instanceof HTMLVideoElement) out.push({ video: el, path: `${path} > video` });
    });
    return out;
  }

  // Pick the main feature: spares/previews are smaller or not loaded.
  function getVideo(): Found | null {
    const all = findVideos();
    if (all.length === 0) return null;
    const score = ({ video }: Found) => video.readyState * 1e8 + video.clientWidth * video.clientHeight;
    return all.reduce((best, f) => (score(f) > score(best) ? f : best));
  }

  function fmtRanges(r: TimeRanges): string {
    const parts = Array.from({ length: r.length }, (_, i) => `${r.start(i).toFixed(1)}–${r.end(i).toFixed(1)}s`);
    return parts.length ? parts.join(", ") : "(empty)";
  }

  // --- page.ts relay ------------------------------------------------------

  function isValidApiState(a: unknown): a is ApiState | null {
    if (a === null) return true;
    if (typeof a !== "object") return false;
    const s = a as Record<string, unknown>;
    const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
    return finite(s.positionMs) && (s.durationMs === null || finite(s.durationMs)) && (s.paused === null || typeof s.paused === "boolean");
  }

  function isValidPageResult(r: unknown): r is PageResult {
    if (typeof r !== "object" || r === null) return false;
    const res = r as { ok?: unknown; api?: unknown; note?: unknown; error?: unknown };
    if (res.ok === false) return typeof res.error === "string";
    return res.ok === true && isValidApiState(res.api) && (res.note === undefined || typeof res.note === "string");
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

  // --- State --------------------------------------------------------------

  function buildState(api: ApiState | null): PlayerState {
    const watch = onWatchPage();
    const found = watch ? getVideo() : null;
    const v = found?.video;
    const base = { onWatchPage: watch, videoPath: found?.path ?? null, lastSeek };
    if (watch && api) return { ...base, source: "api", ...api };
    if (v) {
      return {
        ...base,
        source: "video",
        positionMs: v.currentTime * 1000,
        durationMs: Number.isFinite(v.duration) ? v.duration * 1000 : null,
        paused: v.paused,
      };
    }
    return { ...base, source: "none", positionMs: null, durationMs: null, paused: null };
  }

  async function readState(): Promise<PlayerState> {
    const res = onWatchPage() ? await askPage("apiState") : null;
    return buildState(res?.ok ? res.api : null);
  }

  // Page command -> Reply, keeping its note and the API state it returned.
  async function viaPage(cmd: PageCmd, ms?: number): Promise<Reply> {
    const res = await askPage(cmd, ms);
    if (!res.ok) return res;
    return { ok: true, state: buildState(res.api), note: res.note };
  }

  // --- Probes (isolated world) -------------------------------------------

  async function dump(): Promise<Reply> {
    const customs = new Map<string, { count: number; openShadow: boolean }>();
    walk(document, "document", (el) => {
      const tag = el.tagName.toLowerCase();
      if (!tag.includes("-")) return;
      const entry = customs.get(tag) ?? { count: 0, openShadow: false };
      entry.count++;
      entry.openShadow ||= !!el.shadowRoot;
      customs.set(tag, entry);
    });

    const videos = findVideos();
    // Plain text so it can be copied or screenshotted without expanding objects.
    const picked = getVideo()?.video;
    const lines = [
      `${LOG} Disney+ player dump`,
      `onWatchPage: ${onWatchPage()}`,
      `custom elements (tag ×count, shadow=open|none/closed):`,
      ...[...customs].map(([tag, e]) => `  ${tag} ×${e.count} shadow=${e.openShadow ? "open" : "none/closed"}`),
      `videos found: ${videos.length}`,
      ...videos.map(
        ({ video, path }, i) =>
          `  [${i}] ${path}${video === picked ? "  <- picked" : ""}` +
          ` duration=${video.duration.toFixed(1)}s current=${video.currentTime.toFixed(1)}s` +
          ` paused=${video.paused} size=${video.clientWidth}x${video.clientHeight}` +
          ` readyState=${video.readyState} blob=${video.currentSrc.startsWith("blob:")}` +
          ` parent=${video.parentElement ? describe(video.parentElement) : "-"}`,
      ),
    ];
    console.log(lines.join("\n"));
    return { ok: true, state: await readState(), note: "Dump logged to console" };
  }

  async function probeRanges(v: HTMLVideoElement): Promise<Reply> {
    const line =
      `current=${v.currentTime.toFixed(1)}s duration=${v.duration} ` +
      `seekable=${fmtRanges(v.seekable)} buffered=${fmtRanges(v.buffered)}`;
    console.log(`${LOG} ranges: ${line}`);
    return { ok: true, state: await readState(), note: line };
  }

  async function probeControls(): Promise<Reply> {
    const interesting = /skip|forward|back|rewind|seek|scrub|progress|time|play|pause|10/i;
    const lines: string[] = [];
    walk(document, "document", (el, path) => {
      const role = el.getAttribute("role");
      const label = el.getAttribute("aria-label") ?? el.getAttribute("title") ?? "";
      const isSlider = role === "slider" || role === "progressbar" || (el instanceof HTMLInputElement && el.type === "range") || el instanceof HTMLProgressElement;
      const isButton = el instanceof HTMLButtonElement || role === "button";
      if (!isSlider && !(isButton && interesting.test(label))) return;
      const aria = ["aria-valuenow", "aria-valuemin", "aria-valuemax", "aria-valuetext"]
        .map((a) => (el.hasAttribute(a) ? `${a}=${el.getAttribute(a)}` : ""))
        .filter(Boolean)
        .join(" ");
      const value = el instanceof HTMLInputElement ? ` value=${el.value} min=${el.min} max=${el.max}` : "";
      lines.push(`  ${isSlider ? "SLIDER" : "BUTTON"} ${path} > ${describe(el)} role=${role ?? "-"} label="${label}" ${aria}${value}`);
    });
    console.log([`${LOG} controls (${lines.length}):`, ...lines].join("\n"));
    return { ok: true, state: await readState(), note: `${lines.length} controls logged to console` };
  }

  // Synthetic keys are isTrusted=false; this checks whether Disney+ still honours them.
  async function probeKeys(v: HTMLVideoElement): Promise<Reply> {
    const before = v.currentTime;
    const t0 = performance.now();
    const target = document.activeElement ?? document.body;
    for (const type of ["keydown", "keyup"]) {
      target.dispatchEvent(
        new KeyboardEvent(type, { key: "ArrowRight", code: "ArrowRight", keyCode: 39, which: 39, bubbles: true, composed: true, cancelable: true }),
      );
    }
    await sleep(SEEK_CHECK_DELAY_MS);
    const now = getVideo()?.video ?? v;
    const elapsed = v.paused ? 0 : (performance.now() - t0) / 1000;
    const jump = now.currentTime - before - elapsed;
    const line = `ArrowRight on <${describe(target)}>: moved ${jump.toFixed(1)}s beyond normal playback`;
    console.log(`${LOG} keys: ${line}`);
    return { ok: true, state: await readState(), note: line };
  }

  // --- Commands -----------------------------------------------------------

  async function seek(ms: number): Promise<Reply> {
    const res = await askPage("apiSeek", ms);
    if (!res.ok) return res;
    const check: SeekCheck = { targetMs: ms, landedMs: null };
    lastSeek = check;
    setTimeout(async () => {
      const after = await askPage("apiState");
      check.landedMs = after.ok && after.api ? after.api.positionMs : null;
      console.log(`${LOG} seek: target=${(ms / 1000).toFixed(1)}s landed=${check.landedMs === null ? "?" : (check.landedMs / 1000).toFixed(1)}s`);
    }, SEEK_CHECK_DELAY_MS);
    return { ok: true, state: buildState(res.api) };
  }

  async function playPause(play: boolean): Promise<Reply> {
    const res = await askPage(play ? "apiPlay" : "apiPause");
    if (res.ok) return { ok: true, state: buildState(res.api) };
    // Fallback: <video> play/pause is harmless (unlike seeking).
    const v = getVideo()?.video;
    if (!v) return res;
    if (play) await v.play().catch(() => {});
    else v.pause();
    return { ok: true, state: await readState(), note: `API unavailable (${res.error}); used <video>` };
  }

  async function run(command: Command): Promise<Reply> {
    switch (command.cmd) {
      case "getState":
        return { ok: true, state: await readState() };
      case "dump":
        return dump();
      case "probeApi":
      case "probeMediaPlayer":
        return viaPage(command.cmd);
    }
    if (!onWatchPage()) return { ok: false, error: "Not on a /play/ page" };

    switch (command.cmd) {
      case "play":
      case "pause":
        return playPause(command.cmd === "play");
      case "seek":
        return seek(command.ms);
      case "probeControls":
        return probeControls();
    }

    const v = getVideo()?.video;
    if (!v) return { ok: false, error: "No <video> found" };
    switch (command.cmd) {
      case "probeRanges":
        return probeRanges(v);
      case "probeKeys":
        return probeKeys(v);
    }
  }

  const SIMPLE_CMDS = new Set(["getState", "play", "pause", "dump", "probeRanges", "probeControls", "probeKeys", "probeApi", "probeMediaPlayer"]);

  function isValidCommand(c: unknown): c is Command {
    if (typeof c !== "object" || c === null) return false;
    const cmd = (c as { cmd?: unknown }).cmd;
    if (typeof cmd === "string" && SIMPLE_CMDS.has(cmd)) return true;
    if (cmd === "seek") {
      const ms = (c as { ms?: unknown }).ms;
      return typeof ms === "number" && Number.isFinite(ms) && ms >= 0;
    }
    return false;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only our own popup (an extension page, so no sender.tab).
    if (sender.id !== chrome.runtime.id || sender.tab) return;
    if (!isValidCommand(message)) {
      sendResponse({ ok: false, error: "Invalid command" } satisfies Reply);
      return;
    }
    run(message)
      .catch((e): Reply => ({ ok: false, error: String(e) }))
      .then(sendResponse);
    return true; // async response
  });
})();
