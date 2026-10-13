# Adding chat + voice to a different version of Haul

Two NEW files (copy as-is):  `client/chat.ts`  and  `src/chat.ts`
Four small edits to existing files:

## src/shared.ts — add to the `ClientMsg` union
    | { t: 'chat'; text: string }
    | { t: 'rtc'; to: string; data: unknown }

## src/server.ts
    import { ChatState, handleChatMsg } from './chat';
    // inside wss.on('connection', ...), next to `let player`:
    const chatState: ChatState = { times: [] };
    // right after `if (!room || !player) return;`:
    if (handleChatMsg(m, player, room.players, chatState)) return;

## client/client.ts
    import { handleServerMsg, initChat, updateVoice } from './chat';
    // in ws.onmessage:
    else if (m.t === 'chat' || m.t === 'rtc') handleServerMsg(m);
    // once, after `send` and `requestLock` exist:
    initChat({ send: m => send(m as ClientMsg), getMyId: () => myId, lock: () => requestLock() });
    // every frame, once you know your world position + look direction `dir`:
    updateVoice({
      listener: { x: meWorld.x, y: EYE_HEIGHT, z: meWorld.z },
      forward: { x: dir.x, y: dir.y, z: dir.z },
      peers: s.players.flatMap(pl => {
        const pv = pl.id === myId ? undefined : playerVisuals.get(pl.id);
        return pv ? [{ id: pl.id, name: pl.name, x: pv.mesh.position.x, y: 55, z: pv.mesh.position.z }] : [];
      }),
    });

Controls: Enter = type/send, Esc = cancel, hold Q = talk, or use the 💬 / 🎤 buttons (top-left).
