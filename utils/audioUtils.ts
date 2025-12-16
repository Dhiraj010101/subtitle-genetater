export const extractAudioData = async (file: File): Promise<Float32Array> => {
  // Create an AudioContext to decode the file
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
    sampleRate: 16000, // Whisper expects 16kHz
  });

  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  
  // Get raw PCM data from the first channel
  let audioData = audioBuffer.getChannelData(0);

  return audioData;
};