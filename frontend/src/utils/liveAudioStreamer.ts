/**
 * LiveAudioStreamer — Audio capture & playback engine for the Live Voice Agent.
 *
 * Ported from reference:
 *   - audioUtils.ts      (PCM conversion: Float32↔Int16, base64↔bytes)
 *   - geminiLiveClient.ts (AudioContext setup, ScriptProcessor capture, gapless playback)
 *
 * Protocol (Hybrid Proxy):
 *   Input:  Mic → 16kHz Int16 PCM → raw ArrayBuffer → sent as binary WS frame
 *   Output: Binary WS frame → Int16 PCM → Float32 → AudioBuffer → gapless playback at 24kHz
 *
 * This module is self-contained. It does NOT import from the Standard Agent's voice modules.
 */

// ---------------------------------------------------------------------------
// Constants (from reference geminiLiveClient.ts:5-6)
// ---------------------------------------------------------------------------
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const SCRIPT_PROCESSOR_BUFFER_SIZE = 4096; // reference :141
const ANALYSER_FFT_SIZE = 256;             // reference :136, :204

// ---------------------------------------------------------------------------
// Audio Format Conversion (ported from reference audioUtils.ts)
// ---------------------------------------------------------------------------

/**
 * Convert Float32 mic samples to Int16 PCM.
 * Ported from: audioUtils.ts:41-48 (createPcmBlob internals)
 */
function float32ToInt16(float32Data: Float32Array): Int16Array {
  const len = float32Data.length;
  const int16 = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, float32Data[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

/**
 * Convert Int16 PCM to Float32 for AudioBuffer playback.
 * Ported from: audioUtils.ts:28-36 (decodeAudioData internals)
 */
function int16ToFloat32(int16Data: Int16Array): Float32Array<ArrayBuffer> {
  const len = int16Data.length;
  const float32 = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    float32[i] = int16Data[i] / 32768.0;
  }
  return float32;
}

/**
 * Compute normalized volume (0-1) from an AnalyserNode's frequency data.
 * Ported from: geminiLiveClient.ts:145-148
 */
function computeVolume(analyser: AnalyserNode, dataArray: Uint8Array<ArrayBuffer>): number {
  analyser.getByteFrequencyData(dataArray);
  const sum = dataArray.reduce((a, b) => a + b, 0);
  return sum / (dataArray.length * 255);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PcmChunkCallback = (pcmBuffer: ArrayBuffer) => void;
export type VolumeCallback = (level: number) => void;

export interface AudioCapture {
  stop: () => void;
}

export interface AudioPlayback {
  enqueue: (pcmBytes: ArrayBuffer) => void;
  interrupt: () => void;
  stop: () => void;
}

// ---------------------------------------------------------------------------
// Audio Capture (Mic → Int16 PCM ArrayBuffer)
// Ported from: geminiLiveClient.ts:129-162
// ---------------------------------------------------------------------------

/**
 * Start capturing mic audio as 16kHz Int16 PCM chunks.
 *
 * Flow: getUserMedia → AudioContext(16kHz) → MediaStreamSource
 *       → AnalyserNode (volume) + ScriptProcessorNode (PCM capture)
 *       → Float32 → Int16 → ArrayBuffer → onPcmChunk callback
 *
 * @returns AudioCapture with a stop() method to release resources.
 */
export async function createAudioCapture(
  onPcmChunk: PcmChunkCallback,
  onVolume: VolumeCallback,
): Promise<AudioCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({
    sampleRate: INPUT_SAMPLE_RATE,
  });

  const source = ctx.createMediaStreamSource(stream);

  // AnalyserNode for volume visualization (reference :135-138)
  const analyser = ctx.createAnalyser();
  analyser.fftSize = ANALYSER_FFT_SIZE;
  const freqData = new Uint8Array(analyser.frequencyBinCount);
  source.connect(analyser);

  // ScriptProcessorNode for raw PCM capture (reference :141)
  const scriptProcessor = ctx.createScriptProcessor(
    SCRIPT_PROCESSOR_BUFFER_SIZE,
    1, // input channels
    1, // output channels
  );

  scriptProcessor.onaudioprocess = (e: AudioProcessingEvent) => {
    // Report volume
    onVolume(computeVolume(analyser, freqData));

    // Convert Float32 → Int16 PCM and fire callback with raw ArrayBuffer
    const inputData = e.inputBuffer.getChannelData(0);
    const int16 = float32ToInt16(inputData);
    onPcmChunk(int16.buffer as ArrayBuffer);
  };

  // Connect graph: source → analyser (for volume), source → scriptProcessor → destination
  source.connect(scriptProcessor);
  scriptProcessor.connect(ctx.destination);

  const stop = () => {
    try {
      scriptProcessor.disconnect();
      source.disconnect();
      analyser.disconnect();
    } catch {
      // Nodes may already be disconnected
    }
    stream.getTracks().forEach((track) => track.stop());
    if (ctx.state !== 'closed') {
      ctx.close().catch(() => {});
    }
  };

  return { stop };
}

// ---------------------------------------------------------------------------
// Audio Playback (Int16 PCM ArrayBuffer → Speaker)
// Ported from: geminiLiveClient.ts:188-238
// ---------------------------------------------------------------------------

/**
 * Create a gapless audio playback manager for 24kHz Int16 PCM chunks.
 *
 * Flow: ArrayBuffer → Int16Array → Float32Array → AudioBuffer(24kHz)
 *       → AudioBufferSourceNode → AnalyserNode (volume) → destination
 *       Gapless scheduling via nextStartTime tracking.
 *
 * @returns AudioPlayback with enqueue(), interrupt(), and stop() methods.
 */
export function createAudioPlayback(onVolume: VolumeCallback): AudioPlayback {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({
    sampleRate: OUTPUT_SAMPLE_RATE,
  });

  let nextStartTime = 0;
  const sources = new Set<AudioBufferSourceNode>();

  // Shared analyser for output volume (reference :203-207)
  const analyser = ctx.createAnalyser();
  analyser.fftSize = ANALYSER_FFT_SIZE;
  const freqData = new Uint8Array(analyser.frequencyBinCount);
  analyser.connect(ctx.destination);

  // Volume reporting loop (reference :210-220)
  let volumeRafId: number | null = null;
  const reportVolume = () => {
    if (ctx.state === 'closed') return;
    if (sources.size > 0) {
      onVolume(computeVolume(analyser, freqData));
      volumeRafId = requestAnimationFrame(reportVolume);
    } else {
      onVolume(0);
      volumeRafId = null;
    }
  };

  /**
   * Enqueue a PCM chunk for gapless playback.
   * Accepts raw Int16 PCM bytes (ArrayBuffer) as received from the backend binary WS frame.
   */
  const enqueue = (pcmBytes: ArrayBuffer): void => {
    if (ctx.state === 'closed') return;

    // Convert Int16 PCM → Float32 (reference audioUtils.ts:28-36)
    const int16 = new Int16Array(pcmBytes);
    const float32 = int16ToFloat32(int16) as Float32Array<ArrayBuffer>;

    // Create AudioBuffer (reference geminiLiveClient.ts:192-197)
    const frameCount = float32.length;
    const audioBuffer = ctx.createBuffer(1, frameCount, OUTPUT_SAMPLE_RATE);
    audioBuffer.copyToChannel(float32, 0);

    // Create source node and connect through analyser (reference :199-207)
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(analyser);

    // Gapless scheduling (reference :190, :227-228)
    nextStartTime = Math.max(nextStartTime, ctx.currentTime);
    source.start(nextStartTime);
    nextStartTime += audioBuffer.duration;

    // Track source for cleanup (reference :223-225, :229)
    sources.add(source);
    source.addEventListener('ended', () => {
      sources.delete(source);
    });

    // Start volume reporting if not already running
    if (volumeRafId === null) {
      volumeRafId = requestAnimationFrame(reportVolume);
    }
  };

  /**
   * Interrupt playback immediately — stop all queued sources.
   * Ported from: geminiLiveClient.ts:233-238
   */
  const interrupt = (): void => {
    sources.forEach((src) => {
      try {
        src.stop();
      } catch {
        // Source may have already ended
      }
    });
    sources.clear();
    nextStartTime = 0;
    onVolume(0);
    if (volumeRafId !== null) {
      cancelAnimationFrame(volumeRafId);
      volumeRafId = null;
    }
  };

  /**
   * Full cleanup — interrupt + close the output AudioContext.
   */
  const stop = (): void => {
    interrupt();
    try {
      analyser.disconnect();
    } catch {
      // May already be disconnected
    }
    if (ctx.state !== 'closed') {
      ctx.close().catch(() => {});
    }
  };

  return { enqueue, interrupt, stop };
}
