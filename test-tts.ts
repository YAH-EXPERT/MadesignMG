import { GoogleGenAI } from "@google/genai";
import dotenv from 'dotenv';
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function run() {
  try {
    const res = await ai.models.generateContent({
      model: "gemini-3.1-flash-tts-preview",
      contents: [{parts: [{text: "Bonjour"}]}],
      config: {
        responseModalities: ["AUDIO"],
      }
    });
    console.log("Audio length:", res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data?.length);
  } catch(e) {
    console.error("ERROR 2.5 flash preview:", e.message);
  }
}
run();
