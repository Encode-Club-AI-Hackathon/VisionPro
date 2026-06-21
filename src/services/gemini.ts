import type { HazardReport } from '../types';

// ── Flock proxy ──────────────────────────────────────────────────────────────
const FLOCK_BASE_URL = 'https://api.flock.io/v1';
const FLOCK_MODEL = 'gemini-3-flash-preview';

// ── Direct Gemini API (commented out — swap fetch blocks below to use) ────────
// const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
// const GEMINI_MODEL = 'gemini-3.1-flash-lite';

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
    console.warn('[gemini] API key not set');
    return [];
  }

  const cleanBase64 = base64Image.replace(/[\s\r\n]/g, '');
  if (!cleanBase64) {
    console.warn('[gemini] empty base64 image');
    return [];
  }

  console.log('[gemini] analyzing frame, base64 length:', cleanBase64.length);

  try {
    // ── Flock proxy ────────────────────────────────────────────────────────
    const res = await fetch(`${FLOCK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-litellm-api-key': process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '',
      },
      body: JSON.stringify({
        model: FLOCK_MODEL,
        temperature: 0.2,
        max_tokens: 1024,
        thinking: { budget_tokens: 512 },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: HAZARD_PROMPT },
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${cleanBase64}` },
              },
            ],
          },
        ],
      }),
    });

    // ── Direct Gemini API (commented out) ─────────────────────────────────
    // const res = await fetch(
    //   `${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent?key=${process.env.EXPO_PUBLIC_GEMINI_API_KEY}`,
    //   {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify({
    //       contents: [
    //         {
    //           parts: [
    //             { text: HAZARD_PROMPT },
    //             { inline_data: { mime_type: 'image/jpeg', data: cleanBase64 } },
    //           ],
    //         },
    //       ],
    //       generationConfig: { temperature: 0.2, maxOutputTokens: 512 },
    //     }),
    //   }
    // );

    const rawBody = await res.text();
    console.log('[gemini] HTTP status:', res.status);
    console.log('[gemini] raw body:', rawBody.slice(0, 500));

    if (!res.ok) {
      throw new Error(`flock ${res.status}: ${rawBody}`);
    }

    // ── Flock response parsing ─────────────────────────────────────────────
    const json = JSON.parse(rawBody) as {
      choices: Array<{ message: { content: string }; finish_reason: string }>;
      usage?: { total_tokens: number };
    };
    const text = json.choices?.[0]?.message?.content ?? '';
    console.log('[gemini] finishReason:', json.choices?.[0]?.finish_reason, 'tokens:', json.usage?.total_tokens);

    // ── Direct Gemini response parsing (commented out) ─────────────────────
    // const json = JSON.parse(rawBody) as {
    //   candidates: Array<{ content: { parts: Array<{ text: string }> }; finishReason: string }>;
    //   usageMetadata?: { totalTokenCount: number };
    // };
    // const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    // console.log('[gemini] finishReason:', json.candidates?.[0]?.finishReason, 'tokens:', json.usageMetadata?.totalTokenCount);

    console.log('[gemini] parsed text:', JSON.stringify(text));

    const cleaned = text.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    if (!cleaned || cleaned === '[]') {
      console.log('[gemini] no hazards detected');
      return [];
    }

    const hazards: Array<{ tag?: string; description: string; severity: string }> = JSON.parse(cleaned);
    console.log('[gemini] hazards:', JSON.stringify(hazards));

    return hazards.map((h) => ({
      tag: h.tag ?? h.description.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40),
      description: h.description,
      severity: h.severity as HazardReport['severity'],
      timestamp: Date.now(),
    }));
  } catch (e) {
    console.error('[gemini] error:', e);
    return [];
  }
}
