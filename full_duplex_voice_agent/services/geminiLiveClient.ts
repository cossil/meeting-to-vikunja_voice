import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { createPcmBlob, base64ToBytes, decodeAudioData } from '../utils/audioUtils';

// Configuration constants
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
// 'Kore' is a voice that can work well for a helpful assistant.
const VOICE_NAME = 'Kore'; 

type TranscriptCallback = (text: string, source: 'user' | 'model', isComplete: boolean) => void;
type VolumeCallback = (vol: number, source: 'user' | 'model') => void;
type CloseCallback = () => void;

export class GeminiLiveClient {
  private ai: GoogleGenAI;
  private inputAudioContext: AudioContext | null = null;
  private outputAudioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private nextStartTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private session: any = null;
  private sessionPromise: Promise<any> | null = null;
  
  // State for transcription aggregation
  private currentInputTranscription = '';
  private currentOutputTranscription = '';

  // Callbacks
  public onTranscript: TranscriptCallback | null = null;
  public onVolume: VolumeCallback | null = null;
  public onClose: CloseCallback | null = null;

  constructor() {
    const apiKey = process.env.API_KEY || '';
    if (!apiKey) {
        console.error("API Key is missing. Please set process.env.API_KEY");
    }
    this.ai = new GoogleGenAI({ apiKey });
  }

  public async connect() {
    // Initialize Audio Contexts
    this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: INPUT_SAMPLE_RATE,
    });
    this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: OUTPUT_SAMPLE_RATE,
    });

    // Get User Media
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Start Session
    this.sessionPromise = this.ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-09-2025',
      callbacks: {
        onopen: this.handleOpen.bind(this),
        onmessage: this.handleMessage.bind(this),
        onerror: (e) => {
            console.error("Gemini Live API Error:", e);
            this.disconnect();
        },
        onclose: (e) => {
            console.log("Gemini Live API Closed");
            this.disconnect();
        },
      },
      config: {
        // Use string literal 'AUDIO' to ensure compatibility if Enum import fails
        responseModalities: ['AUDIO'], 
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_NAME } },
        },
        // Format systemInstruction as Content object to prevent handshake errors
        systemInstruction: {
          parts: [
            {
              text: `You are a friendly, professional, and sunny hotel receptionist at the 'Sunshine Palms Resort' in Florida. 
              You have a welcoming female American accent. 
              Your goal is to assist guests with checking in, recommending local attractions (beaches, theme parks, dining), and handling simple concierge requests.
              Keep your answers concise, helpful, and polite.
              Always maintain the persona of a helpful hotel staff member.`,
            },
          ],
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    });
  }

  public disconnect() {
    if (this.session) {
        try {
            this.session.close();
        } catch (e) {
            console.warn("Error closing session:", e);
        }
    }
    this.session = null;
    this.sessionPromise = null;

    // Stop media stream
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    // Close audio contexts
    if (this.inputAudioContext) {
      this.inputAudioContext.close();
      this.inputAudioContext = null;
    }
    if (this.outputAudioContext) {
      this.outputAudioContext.close();
      this.outputAudioContext = null;
    }

    // Cleanup sources
    this.sources.forEach(source => source.stop());
    this.sources.clear();
    this.nextStartTime = 0;

    if (this.onClose) {
        this.onClose();
    }
  }

  private handleOpen() {
    if (!this.inputAudioContext || !this.stream || !this.sessionPromise) return;

    const source = this.inputAudioContext.createMediaStreamSource(this.stream);
    
    // Setup Audio Analysis for Volume Visualization (User)
    const analyzer = this.inputAudioContext.createAnalyser();
    analyzer.fftSize = 256;
    const dataArray = new Uint8Array(analyzer.frequencyBinCount);
    source.connect(analyzer);

    // Legacy ScriptProcessor for streaming audio chunks
    const scriptProcessor = this.inputAudioContext.createScriptProcessor(4096, 1, 1);
    
    scriptProcessor.onaudioprocess = (e) => {
        // Volume Check
        analyzer.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b) / dataArray.length;
        if (this.onVolume) {
            this.onVolume(avg / 255, 'user');
        }

        const inputData = e.inputBuffer.getChannelData(0);
        const pcmBlob = createPcmBlob(inputData);
        
        this.sessionPromise?.then((session: any) => {
            this.session = session;
            session.sendRealtimeInput({ media: pcmBlob });
        });
    };

    source.connect(scriptProcessor);
    scriptProcessor.connect(this.inputAudioContext.destination);
  }

  private async handleMessage(message: LiveServerMessage) {
    // 1. Handle Transcriptions
    if (message.serverContent?.outputTranscription) {
        this.currentOutputTranscription += message.serverContent.outputTranscription.text;
        this.onTranscript?.(this.currentOutputTranscription, 'model', false);
    }
    if (message.serverContent?.inputTranscription) {
        this.currentInputTranscription += message.serverContent.inputTranscription.text;
        this.onTranscript?.(this.currentInputTranscription, 'user', false);
    }

    if (message.serverContent?.turnComplete) {
        // Finalize transcripts
        if (this.currentInputTranscription.trim()) {
            this.onTranscript?.(this.currentInputTranscription, 'user', true);
        }
        if (this.currentOutputTranscription.trim()) {
            this.onTranscript?.(this.currentOutputTranscription, 'model', true);
        }
        this.currentInputTranscription = '';
        this.currentOutputTranscription = '';
    }

    // 2. Handle Audio Output
    const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
    if (base64Audio && this.outputAudioContext) {
        this.nextStartTime = Math.max(this.nextStartTime, this.outputAudioContext.currentTime);
        
        const audioBuffer = await decodeAudioData(
            base64ToBytes(base64Audio),
            this.outputAudioContext,
            OUTPUT_SAMPLE_RATE,
            1
        );

        const source = this.outputAudioContext.createBufferSource();
        source.buffer = audioBuffer;
        
        // Analyze output volume
        const analyzer = this.outputAudioContext.createAnalyser();
        analyzer.fftSize = 256;
        const dataArray = new Uint8Array(analyzer.frequencyBinCount);
        source.connect(analyzer);
        analyzer.connect(this.outputAudioContext.destination);
        
        // Quick loop to report volume during playback
        const reportVolume = () => {
            if (!this.outputAudioContext) return;
            analyzer.getByteFrequencyData(dataArray);
            const avg = dataArray.reduce((a, b) => a + b) / dataArray.length;
            this.onVolume?.(avg / 255, 'model');
            if (this.sources.has(source)) {
                 requestAnimationFrame(reportVolume);
            } else {
                this.onVolume?.(0, 'model');
            }
        };
        reportVolume();

        source.addEventListener('ended', () => {
            this.sources.delete(source);
        });

        source.start(this.nextStartTime);
        this.nextStartTime += audioBuffer.duration;
        this.sources.add(source);
    }

    // 3. Handle Interruption
    if (message.serverContent?.interrupted) {
        this.sources.forEach(src => src.stop());
        this.sources.clear();
        this.nextStartTime = 0;
        this.currentOutputTranscription = ''; // Clear partial if interrupted
    }
  }
}