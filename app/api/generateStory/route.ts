import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

/**
 * Endpoint to generate a storybook structure from a user prompt.  The
 * response contains a title and exactly 10 pages with text and image
 * prompts.  Structured JSON output is enforced to simplify client‑side
 * parsing.
 */
export async function POST(req: NextRequest) {
  const { prompt } = await req.json();
  if (!prompt) {
    return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
  }
  // JSON schema describing our expected story structure
  const schema = {
    type: "object",
    properties: {
      title: { type: "string" },
      pages: {
        type: "array",
        minItems: 10,
        maxItems: 10,
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            imagePrompt: { type: "string" },
          },
          required: ["text", "imagePrompt"],
          additionalProperties: false,
        },
      },
    },
    required: ["title", "pages"],
    additionalProperties: false,
  };
  // System and user prompts guide the model to produce concise, vivid
  // storytelling appropriate for children and young adults.  The user
  // prompt is quoted to prevent prompt injection.
  const sys =
    `You are a children and YA story author. Produce a concise 10‑page story.\n` +
    `Each page should be 80–140 words, self‑contained, with gentle cliffhangers.\n` +
    `For images, write vivid, style‑agnostic prompts (no text in image).`;
  const userMsg = `User prompt: "${prompt}". Create title + exactly 10 pages.`;

  try {
    const res = await client.responses.create({
  model: "gpt-4o-mini",
  input: [
    { role: "system", content: sys },
    { role: "user", content: userMsg },
  ],
  // Specify the structured output format.
  text: {
    format: {
      type: "json_schema",
      name: "Storybook",
      strict: true,
      schema: schema,
    },
  },
});

// Parse the JSON from the aggregated text field.
const json = JSON.parse(res.output_text || "{}");
return NextResponse.json(json);
