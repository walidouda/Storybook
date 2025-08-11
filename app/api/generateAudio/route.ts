import { NextRequest } from "next/server";
import OpenAI from "openai";

/**
 * Generate speech for a given text.  The request body should include
 * `{ text: string }`.  The response is an MP3 stream.  We use the
 * gpt‑4o‑mini‑tts model with a default voice (alloy) which supports
 * multiple languages.  To support Arabic narration, simply pass
 * Arabic text in the request body.
 */
export async function POST(req: NextRequest) {
  const { text } = await req.json();
  if (!text) {
    return new Response("Missing text", { status: 400 });
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });
  try {
    const audio = await client.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: text,
    });
    const buffer = Buffer.from(await audio.arrayBuffer());
    return new Response(buffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Disposition": "inline; filename=page.mp3",
      },
    });
  } catch (err: any) {
    return new Response(
      err.message || "Failed to generate audio",
      { status: 500 },
    );
  }
}
