import { test } from "node:test";
import assert from "node:assert/strict";
import { GameAudio } from "../src/audio.js";

class Context {
  constructor() { this.state = "suspended"; this.sampleRate = 8000; this.currentTime = 0; this.resumeCalls = 0; this.starts = 0; }
  createGain() { return { gain: { value: 0, setTargetAtTime(value) { this.value = value; } }, connect() { return this; } }; }
  createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
  createBufferSource() { return { connect() { return this; }, start: () => { this.starts++; } }; }
  createBiquadFilter() { return { frequency: { value: 0 }, connect() { return this; } }; }
  resume() { this.resumeCalls++; this.state = "running"; return Promise.resolve(); }
  suspend() { this.state = "suspended"; return Promise.resolve(); }
}

function environment(navigator, Audio) {
  const saved = Object.fromEntries(["window", "navigator", "Audio"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window: { AudioContext: Context }, navigator, Audio }))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  return () => { for (const [key, descriptor] of Object.entries(saved)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  } };
}

test("the first suspended Safari context and later interruptions resume on the same graph", () => {
  const session = { type: "auto" }, restore = environment({ audioSession: session, userAgent: "iPhone", maxTouchPoints: 1 });
  try {
    const audio = new GameAudio();
    assert.equal(audio.init(), true);
    assert.equal(session.type, "playback");
    const context = audio.context;
    assert.equal(context.resumeCalls, 1, "resume the context created by the first gesture too");
    assert.equal(context.starts, 2, "wind and the silent unlock frame both start");
    context.state = "interrupted";
    assert.equal(audio.init(), true);
    assert.equal(audio.context, context);
    assert.equal(context.resumeCalls, 2);
    audio.setEnabled(false);
    audio.suspend();
    audio.init();
    assert.equal(audio.master.gain.value, 0, "resuming must preserve mute");
  } finally { restore(); }
});

test("older iOS unlocks a local silent media route and pauses it when the page hides", async () => {
  class Media {
    constructor(src) { this.src = src; this.paused = true; this.plays = 0; }
    setAttribute() {}
    play() { this.paused = false; this.plays++; return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  const restore = environment({ userAgent: "iPhone", maxTouchPoints: 1 }, Media);
  let source;
  try {
    const audio = new GameAudio();
    assert.equal(audio.init(), true);
    source = audio.mediaPlayback.src;
    const wav = new DataView(await (await fetch(source)).arrayBuffer());
    assert.equal(wav.getUint32(0), 0x52494646);
    assert.equal(wav.getUint32(40, true), wav.byteLength - 44);
    assert.equal(wav.getUint16(22, true), 1);
    assert.equal(audio.mediaPlayback.loop, true);
    assert.equal(audio.mediaPlayback.plays, 1);
    audio.init();
    assert.equal(audio.mediaPlayback.plays, 1, "reuse the playing media element");
    audio.suspend();
    assert.equal(audio.context.state, "suspended");
    assert.equal(audio.mediaPlayback.paused, true);
    audio.init();
    assert.equal(audio.mediaPlayback.plays, 2);
    audio.setEnabled(false);
    audio.init();
    assert.equal(audio.mediaPlayback.paused, true, "mute also pauses the legacy media route");
  } finally { if (source) URL.revokeObjectURL(source); restore(); }
});
