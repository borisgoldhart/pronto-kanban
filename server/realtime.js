/**
 * Live updates: publish Kanban changes to a Pusher-protocol relay (same module as the
 * SOW Planner). Browsers subscribe with pusher-js to `private-kanban`; every move,
 * status change and reassignment is fanned out so other open boards update in place.
 *
 *   - Pusher Channels (prototype)           PUSHER_APP_ID / KEY / SECRET / CLUSTER
 *   - Pronto's Reverb server (end state)    same vars plus PUSHER_HOST / PUSHER_PORT / PUSHER_SCHEME
 * With nothing configured, publish() is a no-op and the UI works single-user.
 *
 * Scope note (BRD BR-14/15): this carries changes made THROUGH the Kanban. Changes made
 * inside Pronto (automation, bulk updates) reach the board when Pronto emits them on the
 * same relay; until then the client refreshes periodically as a stand-in.
 */
import Pusher from "pusher";

const enabled = Boolean(process.env.PUSHER_APP_ID && process.env.PUSHER_KEY && process.env.PUSHER_SECRET);

let _client = null;
function client() {
  if (!enabled) return null;
  if (_client) return _client;
  const host = process.env.PUSHER_HOST;
  _client = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER || "ap4",
    ...(host ? {
      host,
      port: Number(process.env.PUSHER_PORT) || (process.env.PUSHER_SCHEME === "https" ? 443 : 80),
      useTLS: process.env.PUSHER_SCHEME === "https",
    } : { useTLS: true }),
  });
  return _client;
}

export const realtimeEnabled = enabled;
export const KANBAN_CHANNEL = "private-kanban";

/** What the browser needs to connect (never the secret). */
export function realtimeClientConfig() {
  if (!enabled) return null;
  const host = process.env.PUSHER_HOST;
  return {
    key: process.env.PUSHER_KEY,
    cluster: process.env.PUSHER_CLUSTER || "ap4",
    ...(host ? { wsHost: host, wsPort: Number(process.env.PUSHER_PORT) || 80, wssPort: Number(process.env.PUSHER_PORT) || 443, forceTLS: process.env.PUSHER_SCHEME === "https" } : {}),
  };
}

/** Fan a change out to every open board. `origin` lets the sender ignore its own echo.
 *  Errors are logged, never thrown: a failed broadcast must not fail the committed write. */
export async function publish(event, payload, { origin } = {}) {
  const c = client();
  if (!c) return false;
  try {
    await c.trigger(KANBAN_CHANNEL, event, { ...payload, origin: origin || null });
    return true;
  } catch (e) {
    console.warn(`[realtime] publish ${event} failed: ${e.message}`);
    return false;
  }
}

/** Sign a private-channel subscription for a user we have already authenticated. */
export function authorizeChannel(socketId, channel, user) {
  const c = client();
  if (!c) return null;
  if (channel !== KANBAN_CHANNEL) return null;
  return c.authorizeChannel(socketId, channel, user ? { user_id: String(user.id), user_info: { name: user.name } } : undefined);
}
