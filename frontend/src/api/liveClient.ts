/**
 * LiveClient — WebSocket client for the Live Voice Agent (Hybrid Proxy).
 *
 * Connects to the backend WS endpoint at /api/v1/voice/live.
 * Handles the mixed binary/JSON protocol defined in the V2 plan §4.
 *
 * Protocol:
 *   Client → Backend:  Binary frames (Int16 PCM)  |  Text frames (JSON control)
 *   Backend → Client:  Binary frames (Int16 PCM)  |  Text frames (JSON events)
 *
 * This module does NOT import from the Standard Agent's api/voice.ts or api/client.ts.
 */

// ---------------------------------------------------------------------------
// Types — Backend → Client JSON message envelopes (plan §4b)
// ---------------------------------------------------------------------------

export interface TaskUpdateMessage {
  type: 'task_update';
  data: Record<string, any>;
}

export interface TranscriptMessage {
  type: 'transcript';
  source: 'user' | 'model';
  text: string;
  isComplete: boolean;
}

export interface TurnCompleteMessage {
  type: 'turn_complete';
}

export interface InterruptedMessage {
  type: 'interrupted';
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export interface PingMessage {
  type: 'ping';
}

export type LiveServerMessage =
  | TaskUpdateMessage
  | TranscriptMessage
  | TurnCompleteMessage
  | InterruptedMessage
  | ErrorMessage
  | PingMessage;

// ---------------------------------------------------------------------------
// Callback interface — consumer wires these in (plan §6b)
// ---------------------------------------------------------------------------

export interface LiveMessageHandler {
  onAudioChunk: (pcmBytes: ArrayBuffer) => void;
  onTaskUpdate: (data: Record<string, any>) => void;
  onTranscript: (source: 'user' | 'model', text: string, isComplete: boolean) => void;
  onTurnComplete: () => void;
  onInterrupted: () => void;
  onError: (message: string) => void;
  onClose: (code?: number, reason?: string) => void;
}

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface LiveConnection {
  sendAudio: (pcmBuffer: ArrayBuffer) => void;
  sendControl: (type: string) => void;
  close: () => void;
}

// ---------------------------------------------------------------------------
// Factory — creates a WS connection wired to handlers
// ---------------------------------------------------------------------------

/**
 * Derive the WS URL from the same env var pattern as api/client.ts.
 * VITE_API_URL = "http://localhost:8000/api/v1" → "ws://localhost:8000/api/v1/voice/live"
 */
function buildWsUrl(): string {
  const httpBase = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';
  const wsBase = httpBase.replace(/^http/, 'ws');
  return `${wsBase}/voice/live`;
}

/**
 * Open a WebSocket connection to the Live Agent backend and wire message routing.
 *
 * Binary frames → handlers.onAudioChunk
 * JSON text frames → routed by `type` field to the appropriate handler
 *
 * @returns Promise that resolves with a LiveConnection once the WS is open.
 */
export function createLiveConnection(handlers: LiveMessageHandler): Promise<LiveConnection> {
  const url = buildWsUrl();
  const ws = new WebSocket(url);

  // CRITICAL: receive binary as ArrayBuffer, not Blob (plan §6b)
  ws.binaryType = 'arraybuffer';

  // --- Message routing ---
  ws.onmessage = (event: MessageEvent) => {
    if (event.data instanceof ArrayBuffer) {
      // Binary frame = audio from Gemini (Int16 PCM, 24kHz)
      handlers.onAudioChunk(event.data);
    } else if (typeof event.data === 'string') {
      // Text frame = JSON control/event message
      try {
        const msg = JSON.parse(event.data) as LiveServerMessage;
        switch (msg.type) {
          case 'task_update':
            handlers.onTaskUpdate(msg.data);
            break;
          case 'transcript':
            handlers.onTranscript(msg.source, msg.text, msg.isComplete);
            break;
          case 'turn_complete':
            handlers.onTurnComplete();
            break;
          case 'interrupted':
            handlers.onInterrupted();
            break;
          case 'error':
            handlers.onError(msg.message);
            break;
          case 'ping':
            // Keep-alive from backend, no action needed (TCP activity prevents timeout)
            break;
          default:
            console.warn('[LiveClient] Unknown message type:', msg);
        }
      } catch (e) {
        console.error('[LiveClient] Failed to parse JSON message:', e);
      }
    }
  };

  ws.onerror = () => {
    handlers.onError('WebSocket connection error');
  };

  ws.onclose = (event: CloseEvent) => {
    handlers.onClose(event.code, event.reason);
  };

  // --- Outbound methods ---
  const sendAudio = (pcmBuffer: ArrayBuffer): void => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(pcmBuffer);
    }
  };

  const sendControl = (type: string): void => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type }));
    }
  };

  const close = (): void => {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  };

  // Return a promise that resolves when the WS is open
  return new Promise<LiveConnection>((resolve, reject) => {
    ws.onopen = () => {
      resolve({ sendAudio, sendControl, close });
    };

    // If the WS fails to open, reject
    const originalOnError = ws.onerror;
    ws.onerror = (event) => {
      if (ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Failed to connect to Live Agent WebSocket'));
      }
      // Re-assign the normal error handler after connection attempt
      if (originalOnError) {
        originalOnError.call(ws, event);
      }
    };
  });
}
