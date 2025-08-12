import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

/**
 * Endpoint to generate a storybook structure from a user prompt.
 * It returns a JSON object with a title and exactly 10 pages,
 * each containing `text` (80–140 words) and an `imagePrompt`.
 */
export async function POST(req: NextRequest) {
  const { prompt } = await req.json();
  if (!prompt) {
    return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
  }

  // System prompt instructs the model to output a strict JSON structure.
  const systemPrompt =
    "You are a creative story author. When given a user prompt, you must output a JSON object with the following structure:\n" +
    "{ \"title\": string, \"pages\": [ { \"text\": string, \"imagePrompt\": string }, ... ] }\n" +
    "The pages array must contain exactly 10 objects. Each page's `text` should be 80–140 words and self-contained with gentle cliffhangers.\n" +
    "Each `imagePrompt` should vividly describe the scene on the page without including any text. Do not include any additional properties. Do not wrap the JSON in markdown or code fences.";

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `User prompt: \"${prompt}\". Generate the story.` },
  ];

  try {
    // Use Chat Completions with JSON mode enabled.
    const completion = await client.chat.completions.create({
      model: "gpt-4o",
      messages,
      temperature: 0.7,
      response_format: { type: "json_object" },
    });

    const content = completion.choices?.[0]?.message?.content || "";
    // Parse the JSON returned by the model.
    const json = JSON.parse(content);
    return NextResponse.json(json);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to generate story" },
      { status: 500 },
    );
  }
}
