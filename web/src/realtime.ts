/**
 * Live updates (BRD BR-15): subscribe to the private Kanban channel so moves, status
 * changes and reassignments made by other users appear in place. Same mechanism as the
 * SOW Planner (pusher-js; Pusher Channels now, Pronto's Reverb later).
 */
import Pusher, { type Channel } from "pusher-js";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";

/** One id per tab so a client can ignore the echo of its own writes. */
export const CLIENT_ID = `c_${Math.random().toString(36).slice(2, 10)}`;
export const KANBAN_CHANNEL = "private-kanban";

let _pusher: Pusher | null | undefined;

async function connection(): Promise<Pusher | null> {
  if (_pusher !== undefined) return _pusher;
  const r = await api.realtimeConfig().catch(() => null);
  if (!r?.enabled || !r.config) { _pusher = null; return null; }
  const { key, cluster, ...rest } = r.config;
  _pusher = new Pusher(key, { cluster, ...rest, channelAuthorization: { endpoint: "/api/realtime/auth", transport: "ajax" } });
  return _pusher;
}

export type KanbanEvent = { event: string; data: Record<string, unknown> & { origin?: string | null } };
export type LiveState = "off" | "connecting" | "live" | "error";

/** Subscribe to the Kanban channel. Events from this tab are filtered out. */
export function useKanbanChannel(onEvent: (e: KanbanEvent) => void): LiveState {
  const [state, setState] = useState<LiveState>("off");
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    let channel: Channel | null = null;
    let cancelled = false;
    setState("connecting");
    connection().then((p) => {
      if (cancelled) return;
      if (!p) { setState("off"); return; }
      channel = p.subscribe(KANBAN_CHANNEL);
      channel.bind("pusher:subscription_succeeded", () => setState("live"));
      channel.bind("pusher:subscription_error", () => setState("error"));
      channel.bind_global((event: string, data: KanbanEvent["data"]) => {
        if (event.startsWith("pusher:")) return;
        if (data?.origin === CLIENT_ID) return;
        handler.current({ event, data });
      });
    });
    return () => { cancelled = true; if (channel) { channel.unbind_all(); _pusher?.unsubscribe(channel.name); } };
  }, []);

  return state;
}
