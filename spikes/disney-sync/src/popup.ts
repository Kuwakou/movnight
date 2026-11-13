(() => {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const statusEl = $("status");
  const subEl = $("sub");
  const errorEl = $("error");
  const roomEl = $<HTMLInputElement>("room");
  const logEl = $("log");

  const fmtPos = (ms: number) => new Date(ms).toISOString().slice(11, 19);
  const fmtClock = (at: number) => new Date(at).toLocaleTimeString();

  function render(s: Status) {
    statusEl.textContent =
      s.connection === "connected" ? `connected · ${s.inRoom} in room "${s.room}"` : `${s.connection} (is the relay running?)`;
    subEl.textContent =
      s.tabs > 0 ? `${s.tabs} Disney+ tab(s) attached` : "0 Disney+ tabs attached — reload the Disney+ tab (⌘R)";
    if (document.activeElement !== roomEl) roomEl.value = s.room;

    logEl.replaceChildren(
      ...s.log.map((e) => {
        const li = document.createElement("li");
        li.className = e.dir;
        li.textContent = `${fmtClock(e.at)} ${e.dir === "in" ? "← in " : "→ out"} ${e.type.padEnd(5)} ${e.playing ? "▶" : "⏸"} ${fmtPos(e.positionMs)}`;
        return li;
      }),
    );
  }

  async function send(cmd: PopupCmd) {
    const res = (await chrome.runtime.sendMessage(cmd)) as Status | { error: string };
    if ("error" in res) errorEl.textContent = res.error;
    else {
      errorEl.textContent = "";
      render(res);
    }
  }

  $("join").addEventListener("click", () => void send({ t: "setRoom", room: roomEl.value.trim() }));
  roomEl.addEventListener("keydown", (e) => e.key === "Enter" && void send({ t: "setRoom", room: roomEl.value.trim() }));

  const poll = () => void send({ t: "status" });
  poll();
  setInterval(poll, 1000);
})();
