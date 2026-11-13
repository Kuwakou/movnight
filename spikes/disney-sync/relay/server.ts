// Local relay: forwards sync messages to the other members of a room.
// Throwaway (M1). Stands in for LiveKit data messages until M4.
import { WebSocketServer, type WebSocket } from "ws";

const HOST = "127.0.0.1";
const PORT = 8787;

const rooms = new Map<string, Set<WebSocket>>();
const ROOM_RE = /^[\w-]{1,64}$/;

const send = (ws: WebSocket, msg: unknown) => ws.send(JSON.stringify(msg));

function broadcastPresence(room: string) {
  const members = rooms.get(room);
  if (!members) return;
  for (const ws of members) send(ws, { t: "presence", room, count: members.size });
}

function leave(ws: WebSocket, room: string | null) {
  if (!room) return;
  const members = rooms.get(room);
  members?.delete(ws);
  if (members?.size === 0) rooms.delete(room);
  else broadcastPresence(room);
}

// The relay only checks the envelope; the extension validates sync messages fully.
function parse(raw: string): { t: "join"; room: string } | { t: "sync"; msg: { room: string } } | { t: "ping" } | null {
  try {
    const m = JSON.parse(raw);
    if (m?.t === "join" && typeof m.room === "string" && ROOM_RE.test(m.room)) return m;
    if (m?.t === "sync" && typeof m.msg === "object" && m.msg !== null && typeof m.msg.room === "string") return m;
    if (m?.t === "ping") return m;
  } catch {}
  return null;
}

const wss = new WebSocketServer({
  host: HOST,
  port: PORT,
  maxPayload: 4096,
  // Any website can open ws://127.0.0.1 from the browser; only accept extensions.
  verifyClient: ({ origin }: { origin: string }) => origin.startsWith("chrome-extension://"),
});

wss.on("connection", (ws, req) => {
  let room: string | null = null;
  console.log(`connect ${req.headers.origin}`);

  ws.on("message", (data) => {
    const m = parse(data.toString());
    if (!m) return console.log("dropped malformed message");
    switch (m.t) {
      case "ping":
        return send(ws, { t: "pong" });
      case "join":
        leave(ws, room);
        room = m.room;
        if (!rooms.has(room)) rooms.set(room, new Set());
        rooms.get(room)!.add(ws);
        console.log(`join ${room} (${rooms.get(room)!.size} in room)`);
        return broadcastPresence(room);
      case "sync":
        if (!room || m.msg.room !== room) return console.log("dropped sync for a room not joined");
        for (const peer of rooms.get(room) ?? []) if (peer !== ws) send(peer, m);
        console.log(`sync ${room}: ${JSON.stringify(m.msg)}`);
        return;
    }
  });

  ws.on("close", () => {
    leave(ws, room);
    console.log(`disconnect${room ? ` from ${room}` : ""}`);
  });
});

wss.on("listening", () => console.log(`relay listening on ws://${HOST}:${PORT}`));
