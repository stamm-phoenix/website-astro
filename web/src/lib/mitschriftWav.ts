/**
 * Builds one WAV file (16 kHz, mono, 16 bit) from pieces of the live recording, so a gap can be
 * transcribed in one job. Each piece is placed at its own time, so the times of the
 * transcript match the recording; missing time becomes silence.
 */

const SAMPLE_RATE = 16_000;

export interface TimedAudio {
  startMs: number;
  audio: Blob;
}

async function decode(audio: Blob): Promise<Float32Array | undefined> {
  // An offline context decodes and resamples without touching the speakers
  const context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  try {
    const buffer = await context.decodeAudioData(await audio.arrayBuffer());
    const mono = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < data.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
    }
    return mono;
  } catch {
    // A damaged piece (e.g. cut off by a crash) becomes silence
    return undefined;
  }
}

function wav(samples: Float32Array): Blob {
  const header = new DataView(new ArrayBuffer(44));
  const write = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) header.setUint8(offset + i, text.charCodeAt(i));
  };
  const dataBytes = samples.length * 2;
  write(0, 'RIFF');
  header.setUint32(4, 36 + dataBytes, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, SAMPLE_RATE, true);
  header.setUint32(28, SAMPLE_RATE * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  write(36, 'data');
  header.setUint32(40, dataBytes, true);
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }
  return new Blob([header.buffer, pcm.buffer], { type: 'audio/wav' });
}

/** One WAV file of exactly the time range `startMs`–`endMs` from the pieces in it. */
export async function buildWav(
  pieces: TimedAudio[],
  startMs: number,
  endMs: number
): Promise<Blob> {
  const samples = new Float32Array(
    Math.max(1, Math.ceil(((endMs - startMs) / 1000) * SAMPLE_RATE))
  );
  for (const piece of pieces) {
    const decoded = await decode(piece.audio);
    if (!decoded) continue;
    const offset = Math.round(((piece.startMs - startMs) / 1000) * SAMPLE_RATE);
    // A piece that starts before the range loses its beginning, one that ends after it its end
    const skip = Math.max(0, -offset);
    const at = Math.max(0, offset);
    if (skip >= decoded.length || at >= samples.length) continue;
    samples.set(decoded.subarray(skip, skip + samples.length - at), at);
  }
  return wav(samples);
}
