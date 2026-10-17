const CROSSFADE_SEC = 3.5;
const TRACK_FADE_SEC = 2.0;
const DUCK_LEVEL = 0.22;

const TRACKS = {
  menu: { file: "menu-qiufengci.mp3", title: "秋風詞", credit: "Charlie Huang" },
  1: { file: "chapter1-qiufengci.mp3", title: "秋風詞", credit: "Charlie Huang" },
  2: { file: "chapter2-pingsha.mp3", title: "平沙落雁", credit: "Charlie Huang" },
  3: { file: "chapter3-liushui.mp3", title: "流水", credit: "Charlie Huang" },
  4: { file: "chapter4-jiukuang.mp3", title: "酒狂", credit: "Charlie Huang" },
};

const buffers = new Map();
const loading = new Map();

let ctx = null;
let master = null;
let current = null;
let currentName = null;
let volume = 0.55;
let muted = false;
let ducked = false;
let failed = false;
let requestId = 0;

const listeners = new Set();

function emit() {
  for (const fn of listeners) fn(getState());
}

export function onAudioState(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() {
  return {
    ready: !!ctx,
    track: currentName,
    title: currentName ? TRACKS[currentName].title : null,
    credit: currentName ? TRACKS[currentName].credit : null,
    volume,
    muted,
    failed,
  };
}

function ensureContext() {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) {
    failed = true;
    return null;
  }
  ctx = new Ctor();
  installUnlock();
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  return ctx;
}

let unlockInstalled = false;

function tryResume() {
  if (!ctx || ctx.state !== "suspended") return;
  try {
    const r = ctx.resume();
    if (r && typeof r.catch === "function") r.catch(() => {});
  } catch (e) {
    void e;
  }
}

function installUnlock() {
  if (unlockInstalled) return;
  unlockInstalled = true;
  const unlock = () => {
    tryResume();
  };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
  window.addEventListener("touchstart", unlock, { passive: true });
}

function targetGain() {
  if (muted) return 0;
  return volume * (ducked ? DUCK_LEVEL : 1);
}

function rampGain(node, to, seconds) {
  const now = ctx.currentTime;
  node.gain.cancelScheduledValues(now);
  node.gain.setValueAtTime(node.gain.value, now);
  node.gain.linearRampToValueAtTime(to, now + seconds);
}

async function fetchBuffer(name) {
  if (buffers.has(name)) return buffers.get(name);
  if (loading.has(name)) return loading.get(name);

  const task = (async () => {
    const res = await fetch(`./audio/music/${TRACKS[name].file}`);
    if (!res.ok) throw new Error(`audio ${res.status}`);
    const raw = await res.arrayBuffer();
    const decoded = await ctx.decodeAudioData(raw);
    const looped = makeSeamless(decoded);
    buffers.set(name, looped);
    loading.delete(name);
    return looped;
  })();

  loading.set(name, task);
  return task;
}

function makeSeamless(buffer) {
  const sr = buffer.sampleRate;
  const fadeLen = Math.min(Math.floor(sr * CROSSFADE_SEC), Math.floor(buffer.length / 3));
  const outLen = buffer.length - fadeLen;
  const out = ctx.createBuffer(buffer.numberOfChannels, outLen, sr);

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);

    dst.set(src.subarray(0, outLen));

    for (let i = 0; i < fadeLen; i++) {
      const t = i / fadeLen;
      const tail = src[outLen + i];
      const head = src[i];
      dst[outLen - fadeLen + i] = tail * Math.cos((t * Math.PI) / 2) + head * Math.sin((t * Math.PI) / 2);
    }
  }
  return out;
}

export async function play(name) {
  if (failed || !TRACKS[name]) return;
  if (!ensureContext()) return;
  const mine = ++requestId;

  tryResume();

  if (currentName === name && current) return;

  let buffer;
  try {
    buffer = await fetchBuffer(name);
  } catch (e) {
    failed = true;
    emit();
    return;
  }

  if (mine !== requestId) return;
  if (currentName === name && current) return;

  const startAt = ctx.currentTime + 0.05;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(1, startAt + TRACK_FADE_SEC);

  source.connect(gain);
  gain.connect(master);
  source.start(startAt);

  if (current) {
    const dying = current;
    const dyingGain = dying.gain;
    rampGain(dyingGain, 0, TRACK_FADE_SEC);
    try {
      dying.source.stop(startAt + TRACK_FADE_SEC + 0.1);
    } catch (e) {
      void e;
    }
    setTimeout(() => {
      try {
        dying.source.disconnect();
        dyingGain.disconnect();
      } catch (e) {
        void e;
      }
    }, (TRACK_FADE_SEC + 0.6) * 1000);
  }

  current = { source, gain };
  currentName = name;

  rampGain(master, targetGain(), 1.2);
  emit();
}

export function stop() {
  requestId++;
  if (!ctx || !current) return;
  rampGain(master, 0, 0.6);
  const dying = current;
  current = null;
  currentName = null;
  setTimeout(() => {
    try {
      dying.source.stop();
    } catch (e) {
      void e;
    }
  }, 800);
  emit();
}

export function setDuck(on) {
  if (ducked === on) return;
  ducked = on;
  if (ctx) rampGain(master, targetGain(), 0.45);
  emit();
}

export function setVolume(value) {
  volume = Math.max(0, Math.min(1, value));
  try {
    localStorage.setItem("wenyan-rpg-volume", String(volume));
  } catch (e) {
    void e;
  }
  if (ctx) rampGain(master, targetGain(), 0.2);
  emit();
}

export function setMuted(value) {
  muted = value;
  if (ctx) rampGain(master, targetGain(), 0.25);
  emit();
}

export function toggleMuted() {
  setMuted(!muted);
  return muted;
}

export function loadPrefs() {
  try {
    const v = localStorage.getItem("wenyan-rpg-volume");
    if (v !== null) volume = Math.max(0, Math.min(1, parseFloat(v)));
    const m = localStorage.getItem("wenyan-rpg-muted");
    if (m === "1") muted = true;
  } catch (e) {
    void e;
  }
  emit();
}