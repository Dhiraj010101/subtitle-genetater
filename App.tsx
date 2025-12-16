import React, { useState, useRef, useEffect, useCallback } from 'react';
import VideoUploader from './components/VideoUploader';
import SubtitleOverlay from './components/SubtitleOverlay';
import { generateSubtitles } from './services/transcriptionService';
import { SubtitleSegment, ProcessingStatus } from './types';

const App: React.FC = () => {
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [subtitles, setSubtitles] = useState<SubtitleSegment[]>([]);
  const [status, setStatus] = useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [loadingMessage, setLoadingMessage] = useState<string>("");
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Settings
  const [fontSize, setFontSize] = useState<number>(30); 

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isRenderingRef = useRef(false);

  // Load video
  const handleFileSelect = async (file: File) => {
    try {
      const url = URL.createObjectURL(file);
      setVideoSrc(url);
      setErrorMessage(null);
      setSubtitles([]);
      
      // Start Processing
      setStatus(ProcessingStatus.UPLOADING);
      setLoadingMessage("Preparing video...");
      await new Promise(r => setTimeout(r, 500));
      
      setStatus(ProcessingStatus.ANALYZING);
      // Pass a callback to get progress updates from the service
      const generatedSubs = await generateSubtitles(file, (msg) => setLoadingMessage(msg));
      setSubtitles(generatedSubs);
      setStatus(ProcessingStatus.READY);

    } catch (e: any) {
      console.error(e);
      setStatus(ProcessingStatus.ERROR);
      setErrorMessage(e.message || "An unknown error occurred during transcription.");
    }
  };

  // Video Time Update
  const handleTimeUpdate = () => {
    if (videoRef.current && !isRenderingRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  // Subtitle Editing Handlers
  const handleSubtitleChange = (index: number, field: keyof SubtitleSegment, value: string | number) => {
    const newSubtitles = [...subtitles];
    newSubtitles[index] = { ...newSubtitles[index], [field]: value };
    setSubtitles(newSubtitles);
  };

  // Clean up object URL
  useEffect(() => {
    return () => {
      if (videoSrc) URL.revokeObjectURL(videoSrc);
    };
  }, [videoSrc]);

  // Handle Export (Burn-in)
  const handleExport = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || subtitles.length === 0) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) return;

    setStatus(ProcessingStatus.RENDERING);
    isRenderingRef.current = true;
    setLoadingMessage("Rendering Maximum Quality Video (Large File)...");

    // Cache current state to restore later
    const originalTime = video.currentTime;
    const wasPlaying = !video.paused;
    const originalVolume = video.volume;
    const originalMuted = video.muted;

    try {
        // Prepare for recording
        video.pause();
        video.currentTime = 0;
        // Unmute for capture to ensure audio is recorded
        video.muted = false; 
        video.volume = 1.0;

        // Wait for font loading
        await document.fonts.ready;

        // Wait for seek
        await new Promise<void>((resolve) => {
            const onSeek = () => {
                video.removeEventListener('seeked', onSeek);
                resolve();
            };
            video.addEventListener('seeked', onSeek);
            if (video.currentTime === 0) {
                video.removeEventListener('seeked', onSeek);
                resolve();
            }
        });

        // 1. Detect Supported MIME Type
        // Prioritize VP9 for better high-bitrate handling in WebM
        const mimeTypes = [
            'video/webm;codecs=vp9,opus',
            'video/mp4',
            'video/webm;codecs=vp8,opus',
            'video/webm'
        ];
        const selectedMimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type));
        
        if (!selectedMimeType) {
            throw new Error("This browser does not support video recording.");
        }

        // 2. Setup Streams
        // Capture at 60 FPS for smoother motion and to generate more data (larger file)
        const stream = canvas.captureStream(60); 
        
        // Robust Audio Capture
        try {
            // @ts-ignore
            const streamCreator = video.captureStream || video.mozCaptureStream;
            if (streamCreator) {
                const videoStream = streamCreator.call(video);
                const audioTracks = videoStream.getAudioTracks();
                if (audioTracks.length > 0) {
                    stream.addTrack(audioTracks[0]);
                } else {
                    console.warn("No audio tracks found in video stream");
                }
            }
        } catch (e) {
            console.warn("Audio capture failed, proceeding with video only", e);
        }

        const mediaRecorder = new MediaRecorder(stream, { 
            mimeType: selectedMimeType,
            // Set extremely high bitrate (100 Mbps) to ensure file size > 100MB 
            // and maximize visual quality.
            videoBitsPerSecond: 100_000_000 
        });
        
        const chunks: Blob[] = [];

        mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        const recordingPromise = new Promise<void>((resolve, reject) => {
            mediaRecorder.onstop = () => {
                try {
                    const blob = new Blob(chunks, { type: selectedMimeType });
                    if (blob.size === 0) {
                        reject(new Error("Recording failed: Output file is empty."));
                        return;
                    }
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    const ext = selectedMimeType.includes('mp4') ? 'mp4' : 'webm';
                    a.download = `autosub_hq_${Date.now()}.${ext}`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    resolve();
                } catch (err) {
                    reject(err);
                }
            };
            mediaRecorder.onerror = (e) => reject(e);
        });

        mediaRecorder.start();

        // Setup Canvas Dimensions
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        // Calculate Scale Factor for Font Size
        const referenceWidth = 360; 
        const scaleFactor = canvas.width / referenceWidth;
        const renderFontSize = fontSize * scaleFactor;

        // Render Loop
        const drawFrame = () => {
            if (!isRenderingRef.current) return;

            // Draw Video Frame - Ensures whole video frame is included
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            // Draw Subtitles
            const currentT = video.currentTime;
            
            // Optimization: Find segment
            const activeSeg = subtitles.find(s => currentT >= s.startTime && currentT <= s.endTime);

            if (activeSeg) {
                // Font Settings
                ctx.font = `900 ${renderFontSize}px Inter, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                
                // Match the 20% bottom padding from CSS
                const y = canvas.height * 0.8; 

                // Styling - Match CSS WebkitTextStroke
                const strokeWidth = Math.max(2, renderFontSize * 0.08);
                ctx.lineJoin = 'round';
                ctx.lineWidth = strokeWidth * 2; 
                ctx.strokeStyle = 'black';
                
                const spaceWidth = renderFontSize * 0.3; 

                // Get words and precise highlighting
                const words = activeSeg.words ? activeSeg.words.map(w => w.text) : activeSeg.text.split(' ');
                
                let highlightedIndex = -1;
                if (activeSeg.words) {
                     // Precise timing
                     highlightedIndex = activeSeg.words.filter(w => currentT >= w.start).length - 1;
                } else {
                    // Linear fallback
                    const duration = activeSeg.endTime - activeSeg.startTime;
                    const progress = Math.max(0, Math.min(1, (currentT - activeSeg.startTime) / duration));
                    highlightedIndex = Math.floor(progress * words.length);
                }

                // Calculate total width first for centering
                let totalWidth = 0;
                const wordMetrics = words.map(w => {
                    const m = ctx.measureText(w);
                    totalWidth += m.width;
                    return m.width;
                });
                totalWidth += (words.length - 1) * spaceWidth;
                
                let startX = (canvas.width - totalWidth) / 2;
                
                // Scale text if it exceeds canvas width (with padding)
                const maxWidth = canvas.width * 0.9;
                let scale = 1;
                if (totalWidth > maxWidth) {
                    scale = maxWidth / totalWidth;
                }

                ctx.save();
                
                // Apply scaling if needed centered at (canvas.width/2, y)
                if (scale < 1) {
                    ctx.translate(canvas.width / 2, y);
                    ctx.scale(scale, scale);
                    ctx.translate(-canvas.width / 2, -y);
                }

                let currentDrawX = startX;

                words.forEach((word, index) => {
                    // Highlight color
                    ctx.fillStyle = index <= highlightedIndex ? '#EAB308' : 'white';
                    
                    // Draw Stroke first
                    ctx.strokeText(word, currentDrawX + wordMetrics[index]/2, y);
                    // Draw Fill
                    ctx.fillText(word, currentDrawX + wordMetrics[index]/2, y);
                    
                    currentDrawX += wordMetrics[index] + spaceWidth;
                });

                ctx.restore();
            }

            if (!video.ended && isRenderingRef.current) {
                requestAnimationFrame(drawFrame);
            }
        };

        const onEnded = () => {
            if (mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
            }
            isRenderingRef.current = false;
        };
        video.addEventListener('ended', onEnded, { once: true });

        // Start playback
        await video.play();
        drawFrame();

        // Wait for MediaRecorder to finish processing
        await recordingPromise;

    } catch (error) {
        console.error("Export failed", error);
        setErrorMessage("Export failed: " + (error as Error).message);
        setStatus(ProcessingStatus.ERROR);
    } finally {
        isRenderingRef.current = false;
        if (status !== ProcessingStatus.ERROR) {
            setStatus(ProcessingStatus.READY);
        }
        
        // Restore video state
        try {
            video.pause();
            video.currentTime = originalTime;
            video.muted = originalMuted;
            video.volume = originalVolume;
            
            // Stop tracks to release resources
            canvas.captureStream().getTracks().forEach(t => t.stop());
            
            if (wasPlaying) {
                 setTimeout(() => video.play().catch(() => {}), 100);
            } else {
                setIsPlaying(false);
            }
        } catch(e) { console.warn("Error restoring video state", e)}
    }
  }, [subtitles, fontSize, status]);

  return (
    <div className="min-h-screen bg-brand-dark text-white flex flex-col md:flex-row h-screen overflow-hidden">
      
      {/* Left Sidebar / Controls */}
      <div className="w-full md:w-1/3 lg:w-1/4 bg-brand-surface p-4 flex flex-col gap-4 border-r border-zinc-800 z-10 overflow-hidden">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent">
            AutoSub 9:16
          </h1>
          <p className="text-zinc-500 text-xs mt-1">Free Browser-Based AI Captions</p>
        </div>

        {/* Global Settings (Visible when Ready) */}
        {status === ProcessingStatus.READY && (
            <div className="bg-zinc-900 p-3 rounded-lg border border-zinc-800">
                <label className="text-xs text-zinc-400 font-bold mb-2 block">
                    Font Size ({fontSize}px)
                </label>
                <input 
                    type="range" 
                    min="16" 
                    max="60" 
                    value={fontSize} 
                    onChange={(e) => setFontSize(parseInt(e.target.value))}
                    className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-brand-accent"
                />
            </div>
        )}

        {status === ProcessingStatus.IDLE || (status === ProcessingStatus.ERROR && !videoSrc) ? (
              <div className="flex-1 flex flex-col justify-center overflow-y-auto">
                <VideoUploader onFileSelect={handleFileSelect} />
                {status === ProcessingStatus.ERROR && errorMessage && (
                    <div className="mt-4 p-4 bg-red-900/20 border border-red-800 text-red-200 rounded-lg text-sm">
                        <i className="fa-solid fa-triangle-exclamation mr-2"></i>
                        {errorMessage}
                    </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col gap-4 overflow-hidden">
                {/* Status Card */}
                {status !== ProcessingStatus.READY && (
                    <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800 shrink-0">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-zinc-400">Status</span>
                            <span className={`text-xs px-2 py-1 rounded-full font-bold
                            ${status === ProcessingStatus.RENDERING ? 'bg-purple-900 text-purple-300' :
                              status === ProcessingStatus.ERROR ? 'bg-red-900 text-red-300' :
                                'bg-blue-900 text-blue-300'}`}>
                                {status}
                            </span>
                        </div>
                        <div className="text-xs text-zinc-500 animate-pulse">
                            {status === ProcessingStatus.RENDERING ? "Rendering video... Please wait." : loadingMessage}
                        </div>
                    </div>
                )}

                {/* Subtitle List Editor */}
                {subtitles.length > 0 && status === ProcessingStatus.READY && (
                    <div className="flex-1 overflow-y-auto bg-zinc-900/50 rounded-xl border border-zinc-800 p-2 scrollbar-thin">
                        {subtitles.map((sub, idx) => (
                            <div key={idx} 
                                className={`p-2 rounded-lg mb-2 text-sm transition-all border-l-2 group
                                ${currentTime >= sub.startTime && currentTime <= sub.endTime 
                                    ? 'bg-zinc-800 border-brand-accent shadow-md' 
                                    : 'border-transparent hover:bg-zinc-800/30'}`}>
                                
                                {/* Time Controls */}
                                <div className="flex justify-between text-xs text-zinc-500 mb-1 gap-2">
                                    <input 
                                        type="number" 
                                        step="0.1"
                                        className="bg-transparent w-16 focus:text-brand-accent focus:outline-none"
                                        value={sub.startTime.toFixed(2)}
                                        onChange={(e) => handleSubtitleChange(idx, 'startTime', parseFloat(e.target.value))}
                                    />
                                    <span className="opacity-50">→</span>
                                    <input 
                                        type="number" 
                                        step="0.1"
                                        className="bg-transparent w-16 text-right focus:text-brand-accent focus:outline-none"
                                        value={sub.endTime.toFixed(2)}
                                        onChange={(e) => handleSubtitleChange(idx, 'endTime', parseFloat(e.target.value))}
                                    />
                                </div>

                                {/* Text Editor */}
                                <textarea 
                                    className="w-full bg-transparent resize-none focus:outline-none text-zinc-300 focus:text-white font-medium"
                                    rows={2}
                                    value={sub.text}
                                    onChange={(e) => handleSubtitleChange(idx, 'text', e.target.value)}
                                    onClick={() => {
                                        if(videoRef.current) {
                                            videoRef.current.currentTime = sub.startTime;
                                            setCurrentTime(sub.startTime);
                                        }
                                    }}
                                />
                            </div>
                        ))}
                    </div>
                )}
              </div>
            )}

            {/* Action Buttons */}
            {status === ProcessingStatus.READY && (
                <button 
                    onClick={handleExport}
                    className="w-full py-4 bg-brand-accent hover:bg-yellow-400 text-black font-bold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-yellow-500/20 shrink-0"
                >
                    <i className="fa-solid fa-download"></i>
                    Download Video
                </button>
            )}
            
            {status === ProcessingStatus.ERROR && videoSrc && (
                 <button 
                    onClick={() => {
                        setVideoSrc(null);
                        setSubtitles([]);
                        setStatus(ProcessingStatus.IDLE);
                    }}
                    className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-white font-bold rounded-xl transition-all"
                >
                    Start Over
                </button>
            )}
      </div>

      {/* Main Preview Area */}
      <div className="flex-1 bg-black flex flex-col items-center justify-center p-4 relative overflow-hidden">
        
        {/* Background Blur Effect */}
        {videoSrc && (
            <div className="absolute inset-0 opacity-20 pointer-events-none blur-3xl scale-110">
                <video src={videoSrc} className="w-full h-full object-cover" muted />
            </div>
        )}

        {/* The 9:16 Container */}
        <div className="relative aspect-[9/16] h-full max-h-[90vh] bg-black rounded-lg shadow-2xl overflow-hidden ring-1 ring-zinc-800 group">
            
            {videoSrc && (
                <>
                    <video 
                        ref={videoRef}
                        src={videoSrc}
                        className="w-full h-full object-cover"
                        onTimeUpdate={handleTimeUpdate}
                        onLoadedMetadata={handleLoadedMetadata}
                        onClick={status !== ProcessingStatus.RENDERING ? togglePlay : undefined}
                        onEnded={() => setIsPlaying(false)}
                        playsInline
                        crossOrigin="anonymous" 
                    />
                    
                    {/* Overlay Component */}
                    {status !== ProcessingStatus.RENDERING && (
                         <SubtitleOverlay currentTime={currentTime} subtitles={subtitles} fontSizePx={fontSize} />
                    )}

                    {/* Canvas for rendering - Hidden but active during export */}
                    <canvas ref={canvasRef} className="hidden pointer-events-none" />

                    {/* Controls Overlay */}
                    <div className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity duration-300 
                        ${isPlaying || status === ProcessingStatus.RENDERING ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}
                        ${status === ProcessingStatus.RENDERING ? 'pointer-events-none' : ''}
                    `}>
                        {status !== ProcessingStatus.RENDERING && (
                            <button 
                                onClick={togglePlay}
                                className="w-20 h-20 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center text-white hover:bg-white/20 transition-all transform hover:scale-110"
                            >
                                <i className={`fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'} text-3xl ml-1`}></i>
                            </button>
                        )}
                        {status === ProcessingStatus.RENDERING && (
                            <div className="flex flex-col items-center">
                                <div className="w-12 h-12 border-4 border-brand-accent border-t-transparent rounded-full animate-spin mb-4"></div>
                                <span className="font-bold">Rendering...</span>
                                <span className="text-xs text-zinc-400 mt-2">Do not close this tab</span>
                            </div>
                        )}
                    </div>

                    {/* Progress Bar */}
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-zinc-800">
                        <div 
                            className="h-full bg-brand-accent relative"
                            style={{ width: `${(currentTime / duration) * 100}%` }}
                        >
                             <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-brand-accent rounded-full shadow-lg scale-0 group-hover:scale-100 transition-transform"></div>
                        </div>
                    </div>
                </>
            )}

            {!videoSrc && (
                 <div className="flex flex-col items-center justify-center h-full text-zinc-600">
                    <i className="fa-solid fa-mobile-screen text-4xl mb-4 opacity-50"></i>
                    <p>9:16 Preview</p>
                 </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default App;