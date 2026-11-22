import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { convertToModelMessages, streamText, type UIMessage } from 'ai';

export const maxDuration = 30;

const google = createGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY,
});

// A conversation is short text. Anything larger is refused before it reaches the model.
const MAX_MESSAGES = 50;
const MAX_BYTES = 64_000;

export async function POST(req: Request) {
    const text = await req.text();
    if (text.length > MAX_BYTES) return Response.json({ error: 'The conversation is too long' }, { status: 413 });
    let messages: UIMessage[];
    try {
        messages = (JSON.parse(text) as { messages: UIMessage[] }).messages;
    } catch {
        return Response.json({ error: 'The request is not JSON' }, { status: 400 });
    }
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
        return Response.json({ error: `Between 1 and ${MAX_MESSAGES} messages are expected` }, { status: 400 });
    }

    const result = streamText({
        model: google('gemini-2.5-flash'),
        messages: await convertToModelMessages(messages),
        system: "You are an AI assistant helping a user manage a Kanban board. You can answer questions about the tasks, suggest new tasks, or explain the workflow. Be concise and helpful.",
    });

    return result.toUIMessageStreamResponse();
}
