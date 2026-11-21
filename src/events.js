// Événements serveur → navigateur (Server-Sent Events) : le front est prévenu
// dès qu'une notification arrive ou qu'un envoi change d'état, sans polling.
import { EventEmitter } from "node:events";

export const bus = new EventEmitter();
bus.setMaxListeners(50);

export const emit = (type, data = {}) => bus.emit("event", { type, data });

export function sseHandler(req, res) {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  res.write("retry: 5000\n\n");

  const send = ({ type, data }) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  const ping = setInterval(() => res.write(": ping\n\n"), 30000);
  bus.on("event", send);
  req.on("close", () => {
    clearInterval(ping);
    bus.off("event", send);
  });
}
