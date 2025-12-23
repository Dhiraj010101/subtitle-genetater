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
  
  const [fontSize, setFontSize] = useState<number>(30); 

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isRenderingRef = useRef(false);

  const handleFileSelect = async (file: File) => {
    try {
      const url = URL.createObjectURL(file);
      setVideoSrc(url);
      setErrorMessage(null);
      setSubtitles([]);
      
      setStatus(ProcessingStatus.UPLOADING);
      setLoadingMessage("Runnadd AI: Preparing video...");
      await new Promise(r => setTimeout(r, 500));
      
      setStatus(ProcessingStatus.ANALYZING);
      const generatedSubs = await generateSubtitles(file, (msg) => setLoadingMessage(`Runnadd AI: ${msg}`));
      setSubtitles(generatedSubs);
      setStatus(ProcessingStatus.READY);

    } catch (e: any) {
      console.error(e);
      setStatus(ProcessingStatus.ERROR);
      setErrorMessage(e.message || "Runnadd AI encountered an error during analysis.");
    }
  };

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

  const handleSubtitleChange = (index: number, field: keyof SubtitleSegment, value: string | number) => {
    const newSubtitles = [...subtitles];
    newSubtitles[index] = { ...newSubtitles[index], [field]: value };
    setSubtitles(newSubtitles);
  };

  useEffect(() => {
    return () => {
      if (videoSrc) URL.revokeObjectURL(videoSrc);
    };
  }, [videoSrc]);

  const handleExport = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || subtitles.length === 0) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false }); // Disable alpha for better performance
    
    if (!ctx) return;

    setStatus(ProcessingStatus.RENDERING);
    isRenderingRef.current = true;
    setLoadingMessage("Runnadd Engine: Rendering Ultra-HQ Frame Buffer...");

    const originalTime = video.currentTime;
    const wasPlaying = !video.paused;
    const originalVolume = video.volume;
    const originalMuted = video.muted;

    try {
        video.pause();
        video.currentTime = 0;
        video.muted = false; 
        video.volume = 1.0;

        await document.fonts.ready;

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

        // Preferred Codecs for high-fidelity 9:16 content
        const mimeTypes = [
            'video/webm;codecs=vp9,opus',
            'video/mp4;codecs=avc1',
            'video/webm;codecs=vp8,opus'
        ];
        const selectedMimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || 'video/webm';
        
        // Capture at 60 FPS for smoother output and larger data footprint
        const stream = canvas.captureStream(60); 
        
        try {
            // @ts-ignore
            const streamCreator = video.captureStream || video.mozCaptureStream;
            if (streamCreator) {
                const videoStream = streamCreator.call(video);
                const audioTracks = videoStream.getAudioTracks();
                if (audioTracks.length > 0) {
                    stream.addTrack(audioTracks[0]);
                }
            }
        } catch (e) {
            console.warn("Runnadd AI: Audio bridge failed, falling back to silent video", e);
        }

        const mediaRecorder = new MediaRecorder(stream, { 
            mimeType: selectedMimeType,
            // 150 Mbps ensures file size exceeds 100MB for typical social clips
            videoBitsPerSecond: 150_000_000 
        });
        
        const chunks: Blob[] = [];
        mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        const recordingPromise = new Promise<void>((resolve, reject) => {
            mediaRecorder.onstop = () => {
                try {
                    const blob = new Blob(chunks, { type: selectedMimeType });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    const ext = selectedMimeType.includes('mp4') ? 'mp4' : 'webm';
                    a.download = `runnadd_master_export_${Date.now()}.${ext}`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    resolve();
                } catch (err) {
                    reject(err);
                }
            };
            mediaRecorder.onerror = (e) => reject(new Error("MediaRecorder Error"));
        });

        mediaRecorder.start();

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const referenceWidth = 360; 
        const scaleFactor = canvas.width / referenceWidth;
        const renderFontSize = fontSize * scaleFactor;

        // Frame-locked render loop to prevent skips
        const renderFrame = () => {
            if (!isRenderingRef.current) return;

            // 1. Draw Master Video Frame
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            // 2. Draw Subtitles using Runnadd Logic
            const currentT = video.currentTime;
            const activeSeg = subtitles.find(s => currentT >= s.startTime && currentT <= s.endTime);

            if (activeSeg) {
                ctx.font = `900 ${renderFontSize}px Inter, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                
                const y = canvas.height * 0.8; 
                const strokeWidth = Math.max(2, renderFontSize * 0.08);
                ctx.lineJoin = 'round';
                ctx.lineWidth = strokeWidth * 2.5; 
                ctx.strokeStyle = 'black';
                
                const spaceWidth = renderFontSize * 0.3; 
                const words = activeSeg.words ? activeSeg.words.map(w => w.text) : activeSeg.text.split(' ');
                
                let highlightedIndex = -1;
                if (activeSeg.words) {
                     highlightedIndex = activeSeg.words.filter(w => currentT >= w.start).length - 1;
                } else {
                    const progress = Math.max(0, Math.min(1, (currentT - activeSeg.startTime) / (activeSeg.endTime - activeSeg.startTime)));
                    highlightedIndex = Math.floor(progress * words.length);
                }

                let totalWidth = 0;
                const wordMetrics = words.map(w => {
                    const m = ctx.measureText(w);
                    totalWidth += m.width;
                    return m.width;
                });
                totalWidth += (words.length - 1) * spaceWidth;
                
                let startX = (canvas.width - totalWidth) / 2;
                const maxWidth = canvas.width * 0.95;
                let scale = totalWidth > maxWidth ? maxWidth / totalWidth : 1;

                ctx.save();
                if (scale < 1) {
                    ctx.translate(canvas.width / 2, y);
                    ctx.scale(scale, scale);
                    ctx.translate(-canvas.width / 2, -y);
                }

                let currentDrawX = startX;
                words.forEach((word, index) => {
                    ctx.fillStyle = index <= highlightedIndex ? '#EAB308' : 'white';
                    ctx.strokeText(word, currentDrawX + wordMetrics[index]/2, y);
                    ctx.fillText(word, currentDrawX + wordMetrics[index]/2, y);
                    currentDrawX += wordMetrics[index] + spaceWidth;
                });
                ctx.restore();
            }

            if (!video.ended && isRenderingRef.current) {
                requestAnimationFrame(renderFrame);
            } else if (video.ended) {
                if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
                isRenderingRef.current = false;
            }
        };

        await video.play();
        renderFrame();

        await recordingPromise;

    } catch (error) {
        console.error("Export failed", error);
        setErrorMessage("Runnadd Export Error: " + (error as Error).message);
        setStatus(ProcessingStatus.ERROR);
    } finally {
        isRenderingRef.current = false;
        if (status !== ProcessingStatus.ERROR) setStatus(ProcessingStatus.READY);
        
        try {
            video.pause();
            video.currentTime = originalTime;
            video.muted = originalMuted;
            video.volume = originalVolume;
            if (wasPlaying) setTimeout(() => video.play().catch(() => {}), 100);
            else setIsPlaying(false);
        } catch(e) {}
    }
  }, [subtitles, fontSize, status]);

  return (
    <div className="min-h-screen bg-brand-dark text-white flex flex-col md:flex-row h-screen overflow-hidden">
      
      {/* Sidebar */}
      <div className="w-full md:w-1/3 lg:w-1/4 bg-brand-surface p-4 flex flex-col gap-4 border-r border-zinc-800 z-10 overflow-hidden shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-accent rounded-lg flex items-center justify-center text-black">
            <i className="fa-solid fa-bolt-lightning text-xl"></i>
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tighter uppercase italic text-brand-accent">
              Runnadd AI
            </h1>
            <p className="text-zinc-500 text-[10px] uppercase font-bold tracking-widest">Master Video Engine</p>
          </div>
        </div>

        {status === ProcessingStatus.READY && (
            <div className="bg-zinc-900/50 p-4 rounded-xl border border-zinc-800 space-y-3">
                <div className="flex justify-between items-center">
                    <label className="text-[10px] text-zinc-400 font-black uppercase tracking-widest">Font Size</label>
                    <span className="text-xs font-mono text-brand-accent">{fontSize}px</span>
                </div>
                <input 
                    type="range" 
                    min="16" 
                    max="60" 
                    value={fontSize} 
                    onChange={(e) => setFontSize(parseInt(e.target.value))}
                    className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-brand-accent"
                />
            </div>
        )}

        {status === ProcessingStatus.IDLE || (status === ProcessingStatus.ERROR && !videoSrc) ? (
              <div className="flex-1 flex flex-col justify-center">
                <VideoUploader onFileSelect={handleFileSelect} />
                {status === ProcessingStatus.ERROR && errorMessage && (
                    <div className="mt-4 p-4 bg-red-900/20 border border-red-800 text-red-200 rounded-xl text-xs font-medium">
                        <i className="fa-solid fa-circle-exclamation mr-2"></i>
                        {errorMessage}
                    </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col gap-4 overflow-hidden">
                {status !== ProcessingStatus.READY && (
                    <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800 shrink-0">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-[10px] font-black uppercase text-zinc-500 tracking-widest">System Status</span>
                            <div className="flex items-center gap-1.5">
                                <div className="w-2 h-2 rounded-full bg-brand-accent animate-pulse"></div>
                                <span className="text-[10px] font-black uppercase text-brand-accent tracking-widest">Processing</span>
                            </div>
                        </div>
                        <div className="text-sm font-medium text-zinc-300 leading-relaxed">
                            {loadingMessage}
                        </div>
                    </div>
                )}

                {subtitles.length > 0 && status === ProcessingStatus.READY && (
                    <div className="flex-1 overflow-y-auto bg-zinc-900/30 rounded-xl border border-zinc-800 p-2 scrollbar-thin">
                        {subtitles.map((sub, idx) => (
                            <div key={idx} 
                                className={`p-3 rounded-lg mb-2 text-sm transition-all border-l-2 group
                                ${currentTime >= sub.startTime && currentTime <= sub.endTime 
                                    ? 'bg-zinc-800/80 border-brand-accent shadow-lg scale-[1.02]' 
                                    : 'border-transparent hover:bg-zinc-800/30'}`}>
                                
                                <div className="flex justify-between text-[10px] font-mono text-zinc-500 mb-2">
                                    <span>{sub.startTime.toFixed(2)}s</span>
                                    <span className="text-zinc-700">|</span>
                                    <span>{sub.endTime.toFixed(2)}s</span>
                                </div>

                                <textarea 
                                    className="w-full bg-transparent resize-none focus:outline-none text-zinc-300 focus:text-white font-bold leading-tight"
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

            {status === ProcessingStatus.READY && (
                <button 
                    onClick={handleExport}
                    className="w-full py-4 bg-brand-accent hover:bg-yellow-400 text-black font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-3 shadow-xl shadow-yellow-500/10 shrink-0"
                >
                    <i className="fa-solid fa-rocket"></i>
                    Export Master HQ
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
                    Clear & Start Over
                </button>
            )}
      </div>

      {/* Main Preview */}
      <div className="flex-1 bg-[#050505] flex flex-col items-center justify-center p-4 relative overflow-hidden">
        {videoSrc && (
            <div className="absolute inset-0 opacity-10 pointer-events-none blur-[100px] scale-150">
                <video src={videoSrc} className="w-full h-full object-cover" muted />
            </div>
        )}

        <div className="relative aspect-[9/16] h-full max-h-[90vh] bg-black rounded-3xl shadow-[0_0_100px_rgba(0,0,0,0.5)] overflow-hidden ring-1 ring-zinc-800/50 group">
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
                    
                    {status !== ProcessingStatus.RENDERING && (
                         <SubtitleOverlay currentTime={currentTime} subtitles={subtitles} fontSizePx={fontSize} />
                    )}

                    <canvas ref={canvasRef} className="hidden pointer-events-none" />

                    <div className={`absolute inset-0 bg-black/40 flex flex-col items-center justify-center transition-opacity duration-500 
                        ${isPlaying || status === ProcessingStatus.RENDERING ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}
                        ${status === ProcessingStatus.RENDERING ? 'pointer-events-none' : ''}
                    `}>
                        {status !== ProcessingStatus.RENDERING && (
                            <button 
                                onClick={togglePlay}
                                className="w-24 h-24 rounded-full bg-white/5 border border-white/10 backdrop-blur-xl flex items-center justify-center text-white hover:bg-white/10 transition-all transform hover:scale-110 shadow-2xl"
                            >
                                <i className={`fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'} text-4xl ml-1`}></i>
                            </button>
                        )}
                        {status === ProcessingStatus.RENDERING && (
                            <div className="flex flex-col items-center bg-black/80 p-8 rounded-3xl backdrop-blur-2xl border border-white/5">
                                <div className="w-16 h-16 border-4 border-brand-accent border-t-transparent rounded-full animate-spin mb-6"></div>
                                <span className="text-xl font-black italic tracking-tighter text-brand-accent mb-2">RUNNADD ENGINE ACTIVE</span>
                                <span className="text-[10px] text-zinc-500 font-bold tracking-[0.3em] uppercase">Lossless Frame Capture</span>
                            </div>
                        )}
                    </div>

                    <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-zinc-900">
                        <div 
                            className="h-full bg-brand-accent transition-all duration-300 relative shadow-[0_0_10px_#EAB308]"
                            style={{ width: `${(currentTime / duration) * 100}%` }}
                        >
                        </div>
                    </div>
                </>
            )}

            {!videoSrc && (
                 <div className="flex flex-col items-center justify-center h-full text-zinc-800">
                    <i className="fa-solid fa-film text-6xl mb-6 opacity-10"></i>
                    <p className="text-xs font-black uppercase tracking-[0.4em] opacity-20">No Media Loaded</p>
                 </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default App;