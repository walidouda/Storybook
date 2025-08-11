import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

/**
 * Generate an image for a story page.  The request body should include
 * `{ prompt: string }`.  The response contains a data URL for a PNG of
 * size 1024x1024.  We append a short suffix to discourage the model
 * from including text or watermarks.
 */
export async function POST(req: NextRequest) {
  const { prompt } = await req.json();
  if (!prompt) {
    return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
  }
  try {
    const res = await client.images.generate({
      model: "gpt-image-1",
      prompt:
        `${prompt}. No text, no watermarks. Rich lighting, coherent characters across pages.`,
      size: "1024x1024",
    });
    const b64 = res.data[0].b64_json;
    const url = `data:image/png;base64,${b64}`;
    return NextResponse.json({ url });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to generate image" },
      { status: 500 },
    );
  }
}
