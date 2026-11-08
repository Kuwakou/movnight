// Isolated-world content script: relays popup messages to page.ts and back.
(() => {
  const TAG = "movnight-spike";
  const TIMEOUT_MS = 2000;

  function isValidReply(r: unknown): r is Reply {
    if (typeof r !== "object" || r === null) return false;
    const reply = r as { ok?: unknown; state?: unknown; error?: unknown };
    if (reply.ok === false) return typeof reply.error === "string";
    if (reply.ok !== true || typeof reply.state !== "object" || reply.state === null) return false;
    const s = reply.state as Record<string, unknown>;
    const numOrNull = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));
    return (
      typeof s.onWatchPage === "boolean" &&
      (s.source === "api" || s.source === "video" || s.source === "none") &&
      numOrNull(s.positionMs) &&
      numOrNull(s.durationMs) &&
      (s.paused === null || typeof s.paused === "boolean")
    );
  }

  function ask(command: Command): Promise<Reply> {
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        resolve({ ok: false, error: "Page script did not respond" });
      }, TIMEOUT_MS);

      function onMessage(event: MessageEvent) {
        if (event.source !== window) return;
        const data = event.data as Partial<PageResponse> | null;
        if (!data || data.tag !== TAG || data.dir !== "res" || data.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve(isValidReply(data.reply) ? data.reply : { ok: false, error: "Malformed reply from page" });
      }

      window.addEventListener("message", onMessage);
      const req: PageRequest = { tag: TAG, dir: "req", id, command };
      window.postMessage(req, location.origin);
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only our own popup (an extension page, so no sender.tab).
    if (sender.id !== chrome.runtime.id || sender.tab) return;
    ask(message as Command).then(sendResponse);
    return true; // async response
  });
})();
