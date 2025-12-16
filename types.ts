export interface SubtitleSegment {
  startTime: number; // in seconds
  endTime: number;   // in seconds
  text: string;
}

export interface VideoState {
  file: File | null;
  url: string | null;
  duration: number;
  width: number;
  height: number;
}

export enum ProcessingStatus {
  IDLE = 'IDLE',
  UPLOADING = 'UPLOADING',
  ANALYZING = 'ANALYZING',
  READY = 'READY',
  RENDERING = 'RENDERING',
  ERROR = 'ERROR'
}
