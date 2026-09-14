import { asyncRouter } from "../async-router.js";
import { realtimeEnabled, realtimeClientConfig, authorizeChannel } from "../realtime.js";

const router = asyncRouter();

/** Connection details for pusher-js (no secret). */
router.get("/config", (_req, res) => {
  res.json({ ok: true, enabled: realtimeEnabled, config: realtimeClientConfig() });
});

/** pusher-js posts here to subscribe to the private Kanban channel. Signed for any
 *  signed-in user; the channel carries task ids, ranks and statuses, not task content,
 *  and what a user can actually see is still governed by the tasks API. */
router.post("/auth", (req, res) => {
  const p = req.pronto || { mode: "none" };
  if (p.mode === "none" || !p.identity?.id) return res.status(403).json({ error: "Not signed in" });
  const { socket_id: socketId, channel_name: channel } = req.body || {};
  if (!socketId || !channel) return res.status(400).json({ error: "socket_id and channel_name are required" });
  const signed = authorizeChannel(socketId, channel, { id: p.identity.id, name: p.identity.name || p.identity.email });
  if (!signed) return res.status(403).json({ error: "Channel not allowed" });
  res.json(signed);
});

export default router;
