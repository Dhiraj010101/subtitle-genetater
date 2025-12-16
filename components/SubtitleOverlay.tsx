import React, { useMemo } from 'react';
import { SubtitleSegment } from '../types';

interface SubtitleOverlayProps {
  currentTime: number;
  subtitles: SubtitleSegment[];
  fontSizePx: number;
}

const SubtitleOverlay: React.FC<SubtitleOverlayProps> = ({ currentTime, subtitles, fontSizePx }) => {
  const activeSegment = useMemo(() => {
    return subtitles.find(s => currentTime >= s.startTime && currentTime <= s.endTime);
  }, [currentTime, subtitles]);

  if (!activeSegment) return null;

  const words = activeSegment.words ? activeSegment.words.map(w => w.text) : activeSegment.text.split(' ');
  
  // Calculate highlighted index
  let highlightedIndex = -1;
  
  if (activeSegment.words) {
      // Precise word-level highlighting
      // Highlight words that have started
      // We check if currentTime is greater than the start of the word. 
      // To make it feel "fast" and responsive, we can even highlight as soon as it starts.
      highlightedIndex = activeSegment.words.filter(w => currentTime >= w.start).length - 1;
  } else {
      // Fallback: Linear interpolation
      const duration = activeSegment.endTime - activeSegment.startTime;
      const progress = Math.max(0, Math.min(1, (currentTime - activeSegment.startTime) / duration));
      highlightedIndex = Math.floor(progress * words.length);
  }

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-end">
        {/* Position container at approx 20% from bottom to match Canvas export */}
        <div style={{ paddingBottom: '20%' }} className="w-full px-4 text-center">
            <div className="inline-block px-2 py-1">
                {words.map((word, index) => (
                    <span 
                        key={index} 
                        className={`
                            font-black uppercase tracking-wide mx-1 inline-block
                            transition-colors duration-75
                            ${index <= highlightedIndex ? 'text-brand-accent' : 'text-white'}
                        `}
                        style={{
                           fontSize: `${fontSizePx}px`,
                           lineHeight: '1.2',
                           // Match Canvas stroke style
                           WebkitTextStroke: `${Math.max(2, fontSizePx * 0.08)}px black`,
                           paintOrder: 'stroke fill'
                        }}
                    >
                        {word}
                    </span>
                ))}
            </div>
        </div>
    </div>
  );
};

export default SubtitleOverlay;