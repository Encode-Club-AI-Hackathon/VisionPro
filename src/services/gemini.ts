import { generateText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { HazardReport } from '../types';

const flock = createOpenAICompatible({
  name: 'flock',
  baseURL: 'https://api.flock.io/v1',
  headers: {
    'x-litellm-api-key': process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '',
  },
});

const model = flock('gemini-3-flash-preview');

const HAZARD_PROMPT = `You are a hazard detection assistant for a blind pedestrian. Describe anything in front of them that they need to know about to walk safely.

Report hazards at two severity levels:

CRITICAL — stop immediately:
- Moving vehicle, cyclist, or scooter crossing or approaching their path
- Open hole, drop, or missing paving
- Obstacle at head or chest height (sign, branch, scaffolding bar)

WARNING — slow down or steer around:
- Steps, kerb drop, or ramp ahead or to either side
- Person or group of people in the path
- Bollard, bin, bench, or street furniture in the path
- Construction barrier, cone, or scaffolding
- Bicycle or scooter parked across the path
- Puddle, wet surface, or slippery area
- Narrow gap or pinch point ahead
- Door opening into the path
- Uneven or broken paving directly ahead

Respond ONLY with a JSON array. Each item:
- "tag": stable snake_case identifier combining object + position, e.g. "steps_ahead", "person_left", "bollard_right", "puddle_ahead", "car_crossing". Reuse the same tag across frames for the same hazard.
- "description": short, plain spoken phrase (under 10 words), e.g. "Steps ahead", "Person blocking path", "Bollard on your right"
- "severity": "critical" or "warning"

Omit parked cars well off the path, background buildings, distant scenery, and anything more than ~10 metres away.
If nothing needs reporting, return [].
Return raw JSON only — no markdown, no code fences.`;

export async function analyzeFrame(base64Image: string): Promise<HazardReport[]> {
  if (!process.env.EXPO_PUBLIC_GEMINI_API_KEY) {
    console.warn('Gemini API key not set');
    return [];
  }

  const cleanBase64 = base64Image.replace(/[\s\r\n]/g, '');
  if (!cleanBase64) return [];

  try {
    const { text } = await generateText({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: HAZARD_PROMPT },
            {
              type: 'image',
              image: `data:image/jpeg;base64,${cleanBase64}`,
            },
          ],
        },
      ],
      temperature: 0.2,
      maxOutputTokens: 512,
    });

    const cleaned = text.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    if (!cleaned || cleaned === '[]') return [];

    const hazards: Array<{ tag?: string; description: string; severity: string }> = JSON.parse(cleaned);

    return hazards.map((h) => ({
      tag: h.tag ?? h.description.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40),
      description: h.description,
      severity: h.severity as HazardReport['severity'],
      timestamp: Date.now(),
    }));
  } catch {
    return [];
  }
}
