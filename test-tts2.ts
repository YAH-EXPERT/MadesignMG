import { GoogleGenAI } from "@google/genai";
import dotenv from 'dotenv';
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function run() {
  try {
    const res = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{parts: [{text: "Bonjour"}]}],
      config: {
        responseModalities: ["AUDIO"],
      }
    });
    console.log("Audio lengths:", res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data?.length);
  } catch(e: any) {
    console.error("ERROR:", e.message);
  }
}
run();
