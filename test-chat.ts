import { GoogleGenAI } from "@google/genai";
import dotenv from 'dotenv';
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function run() {
  try {
    const res = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{parts: [{text: "Bonjour"}]}],
    });
    console.log("Chat response:", res.text);
  } catch(e: any) {
    console.error("ERROR:", e.message);
  }
}
run();
