import { pipeline } from '@xenova/transformers';
import { SubtitleSegment, Word } from '../types';
import { extractAudioData } from '../utils/audioUtils';

// Singleton to hold the pipeline instance
let transcriber: any = null;

const WORDS_PER_SEGMENT = 5; // Target words per subtitle segment

export const generateSubtitles = async (videoFile: File, onProgress?: (msg: string) => void): Promise<SubtitleSegment[]> => {
  try {
    if (onProgress) onProgress("Loading AI Model (Whisper)...");
    
    // Initialize pipeline if not already done
    if (!transcriber) {
      transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
    }

    if (onProgress) onProgress("Extracting Audio...");
    const audioData = await extractAudioData(videoFile);

    if (onProgress) onProgress("Transcribing Audio (may take a moment)...");
    
    // Run transcription with word-level timestamps
    const output = await transcriber(audioData, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: 'word', 
    });

    if (onProgress) onProgress("Formatting Subtitles...");

    const segments: SubtitleSegment[] = [];
    const chunks = output.chunks || [];

    // Fallback if chunks are empty but text exists
    if (chunks.length === 0 && output.text) {
        return [{
            startTime: 0,
            endTime: audioData.length / 16000,
            text: output.text.trim()
        }];
    }

    // Process word chunks into segments
    let currentWords: Word[] = [];
    let segmentStart: number | null = null;
    let segmentEnd: number | null = null;

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const text = chunk.text;
        const [start, end] = chunk.timestamp;

        // Start of a new segment
        if (segmentStart === null) {
            segmentStart = start;
        }

        // Add word with timing
        currentWords.push({
            text: text.trim(),
            start: start,
            end: end
        });
        segmentEnd = end;

        // Check if we reached the word limit or if there's a significant pause
        const isLimitReached = currentWords.length >= WORDS_PER_SEGMENT;
        
        // Look ahead for pauses
        let hasPause = false;
        if (i < chunks.length - 1) {
             const nextStart = chunks[i+1].timestamp[0];
             if (nextStart - end > 0.8) { // 800ms pause
                 hasPause = true;
             }
        }

        if (isLimitReached || hasPause) {
            segments.push({
                startTime: segmentStart!,
                endTime: segmentEnd!,
                text: currentWords.map(w => w.text).join(' '),
                words: [...currentWords]
            });

            // Reset
            currentWords = [];
            segmentStart = null;
            segmentEnd = null;
        }
    }

    // Add remaining words
    if (currentWords.length > 0 && segmentStart !== null && segmentEnd !== null) {
        segments.push({
            startTime: segmentStart,
            endTime: segmentEnd,
            text: currentWords.map(w => w.text).join(' '),
            words: [...currentWords]
        });
    }

    return segments;

  } catch (error) {
    console.error("Transcription Error:", error);
    throw new Error("Failed to transcribe. ensure your browser supports WebGPU or WebAssembly.");
  }
};