import React, { useEffect, useRef } from 'react';

interface WaveformProps {
  active: boolean;
  level: number; // 0 to 1
  color: string;
}

const Waveform: React.FC<WaveformProps> = ({ active, level, color }) => {
  const bars = 5;
  
  return (
    <div className="flex items-end justify-center gap-1 h-8">
      {Array.from({ length: bars }).map((_, i) => {
        // Simple randomization based on level
        const height = active 
            ? Math.max(4, Math.min(32, level * 32 * (Math.random() + 0.5))) 
            : 4;
        
        return (
          <div
            key={i}
            className={`w-1.5 rounded-full transition-all duration-75 ${color}`}
            style={{ height: `${height}px` }}
          />
        );
      })}
    </div>
  );
};

export default Waveform;