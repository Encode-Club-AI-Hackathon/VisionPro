import { generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { HazardReport } from '../types';

const google = createGoogleGenerativeAI({
  apiKey: process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '',
});

const model = google('gemini-3.1-flash-lite');

const HAZARD_PROMPT = `You are a navigation assistant for a blind person. Analyze this camera image and identify:

1. CRITICAL hazards requiring immediate action (approaching vehicles, open holes, low-hanging obstacles at head height)
2. WARNING hazards nearby (stairs, curbs, construction, uneven ground, wet surfaces)
3. INFO observations about the environment (open spaces, doors, narrow passages, landmarks)

Respond ONLY with a JSON array. Each item must have:
- "tag": a short stable snake_case identifier for this hazard combining the object and direction, e.g. "car_left", "stairs_ahead", "curb_right", "pole_center", "wet_floor_ahead", "door_left". Use the SAME tag if the same hazard appears in multiple frames.
- "description": brief, spoken-friendly description (e.g., "Car approaching from your left")
- "severity": "critical", "warning", or "info"

Keep descriptions concise and directional (use clock positions or left/right/ahead).
If the scene is clear and safe, return an empty array [].
Do NOT include markdown formatting or code blocks. Return raw JSON only.`;

export async function analyzeFrame(base64Image: string): Promise<HazardReport[]> {
  if (!process.env.EXPO_PUBLIC_GEMINI_API_KEY) {
    console.warn('Gemini API key not set');
    return [];
  }

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
              image: `data:image/jpeg;base64,${base64Image}`,
            },
          ],
        },
      ],
      temperature: 0.2,
      maxOutputTokens: 512,
    });

    const cleaned = text.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    const hazards: Array<{ tag?: string; description: string; severity: string }> = JSON.parse(cleaned);

    return hazards.map((h) => ({
      tag: h.tag ?? h.description.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40),
      description: h.description,
      severity: h.severity as HazardReport['severity'],
      timestamp: Date.now(),
    }));
  } catch (error) {
    console.error('Gemini analysis failed:', error);
    return [];
  }
}
