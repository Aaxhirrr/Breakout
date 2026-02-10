import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

const apiKey = process.env.GEMINI_API_KEY;

export async function POST(req: Request) {
    if (!apiKey) {
        return NextResponse.json(
            { error: "GEMINI_API_KEY is not set in environment variables." },
            { status: 500 }
        );
    }

    try {
        const { context, userPrompt, characterName } = await req.json();

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const systemPrompt = `
      You are currently acting as the character "${characterName}" from a video.
      The video has been paused, and the viewer has "stepped in" to ask you a question.
      
      CONTEXT (The script/transcript up to this point):
      "${context}"
      
      INSTRUCTIONS:
      1. Stay completely in character. Adopt their tone, vocabulary, and emotional state based on the context.
      2. You are aware that the video is paused, but you treat the viewer as an intruder or a sudden presence in your world (breaking the fourth wall).
      3. Answer the viewer's question directly, but through the lens of your current situation in the video.
      4. Keep responses concise (under 3 sentences) to maintain the flow.
      
      VIEWER QUESTION: "${userPrompt}"
    `;

        const result = await model.generateContent(systemPrompt);
        const response = await result.response;
        const text = response.text();

        return NextResponse.json({ reply: text });
    } catch (error) {
        console.error("Gemini API Error:", error);
        return NextResponse.json(
            { error: "Failed to process interrogation." },
            { status: 500 }
        );
    }
}
