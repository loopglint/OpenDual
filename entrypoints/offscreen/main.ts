/**
 * Offscreen Document for heavy WebAudio decoding / 16kHz Mono WAV slicing
 * when an X/YouTube captionless video exceeds direct upload size limits (~18MB).
 */

interface SliceAudioRequest {
  type: 'OFFSCREEN_SLICE_AUDIO';
  mediaBase64: string;
  chunkDurationSec: number;
}

interface SlicedChunk {
  wavBase64: string;
  offsetMs: number;
}

function encodeWav16kMono(samples: Float32Array, sampleRate: number): Uint8Array {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const raw = samples[i] ?? 0;
    const s = Math.max(-1, Math.min(1, raw));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function decodeAndSliceToWav16k(
  mediaBuf: ArrayBuffer,
  chunkDurationSec: number,
): Promise<SlicedChunk[]> {
  const targetRate = 16000;
  const audioCtx = new AudioContext();
  try {
    const decoded = await audioCtx.decodeAudioData(mediaBuf.slice(0));
    // Resample to 16kHz mono via OfflineAudioContext
    const totalFrames = Math.ceil(decoded.duration * targetRate);
    const offline = new OfflineAudioContext(1, totalFrames, targetRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    const mono = rendered.getChannelData(0);

    const framesPerChunk = Math.max(targetRate * 10, Math.floor(chunkDurationSec * targetRate));
    const chunks: SlicedChunk[] = [];

    for (let pos = 0; pos < mono.length; pos += framesPerChunk) {
      const slice = mono.subarray(pos, Math.min(mono.length, pos + framesPerChunk));
      const wavBytes = encodeWav16kMono(slice, targetRate);
      chunks.push({
        wavBase64: uint8ToBase64(wavBytes),
        offsetMs: Math.round((pos / targetRate) * 1000),
      });
    }
    return chunks;
  } finally {
    await audioCtx.close();
  }
}

chrome.runtime.onMessage.addListener((msg: SliceAudioRequest, _sender, sendResponse) => {
  if (msg?.type !== 'OFFSCREEN_SLICE_AUDIO') return false;
  (async () => {
    try {
      const buf = base64ToArrayBuffer(msg.mediaBase64);
      const chunks = await decodeAndSliceToWav16k(buf, msg.chunkDurationSec || 60);
      sendResponse({ ok: true, chunks });
    } catch (err) {
      sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();
  return true;
});
