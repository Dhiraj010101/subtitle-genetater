import { GoogleGenAI, Type } from "@google/genai";
import { SubtitleSegment } from "../types";
import { fileToBase64 } from "../utils/fileUtils";

export const generateSubtitles = async (videoFile: File): Promise<SubtitleSegment[]> => {
  try {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      throw new Error("API Key is missing. Please check your configuration.");
    }

    // Limit file size check (up to 200MB as requested)
    if (videoFile.size > 200 * 1024 * 1024) {
        throw new Error("Video file is too large. Please use a video under 200MB.");
    }

    const base64Data = await fileToBase64(videoFile);
    const ai = new GoogleGenAI({ apiKey });

    // Use a lightweight model optimized for speed and multimodal tasks
    const modelId = "gemini-2.5-flash"; 

    const prompt = `
      Listen carefully to the audio of this video. 
      Generate subtitles split into short segments of exactly 4-5 words each to match a fast-paced vertical video style.
      Ensure the timestamps are extremely accurate to the voice.
      Return the result as a JSON array of objects with startTime (seconds), endTime (seconds), and text.
      Do not include any other text.
    `;

    const response = await ai.models.generateContent({
      model: modelId,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: videoFile.type,
              data: base64Data
            }
          },
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              startTime: { type: Type.NUMBER, description: "Start time in seconds" },
              endTime: { type: Type.NUMBER, description: "End time in seconds" },
              text: { type: Type.STRING, description: "Subtitle text content (4-5 words)" }
            },
            required: ["startTime", "endTime", "text"]
          }
        }
      }
    });

    const jsonText = response.text;
    if (!jsonText) throw new Error("No response from AI");

    const parsed = JSON.parse(jsonText) as SubtitleSegment[];
    return parsed.sort((a, b) => a.startTime - b.startTime);

  } catch (error) {
    console.error("Gemini Transcription Error:", error);
    throw error;
  }
};