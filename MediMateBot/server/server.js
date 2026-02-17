import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" })); // audio payloads need extra room

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post("/chat", async (req, res) => {
  const { symptoms } = req.body;
  if (!symptoms) {
    return res.status(400).json({ error: "Symptoms are required" });
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `You are a medical triage bot. You MUST always reply in exactly this format, with each section present in a a very concise and structured manner:
    Severity: (one word: Low, Moderate, High)
    Immediate Need for Attention: (Yes/No)
    See a Doctor If: (max 2 short bullet points, each starting with "- ")
    Next Steps: (max 3 bullet points, each starting with "- ")
    Possible Conditions: (max 3 bullet points, each starting with "- ")
    Disclaimer: (one short sentence)
    Symptoms: "${symptoms}"`;

    const result = await model.generateContent(prompt);
    const reply = result.response.text();

    res.json({ reply });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to get response from Gemini" });
  }
});

// Transcribe audio recorded by the browser (MediaRecorder → base64 → Gemini)
// This bypasses Chrome's SpeechRecognition which requires Google's speech servers.
app.post("/transcribe", async (req, res) => {
  const { audio, mimeType } = req.body;
  if (!audio) return res.status(400).json({ error: "Audio data required" });

  // Gemini supports "audio/webm" but not the codec suffix Chrome appends.
  // Strip everything after the semicolon: "audio/webm;codecs=opus" → "audio/webm"
  const safeMimeType = (mimeType || "audio/webm").split(";")[0].trim();
  console.log("[transcribe] mimeType received:", mimeType, "→ using:", safeMimeType);
  console.log("[transcribe] audio base64 length:", audio.length);

  try {
    // Use same model as /chat — gemini-2.5-flash supports audio input in free tier
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: safeMimeType,
          data: audio,
        },
      },
      "Transcribe this audio recording exactly as spoken. Return only the transcribed text — no labels, formatting, or commentary.",
    ]);
    const transcript = result.response.text().trim();
    console.log("[transcribe] Gemini returned:", JSON.stringify(transcript));

    if (!transcript) {
      return res.status(422).json({ error: "Gemini returned an empty transcript. Audio may be too quiet or silent." });
    }

    res.json({ transcript });
  } catch (error) {
    console.error("[transcribe] Gemini error:", error.message || error);
    res.status(500).json({ error: error.message || "Transcription failed" });
  }
});

app.listen(8080, () => console.log("Bot API running on http://localhost:8080"));
