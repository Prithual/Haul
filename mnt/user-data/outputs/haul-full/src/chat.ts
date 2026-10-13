// Server side of in-game text chat + proximity voice chat.
// Text: validated, rate-limited, then broadcast to everyone in the sender's room.
// Voice: the audio itself is peer-to-peer (WebRTC); the server only relays the
// small signaling messages (offers/answers/ICE candidates) between two players
// in the same room, so no audio ever passes through (or is stored on) the server.
import { WebSocket } from 'ws';
import type { ClientMsg } from './shared';

interface Peer { id: string; name: string; ws: WebSocket }
export interface ChatState { times: number[] }

const MAX_TEXT = 140;
const MAX_RTC_BYTES = 10_000;
const RATE_WINDOW_MS = 4000, RATE_MAX = 5;

/** Returns true if the message was a chat/rtc message (handled here). */
export function handleChatMsg(m: ClientMsg, from: Peer, room: ReadonlyMap<string, Peer>, state: ChatState): boolean {
  if (m.t === 'chat') {
    // eslint-disable-next-line no-control-regex
    const text = String(m.text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_TEXT);
    if (!text) return true;
    const now = Date.now();
    state.times = state.times.filter(t => now - t < RATE_WINDOW_MS);
    if (state.times.length >= RATE_MAX) return true; // flooding: drop silently
    state.times.push(now);
    const out = JSON.stringify({ t: 'chat', id: from.id, name: from.name, text });
    for (const p of room.values()) if (p.ws.readyState === WebSocket.OPEN) p.ws.send(out);
    return true;
  }
  if (m.t === 'rtc') {
    const target = room.get(String(m.to));
    if (!target || target.id === from.id || target.ws.readyState !== WebSocket.OPEN) return true;
    const data = JSON.stringify(m.data ?? null);
    if (data.length > MAX_RTC_BYTES) return true;
    target.ws.send(`{"t":"rtc","from":${JSON.stringify(from.id)},"data":${data}}`);
    return true;
  }
  return false;
}
