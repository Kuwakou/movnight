// Runs in the page's MAIN world so it can reach window.netflix.
(() => {
  const TAG = "movnight-spike";

  // Undocumented Netflix (Cadmium) player API. Times are in milliseconds.
  type NetflixPlayer = {
    getCurrentTime?: () => number;
    getDuration?: () => number;
    isPaused?: () => boolean;
    play?: () => void;
    pause?: () => void;
    seek?: (ms: number) => void;
  };

  const onWatchPage = () => location.pathname.startsWith("/watch");

  function getApiPlayer(): NetflixPlayer | null {
    try {
      const vp = (window as any).netflix?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
      const ids: unknown = vp?.getAllPlayerSessionIds?.();
      if (!Array.isArray(ids) || ids.length === 0) return null;
      // Browse-page previews create their own sessions; prefer the "watch" one.
      const id = ids.find((i) => typeof i === "string" && i.startsWith("watch")) ?? ids[ids.length - 1];
      return vp.getVideoPlayerBySessionId(id) ?? null;
    } catch {
      return null;
    }
  }

  const getVideo = () => document.querySelector("video");

  function readState(): PlayerState {
    const watch = onWatchPage();
    const player = watch ? getApiPlayer() : null;
    const video = watch ? getVideo() : null;

    if (player && typeof player.getCurrentTime === "function") {
      return {
        onWatchPage: watch,
        source: "api",
        positionMs: player.getCurrentTime(),
        durationMs: player.getDuration?.() ?? (video ? video.duration * 1000 : null),
        paused: player.isPaused?.() ?? video?.paused ?? null,
      };
    }
    if (video) {
      return {
        onWatchPage: watch,
        source: "video",
        positionMs: video.currentTime * 1000,
        durationMs: Number.isFinite(video.duration) ? video.duration * 1000 : null,
        paused: video.paused,
      };
    }
    return { onWatchPage: watch, source: "none", positionMs: null, durationMs: null, paused: null };
  }

  function run(command: Command): Reply {
    if (command.cmd === "getState") return { ok: true, state: readState() };
    if (!onWatchPage()) return { ok: false, error: "Not on a /watch page" };

    const player = getApiPlayer();
    const video = getVideo();

    switch (command.cmd) {
      case "play":
        if (player?.play) player.play();
        else if (video) void video.play();
        else return { ok: false, error: "No player found" };
        break;
      case "pause":
        if (player?.pause) player.pause();
        else if (video) video.pause();
        else return { ok: false, error: "No player found" };
        break;
      case "seek": {
        if (!player?.seek) return { ok: false, error: "Netflix player API unavailable; refusing to seek via <video>" };
        const duration = player.getDuration?.();
        const ms = duration ? Math.min(command.ms, duration - 1000) : command.ms;
        player.seek(Math.max(0, Math.round(ms)));
        break;
      }
      case "rawSeek":
        if (!video) return { ok: false, error: "No <video> element" };
        video.currentTime = command.ms / 1000;
        break;
    }
    return { ok: true, state: readState() };
  }

  function isValidCommand(c: unknown): c is Command {
    if (typeof c !== "object" || c === null) return false;
    const cmd = (c as { cmd?: unknown }).cmd;
    if (cmd === "getState" || cmd === "play" || cmd === "pause") return true;
    if (cmd === "seek" || cmd === "rawSeek") {
      const ms = (c as { ms?: unknown }).ms;
      return typeof ms === "number" && Number.isFinite(ms) && ms >= 0;
    }
    return false;
  }

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as Partial<PageRequest> | null;
    if (!data || data.tag !== TAG || data.dir !== "req" || typeof data.id !== "string") return;

    let reply: Reply;
    if (!isValidCommand(data.command)) reply = { ok: false, error: "Invalid command" };
    else {
      try {
        reply = run(data.command);
      } catch (e) {
        reply = { ok: false, error: String(e) };
      }
    }
    const res: PageResponse = { tag: TAG, dir: "res", id: data.id, reply };
    window.postMessage(res, location.origin);
  });
})();
