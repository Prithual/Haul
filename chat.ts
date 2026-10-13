// In-game text chat + proximity voice chat. Self-contained: builds its own UI,
// so index.html doesn't need to change. client.ts only has to
//   1. call initChat() once,
//   2. forward 'chat' / 'rtc' server messages to handleServerMsg(),
//   3. call updateVoice() every frame with the listener pose + other players.
//
// Text:  Enter to type, Enter to send, Esc to cancel. Messages are shown in a
//        log that fades out when idle.
// Voice: WebRTC mesh (fine for 3-6 players). Audio goes peer-to-peer; the server
//        only relays signaling. Each remote voice is positioned in 3D with a
//        PannerNode, so you hear players louder/quieter (and from the right
//        direction) based on where they actually are in the level.
//        Modes (button, top-left): Off -> Hold Q to talk -> Open mic -> Off.

interface Deps {
  send: (m: unknown) => void;
  getMyId: () => string;
  lock: () => void; // re-capture the mouse after typing
}
export interface VoicePeer { id: string; name: string; x: number; y: number; z: number }
export interface VoiceFrame {
  listener: { x: number; y: number; z: number };
  forward: { x: number; y: number; z: number };
  peers: VoicePeer[];
}

// Add a TURN server here if players behind strict NATs/mobile carriers can't hear
// each other (STUN alone can't traverse those):
//   { urls: 'turn:your.turn.host:3478', username: '...', credential: '...' }
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// Game units: eye height is 46 and the map is 2200 wide. Full volume within
// REF_DIST, fading linearly to silence at MAX_DIST.
const REF_DIST = 120, MAX_DIST = 1100;
const SPEAK_THRESHOLD = 0.02;

let deps: Deps;
let typing = false;
let inited = false;

// ---------- UI ----------
const CSS = `
#chatUI { position: fixed; inset: 0; pointer-events: none; z-index: 16; font-family: system-ui, sans-serif; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,.9); }
#chatTools { position: absolute; top: 52px; left: 20px; display: flex; gap: 8px; }
#chatTools button { pointer-events: auto; cursor: pointer; font-size: 13px; padding: 6px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,.25); background: rgba(15,12,9,.6); color: #eef; text-shadow: none; }
#chatTools button.live { border-color: #3cc878; background: rgba(60,200,120,.28); }
#chatTools button.err { border-color: #e65a5a; }
#voiceList { position: absolute; top: 90px; left: 20px; font-size: 14px; display: flex; flex-direction: column; gap: 2px; }
#chatLog { position: absolute; bottom: 84px; left: 20px; width: min(440px, 72vw); display: flex; flex-direction: column; gap: 2px; font-size: 14px; line-height: 1.3; }
#chatLog div { transition: opacity 1s; word-break: break-word; }
#chatLog .sys { color: #ffcc66; font-style: italic; }
#chatInputWrap { position: absolute; bottom: 44px; left: 20px; width: min(440px, 72vw); display: none; pointer-events: auto; }
#chatInputWrap input { width: 100%; box-sizing: border-box; padding: 8px 10px; font-size: 15px; border-radius: 8px; border: 1px solid rgba(255,255,255,.35); background: rgba(10,8,6,.85); color: #fff; outline: none; }
body.touch #chatLog { bottom: auto; top: 130px; }
body.touch #chatInputWrap { bottom: auto; top: 94px; }
`;

let logEl: HTMLDivElement, wrapEl: HTMLDivElement, inputEl: HTMLInputElement;
let chatBtn: HTMLButtonElement, micBtn: HTMLButtonElement, voiceListEl: HTMLDivElement;
const lines: { el: HTMLDivElement; t: number }[] = [];

function buildUI() {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'chatUI';
  root.innerHTML = `
    <div id="chatTools"><button id="chatBtn" type="button">💬 Chat (Enter)</button><button id="micBtn" type="button">🎤 Voice: Off</button></div>
    <div id="voiceList"></div>
    <div id="chatLog"></div>
    <div id="chatInputWrap"><input id="chatInput" maxlength="140" placeholder="Say something… (Enter to send, Esc to cancel)" autocomplete="off"></div>`;
  document.body.appendChild(root);
  logEl = root.querySelector('#chatLog') as HTMLDivElement;
  wrapEl = root.querySelector('#chatInputWrap') as HTMLDivElement;
  inputEl = root.querySelector('#chatInput') as HTMLInputElement;
  chatBtn = root.querySelector('#chatBtn') as HTMLButtonElement;
  micBtn = root.querySelector('#micBtn') as HTMLButtonElement;
  voiceListEl = root.querySelector('#voiceList') as HTMLDivElement;

  const hint = document.getElementById('hudHint');
  if (hint && !hint.dataset.chat) { hint.textContent += ' | Enter: chat | Hold Q: talk'; hint.dataset.chat = '1'; }
}

function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(h) % 360},70%,72%)`;
}

function addLine(name: string, text: string, mine = false, system = false) {
  const el = document.createElement('div');
  if (system) { el.className = 'sys'; el.textContent = text; }
  else {
    const who = document.createElement('b');
    who.style.color = colorFor(name);
    who.textContent = (mine ? 'you' : name) + ': ';
    el.appendChild(who);
    el.appendChild(document.createTextNode(text)); // textContent-style: never parsed as HTML
  }
  logEl.appendChild(el);
  lines.push({ el, t: Date.now() });
  while (lines.length > 40) lines.shift()!.el.remove();
  refreshLog();
}

function refreshLog() {
  const now = Date.now();
  for (const l of lines) l.el.style.opacity = typing || now - l.t < 10000 ? '1' : '0';
}

// ---------- Text input ----------
function openInput() {
  if (!deps.getMyId() || typing) return;
  typing = true;
  wrapEl.style.display = 'block';
  inputEl.value = '';
  document.exitPointerLock?.();
  inputEl.focus();
  refreshLog();
}
function closeInput(relock: boolean) {
  typing = false;
  wrapEl.style.display = 'none';
  inputEl.blur();
  refreshLog();
  if (relock && !document.body.classList.contains('touch')) deps.lock();
}
export function isTyping() { return typing; }

// ---------- Voice: local mic ----------
type Mode = 'off' | 'ptt' | 'open';
let mode: Mode = 'off';
let pttHeld = false;
let micStream: MediaStream | null = null;
let micTrack: MediaStreamTrack | null = null;
let micAnalyser: AnalyserNode | null = null;
let micSrc: MediaStreamAudioSourceNode | null = null;
let ctx: AudioContext | null = null;

function ensureCtx(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  return ctx;
}
// Browsers keep audio suspended until a user gesture; resume on any.
const resumeCtx = () => { if (ctx && ctx.state === 'suspended') void ctx.resume(); };

async function startMic(): Promise<boolean> {
  if (!navigator.mediaDevices?.getUserMedia) {
    addLine('', 'Voice chat needs a secure (https) connection and a browser that supports microphones.', false, true);
    return false;
  }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    const denied = err instanceof DOMException && err.name === 'NotAllowedError';
    addLine('', denied ? 'Microphone access was blocked — allow it in your browser\'s site settings to use voice.' : 'Couldn\'t open a microphone.', false, true);
    return false;
  }
  micTrack = micStream.getAudioTracks()[0];
  micTrack.enabled = false; // gated by applyTx()
  const c = ensureCtx();
  if (c) {
    resumeCtx();
    micSrc = c.createMediaStreamSource(micStream);
    micAnalyser = c.createAnalyser();
    micAnalyser.fftSize = 256;
    micSrc.connect(micAnalyser); // analysis only — never routed to the speakers (no echo)
  }
  for (const p of peers.values()) void p.sender.replaceTrack(micTrack).catch(() => {});
  return true;
}

function stopMic() {
  for (const p of peers.values()) void p.sender.replaceTrack(null).catch(() => {});
  micSrc?.disconnect(); micSrc = null; micAnalyser = null;
  micStream?.getTracks().forEach(t => t.stop()); // also turns off the browser's recording indicator
  micStream = null; micTrack = null;
}

function transmitting() { return mode === 'open' || (mode === 'ptt' && pttHeld); }
function applyTx() {
  if (micTrack) micTrack.enabled = transmitting();
  refreshMicBtn();
}
function refreshMicBtn() {
  const label = mode === 'off' ? 'Off' : mode === 'ptt' ? 'Hold Q' : 'Open mic';
  micBtn.textContent = `🎤 Voice: ${label}`;
  micBtn.classList.toggle('live', mode !== 'off' && transmitting());
  micBtn.classList.remove('err');
}

async function cycleMode() {
  const isTouch = document.body.classList.contains('touch');
  const next: Mode = mode === 'off' ? (isTouch ? 'open' : 'ptt') : mode === 'ptt' ? 'open' : 'off';
  if (next === 'off') { stopMic(); mode = 'off'; }
  else {
    if (!micTrack && !(await startMic())) { mode = 'off'; refreshMicBtn(); micBtn.classList.add('err'); return; }
    mode = next;
  }
  applyTx();
}

// ---------- Voice: peers (WebRTC mesh) ----------
interface Peer {
  id: string; name: string;
  pc: RTCPeerConnection; sender: RTCRtpSender;
  pending: RTCIceCandidateInit[];
  audio?: HTMLAudioElement;
  src?: MediaStreamAudioSourceNode; panner?: PannerNode; analyser?: AnalyserNode;
  speaking: boolean;
}
const peers = new Map<string, Peer>();
const sendRtc = (to: string, data: unknown) => deps.send({ t: 'rtc', to, data });

function getPeer(id: string): Peer {
  const existing = peers.get(id);
  if (existing) return existing;
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  // One send+receive audio transceiver, created up front on both sides. The mic is
  // attached/detached later with replaceTrack(), so toggling voice never needs a
  // renegotiation — and everyone can hear even before they enable their own mic.
  const tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
  const peer: Peer = { id, name: '', pc, sender: tr.sender, pending: [], speaking: false };
  peers.set(id, peer);
  if (micTrack) void tr.sender.replaceTrack(micTrack).catch(() => {});

  pc.onicecandidate = e => { if (e.candidate) sendRtc(id, { candidate: e.candidate.toJSON() }); };
  pc.ontrack = e => attachRemote(peer, e.streams[0] ?? new MediaStream([e.track]));
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') {
      addLine('', `Voice link to ${peer.name || 'a player'} failed (their network may block direct connections).`, false, true);
    }
  };
  // Exactly one side of each pair makes the offer (the lower id), so offers never collide.
  if (deps.getMyId() < id) void makeOffer(peer);
  return peer;
}

async function makeOffer(peer: Peer) {
  try {
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    sendRtc(peer.id, { desc: peer.pc.localDescription });
  } catch (err) { console.warn('voice offer failed', err); }
}

async function onRtc(from: string, data: any) {
  if (!data) return;
  const peer = getPeer(from);
  const pc = peer.pc;
  if (data.desc) {
    await pc.setRemoteDescription(data.desc);
    for (const c of peer.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
    if (data.desc.type === 'offer') {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendRtc(from, { desc: pc.localDescription });
    }
  } else if (data.candidate) {
    if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {});
    else peer.pending.push(data.candidate); // candidate beat the offer/answer here; hold it
  }
}

function attachRemote(peer: Peer, stream: MediaStream) {
  const c = ensureCtx();
  if (!c) return;
  // Chrome only starts flowing a remote WebRTC stream into Web Audio if it's also
  // attached to a media element; keep it muted so it isn't heard twice.
  peer.audio = new Audio();
  peer.audio.srcObject = stream;
  peer.audio.muted = true;
  void peer.audio.play().catch(() => {});

  const src = c.createMediaStreamSource(stream);
  const panner = c.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'linear';
  panner.refDistance = REF_DIST;
  panner.maxDistance = MAX_DIST;
  panner.rolloffFactor = 1;
  const analyser = c.createAnalyser();
  analyser.fftSize = 256;
  src.connect(panner);
  panner.connect(c.destination);
  src.connect(analyser);
  peer.src = src; peer.panner = panner; peer.analyser = analyser;
}

function closePeer(id: string) {
  const p = peers.get(id);
  if (!p) return;
  peers.delete(id);
  p.src?.disconnect(); p.panner?.disconnect();
  if (p.audio) p.audio.srcObject = null;
  p.pc.onicecandidate = null; p.pc.ontrack = null; p.pc.onconnectionstatechange = null;
  p.pc.close();
}

const levelBuf = new Uint8Array(256);
function rms(a: AnalyserNode): number {
  a.getByteTimeDomainData(levelBuf);
  let s = 0;
  for (let i = 0; i < levelBuf.length; i++) { const d = (levelBuf[i] - 128) / 128; s += d * d; }
  return Math.sqrt(s / levelBuf.length);
}

function setPos(p: PannerNode, x: number, y: number, z: number) {
  if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; }
  else (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z);
}

let lastSpeakingKey = '';
export function updateVoice(f: VoiceFrame) {
  if (!inited) return;

  // Keep one connection per other player in the room.
  const present = new Set<string>();
  for (const p of f.peers) {
    present.add(p.id);
    getPeer(p.id).name = p.name;
  }
  for (const id of [...peers.keys()]) if (!present.has(id)) closePeer(id);

  // Move the "ears" to the player's head, facing where they look.
  if (ctx) {
    const L = ctx.listener;
    if (L.positionX) {
      L.positionX.value = f.listener.x; L.positionY.value = f.listener.y; L.positionZ.value = f.listener.z;
      L.forwardX.value = f.forward.x; L.forwardY.value = f.forward.y; L.forwardZ.value = f.forward.z;
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      const old = L as unknown as { setPosition(x: number, y: number, z: number): void; setOrientation(...a: number[]): void };
      old.setPosition(f.listener.x, f.listener.y, f.listener.z);
      old.setOrientation(f.forward.x, f.forward.y, f.forward.z, 0, 1, 0);
    }
  }

  // Put each voice where its player is; work out who is talking.
  const talking: string[] = [];
  if (micAnalyser && transmitting() && rms(micAnalyser) > SPEAK_THRESHOLD) talking.push('you');
  for (const pos of f.peers) {
    const peer = peers.get(pos.id);
    if (!peer?.panner || !peer.analyser) continue;
    setPos(peer.panner, pos.x, pos.y, pos.z);
    peer.speaking = rms(peer.analyser) > SPEAK_THRESHOLD;
    if (peer.speaking) talking.push(pos.name);
  }
  const key = talking.join('|');
  if (key !== lastSpeakingKey) {
    lastSpeakingKey = key;
    voiceListEl.textContent = '';
    for (const n of talking) {
      const d = document.createElement('div');
      d.textContent = (n === 'you' ? '🎤 ' : '🔊 ') + n;
      voiceListEl.appendChild(d);
    }
  }
}

// ---------- Wiring ----------
/** Returns true if the message was a chat/voice message (handled here). */
export function handleServerMsg(m: { t: string; [k: string]: unknown }): boolean {
  if (!inited) return false;
  if (m.t === 'chat') {
    addLine(String(m.name ?? '?'), String(m.text ?? ''), m.id === deps.getMyId());
    return true;
  }
  if (m.t === 'rtc') {
    void onRtc(String(m.from), m.data).catch(err => console.warn('voice signaling error', err));
    return true;
  }
  return false;
}

export function initChat(d: Deps) {
  if (inited) return;
  deps = d;
  buildUI();
  inited = true;

  chatBtn.onclick = () => { chatBtn.blur(); openInput(); };
  micBtn.onclick = () => { micBtn.blur(); void cycleMode(); };

  inputEl.addEventListener('keydown', e => {
    e.stopPropagation(); // keep typed letters (w, a, s, d, e, q...) away from the game's key handlers
    if (e.key === 'Enter') {
      const text = inputEl.value.trim();
      if (text) deps.send({ t: 'chat', text });
      closeInput(true);
    } else if (e.key === 'Escape') closeInput(true);
  });

  addEventListener('keydown', e => {
    if (typing) return;
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
    if (e.key === 'Enter') { if (deps.getMyId()) { e.preventDefault(); openInput(); } }
    else if (e.key.toLowerCase() === 'q' && !e.repeat) { pttHeld = true; applyTx(); }
  });
  addEventListener('keyup', e => { if (e.key.toLowerCase() === 'q') { pttHeld = false; applyTx(); } });
  addEventListener('blur', () => { pttHeld = false; applyTx(); }); // never get stuck transmitting
  document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement && typing) closeInput(false); });
  addEventListener('pointerdown', resumeCtx, true);
  addEventListener('keydown', resumeCtx, true);

  setInterval(refreshLog, 1000);
}
