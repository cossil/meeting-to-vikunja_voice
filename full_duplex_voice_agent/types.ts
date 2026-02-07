export interface TranscriptItem {
  id: string;
  source: 'user' | 'model';
  text: string;
  isComplete: boolean;
}

export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export interface AudioVolume {
  user: number;
  model: number;
}