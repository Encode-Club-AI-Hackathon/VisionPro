import { generateText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { NavContextSnapshot } from './navContext';

const flock = createOpenAICompatible({
  name: 'flock',
  baseURL: 'https://api.flock.io/v1',
  headers: {
    'x-litellm-api-key': process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '',
  },
});

const model = flock('gemini-3-flash-preview');

export async function answerNavigationQuestion(
  question: string,
  ctx: NavContextSnapshot
): Promise<string> {
  const contentParts: any[] = [];

  // System instructions + question
  let systemText = `You are a navigation assistant for a blind pedestrian. Answer in 1–3 short sentences suitable for text-to-speech. Be direct and specific.`;

  if (ctx.route) {
    const steps = ctx.route.steps.map((s, i) => `${i + 1}. ${s.instruction}`).join('\n');
    const dist =
      ctx.remainingDistance != null
        ? ctx.remainingDistance < 1000
          ? `${Math.round(ctx.remainingDistance)} meters`
          : `${(ctx.remainingDistance / 1000).toFixed(1)} km`
        : 'unknown';
    systemText += `\n\nCurrent route to ${ctx.destinationName ?? 'destination'} (${dist} remaining):\n${steps}`;
  }

  if (ctx.gpsPoints.length > 0) {
    const pts = ctx.gpsPoints
      .map((p) => `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`)
      .join(' → ');
    systemText += `\n\nRecent GPS positions (oldest→newest): ${pts}`;
  }

  contentParts.push({ type: 'text', text: systemText });
  contentParts.push({ type: 'text', text: `Question: "${question}"` });

  // Only attach the camera image for questions about the visual environment.
  // Navigation/direction questions are answered from route + GPS alone — attaching
  // an image (potentially indoors or unrelated) causes the model to return empty.
  const lastImage = ctx.images[ctx.images.length - 1];
  if (lastImage && isVisualQuestion(question)) {
    contentParts.push({ type: 'image', image: `data:image/jpeg;base64,${lastImage}` });
  }

  const { text: answer } = await generateText({
    model,
    messages: [{ role: 'user', content: contentParts }],
    temperature: 0.3,
    maxOutputTokens: 256,
  });

  const trimmed = answer.trim();
  if (!trimmed) return 'I was unable to form a response. Please try again.';
  return trimmed;
}

function isVisualQuestion(q: string): boolean {
  return /\b(see|seeing|look|visible|front|behind|around|describe|what.s there|what is there|color|sign|building|door|road|path|scene|surroundings|environment|obstacle|near me|beside|next to)\b/i.test(q);
}
