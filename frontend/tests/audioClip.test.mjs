import test from "node:test";
import assert from "node:assert/strict";

import {
  buildClipFileName,
  encodeAudioBufferToWavArrayBuffer,
  formatClipTime,
  getClipDurationSec,
  isFullClipRange,
  normalizeClipRange,
  validateClipRange,
} from "../src/utils/audioClip.js";

function textAt(view, offset, length) {
  return Array.from({ length }, (_, index) => String.fromCharCode(view.getUint8(offset + index))).join("");
}

test("normalizeClipRange clamps and orders values", () => {
  assert.deepEqual(normalizeClipRange({ startSec: 12, endSec: 3 }, 10), { startSec: 3, endSec: 10 });
  assert.deepEqual(normalizeClipRange({ startSec: -1, endSec: 4 }, 10), { startSec: 0, endSec: 4 });
  assert.equal(normalizeClipRange(null, 10), null);
});

test("validateClipRange treats full range as null and rejects tiny clips", () => {
  assert.equal(validateClipRange({ startSec: 0, endSec: 10 }, 10), null);
  assert.equal(validateClipRange({ startSec: 0.01, endSec: 9.98 }, 10), null);
  assert.throws(() => validateClipRange({ startSec: 1, endSec: 1.1 }, 10), /至少需要/);
  assert.deepEqual(validateClipRange({ startSec: 1, endSec: 2 }, 10), { startSec: 1, endSec: 2 });
});

test("clip helpers format labels, duration, filenames, and full range checks", () => {
  assert.equal(formatClipTime(65.4329), "1:05.432");
  assert.equal(getClipDurationSec({ startSec: 1, endSec: 2.5 }, 10), 1.5);
  assert.equal(isFullClipRange({ startSec: 0, endSec: 10 }, 10), true);
  assert.equal(isFullClipRange({ startSec: 1, endSec: 10 }, 10), false);
  assert.equal(buildClipFileName("voice.take.mp3", { startSec: 1.2, endSec: 3.4 }), "voice.take-clip-1200ms-3400ms.wav");
});

test("encodeAudioBufferToWavArrayBuffer writes a PCM WAV header and data length", () => {
  const channels = [
    new Float32Array([0, 0.5, -0.5]),
    new Float32Array([1, -1, 0.25]),
  ];
  const wav = encodeAudioBufferToWavArrayBuffer({
    numberOfChannels: 2,
    sampleRate: 48000,
    length: 3,
    getChannelData: (index) => channels[index],
  });
  const view = new DataView(wav);

  assert.equal(textAt(view, 0, 4), "RIFF");
  assert.equal(textAt(view, 8, 4), "WAVE");
  assert.equal(textAt(view, 12, 4), "fmt ");
  assert.equal(textAt(view, 36, 4), "data");
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 12);
  assert.equal(wav.byteLength, 56);
});
