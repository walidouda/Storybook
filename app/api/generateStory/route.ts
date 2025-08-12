import { NextRequest, NextResponse } from "next/server";

// We avoid relying on the OpenAI SDK for this endpoint to improve compatibility.
// Instead, we'll call the OpenAI REST API directly via fetch.  The API key
// must be provided in the Authorization header.  This approach works
// regardless of the specific SDK version installed in the environment.

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

  // Compose a system prompt that instructs the model to produce a JSON object
  const systemPrompt =
    "You are a creative story author. When given a user prompt, you must output a JSON object with the following structure:\n" +
    "{ \"title\": string, \"pages\": [ { \"text\": string, \"imagePrompt\": string }, ... ] }\n" +
    "The pages array must contain exactly 10 objects. Each page's `text` should be 80–140 words and self‑contained with gentle cliffhangers.\n" +
    "Each `imagePrompt` should vividly describe the scene on the page without including any text. Do not include any additional properties. Do not wrap the JSON in markdown or code fences.";

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `User prompt: "${prompt}". Generate the story.` },
  ];

  try {
    // Construct the payload for the OpenAI chat completions REST API.  We
    // enable JSON mode via response_format.
    const payload = {
      // Use the mini variant by default; switch to "gpt-4o" if you have access.
      model: "gpt-4o-mini",
      messages,
      temperature: 0.7,
      response_format: { type: "json_object" },
    };

    // Helper to call the API with or without JSON mode.
    const callApi = async (withResponseFormat: boolean) => {
      const body: any = { ...payload };
      if (!withResponseFormat) {
        delete body.response_format;
      }
      const apiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY || ""}`,
        },
        body: JSON.stringify(body),
      });
      const text = await apiResponse.text();
      if (!apiResponse.ok) {
      throw new Error(
          `OpenAI API error ${apiResponse.status}: ${text || apiResponse.statusText}`,
        );
      }
      return JSON.parse(text);
    };

    let data;
    try {
      // First attempt: use JSON mode
      data = await callApi(true);
    } catch (error: any) {
      // If the error mentions 'response_format', retry without it
      if (String(error?.message || "").includes("response_format")) {
        data = await callApi(false);
      } else {
        throw error;
      }
    }

    const content = data.choices?.[0]?.message?.content || "";
    let json;
    try {
      json = JSON.parse(content);
    } catch {
      throw new Error("Model did not return valid JSON");
    }
    return NextResponse.json(json);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to generate story" },
      { status: 500 },
    );
  }
}
