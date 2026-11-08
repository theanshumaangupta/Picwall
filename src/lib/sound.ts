// UI sound effects, all generated from one short tick sample through Web Audio.
// Browsers block audio until a user gesture, so the context is created lazily and
// "unlocked" on the first pointer/key event.

const UNLOCK_EVENTS = ["touchend", "pointerdown", "mousedown", "keydown"] as const;

let ctx: AudioContext | null = null;
let buffer: AudioBuffer | null = null;
let bytes: Promise<ArrayBuffer> | null = null;
let decoding = false;
let unlocked = false;
let enabled = true;
let lastTick = 0;

function fetchSample() {
  return (bytes ??= fetch("/tick.mp3").then((r) => r.arrayBuffer()));
}

function getContext() {
  fetchSample();
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") ctx.resume();
  if (!buffer && !decoding && bytes) {
    decoding = true;
    const c = ctx;
    bytes
      .then((b) => c.decodeAudioData(b.slice(0)))
      .then((decoded) => (buffer = decoded))
      .catch((err) => console.warn("Tick sound unavailable:", err));
  }
  return ctx;
}

function unlock() {
  const c = getContext();
  if (!c) return;
  if (!unlocked) {
    // Playing a silent 1-sample buffer inside the gesture unlocks iOS/Safari.
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, c.sampleRate);
    src.connect(c.destination);
    src.start(0);
  }
  if (c.state === "running") {
    unlocked = true;
    UNLOCK_EVENTS.forEach((e) => window.removeEventListener(e, unlock, true));
  }
}

if (typeof window !== "undefined") {
  const warm = () => void fetchSample();
  if ("requestIdleCallback" in window) requestIdleCallback(warm, { timeout: 2500 });
  else setTimeout(warm, 1500);
  UNLOCK_EVENTS.forEach((e) => window.addEventListener(e, unlock, { capture: true, passive: true }));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && ctx?.state === "suspended") ctx.resume();
  });
}

function play(rate: number, gain: number, at = 0) {
  const c = getContext();
  if (!c || c.state !== "running" || !buffer) return;
  const src = c.createBufferSource();
  const vol = c.createGain();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  vol.gain.value = gain;
  src.connect(vol);
  vol.connect(c.destination);
  src.start(c.currentTime + at);
}

/** Single UI tick — hovers, clicks, keyboard steps. */
export function playTick() {
  if (!enabled || !ctx) return;
  if (ctx.currentTime - lastTick < 0.02) return;
  lastTick = ctx.currentTime;
  play(1, 0.6);
}

/** Two pitched ticks — a camera-shutter "ka-chick". */
export function playShutter() {
  if (!enabled) return;
  lastTick = ctx?.currentTime ?? 0;
  play(0.62, 0.5);
  play(1, 0.75, 0.09);
}

export function setSoundEnabled(on: boolean) {
  enabled = on;
  if (on) unlock();
}

export function isSoundEnabled() {
  return enabled;
}
