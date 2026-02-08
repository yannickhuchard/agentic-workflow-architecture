import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { streamText } from 'ai';

export const maxDuration = 30;

const google = createGoogleGenerativeAI({
    apiKey: process.env.GEMENI_API_KEY,
});

export async function POST(req: Request) {
    const { messages } = await req.json();

    const result = streamText({
        model: google('gemini-2.5-flash'),
        messages,
        system: "You are an AI assistant helping a user manage a Kanban board. You can answer questions about the tasks, suggest new tasks, or explain the workflow. Be concise and helpful.",
    });

    // @ts-ignore
    return result.toDataStreamResponse();
}
