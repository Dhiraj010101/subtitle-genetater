import React, { useRef } from 'react';

interface VideoUploaderProps {
  onFileSelect: (file: File) => void;
  isLoading?: boolean;
}

const VideoUploader: React.FC<VideoUploaderProps> = ({ onFileSelect, isLoading }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (isLoading) return;
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('video/')) {
      onFileSelect(file);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileSelect(e.target.files[0]);
    }
  };

  return (
    <div 
      className={`border-2 border-dashed border-zinc-700 rounded-2xl p-10 flex flex-col items-center justify-center text-center transition-all 
        ${isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:border-brand-accent hover:bg-zinc-900 cursor-pointer'}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      onClick={() => !isLoading && inputRef.current?.click()}
    >
      <input 
        type="file" 
        accept="video/*" 
        className="hidden" 
        ref={inputRef} 
        onChange={handleChange}
        disabled={isLoading}
      />
      
      <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mb-4 text-brand-accent">
        <i className="fa-solid fa-cloud-arrow-up text-2xl"></i>
      </div>
      
      <h3 className="text-xl font-bold mb-2">Upload Video</h3>
      <p className="text-zinc-400 text-sm max-w-xs">
        Drag & drop or click to upload. <br/> 
        Recommended: MP4, Vertical (9:16), Max 200MB.
      </p>
    </div>
  );
};

export default VideoUploader;