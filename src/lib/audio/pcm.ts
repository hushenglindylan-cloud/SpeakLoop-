// Converts recorded audio (whatever container/codec MediaRecorder produced —
// webm/opus on Chrome, mp4/aac on Safari) into the raw PCM format iFlytek's
// real-time transcription service requires: 16 kHz, 16-bit signed,
// little-endian, mono.
//
// This has to happen in the browser rather than on the server: the server
// has no ffmpeg available, and Web Audio can already decode every format
// the same browser was able to record.

const TARGET_SAMPLE_RATE = 16000;

export async function blobToPcm16kMono(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();

  // decodeAudioData handles the container/codec; the temporary context's own
  // sample rate is irrelevant since the OfflineAudioContext below does the
  // actual resampling.
  const decodeContext = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeContext.decodeAudioData(arrayBuffer);
  } finally {
    void decodeContext.close();
  }

  // Resample to 16 kHz mono by rendering through an offline context declared
  // at the target rate — the browser's own resampler handles the conversion.
  const frameCount = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frameCount, TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();

  // Float32 [-1, 1] -> signed 16-bit little-endian.
  const samples = rendered.getChannelData(0);
  const pcm = new DataView(new ArrayBuffer(samples.length * 2));
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    pcm.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  return new Blob([pcm.buffer], { type: 'audio/pcm' });
}
