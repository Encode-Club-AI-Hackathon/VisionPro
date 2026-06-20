import { useRef, useState, useEffect } from 'react';
import type CameraView from 'expo-camera/build/CameraView';
import { analyzeFrame } from '../services/gemini';
import { speechService } from '../services/speech';
import type { HazardReport } from '../types';

// How long (ms) before the same hazard tag can be spoken again
const DEDUP_WINDOW_MS = 30_000;
// Minimum pause between capture cycles so we don't hammer the API
const MIN_CYCLE_GAP_MS = 2_000;

export function useHazardDetection(
  cameraRef: React.RefObject<CameraView | null>,
  enabled: boolean
) {
  const [lastHazards, setLastHazards] = useState<HazardReport[]>([]);
  // Map of normalised description → timestamp of when it was last spoken
  const recentlySaid = useRef<Map<string, number>>(new Map());
  const abortRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      abortRef.current = true;
      return;
    }

    abortRef.current = false;

    async function loop() {
      while (!abortRef.current) {
        // 1. Wait until TTS has finished everything in the queue
        await speechService.waitUntilIdle();
        if (abortRef.current) break;

        // 2. Bail if camera isn't ready
        if (!cameraRef.current) {
          await sleep(MIN_CYCLE_GAP_MS);
          continue;
        }

        const cycleStart = Date.now();

        // 3. Capture frame — camera can be briefly busy, just skip on failure
        let photo: { base64?: string | null } | undefined;
        try {
          photo = await cameraRef.current.takePictureAsync({
            base64: true,
            quality: 0.3,
            skipProcessing: true,
          });
        } catch {
          // Camera busy or not ready, wait and retry next cycle
          await sleep(MIN_CYCLE_GAP_MS);
          continue;
        }

        if (abortRef.current) break;
        if (!photo?.base64) {
          await sleep(MIN_CYCLE_GAP_MS);
          continue;
        }

        try {
          // 4. Analyse with Gemini
          const hazards = await analyzeFrame(photo.base64);
          if (abortRef.current) break;
          setLastHazards(hazards);

          // 5. Prune stale entries from the dedup cache
          const now = Date.now();
          for (const [key, ts] of recentlySaid.current) {
            if (now - ts > DEDUP_WINDOW_MS) {
              recentlySaid.current.delete(key);
            }
          }

          // 6. Speak only hazards whose tag hasn't been said recently
          for (const hazard of hazards) {
            const lastSaid = recentlySaid.current.get(hazard.tag);
            if (lastSaid && now - lastSaid < DEDUP_WINDOW_MS) {
              continue; // skip, already said this recently
            }

            recentlySaid.current.set(hazard.tag, now);

            switch (hazard.severity) {
              case 'critical':
                await speechService.speakImmediate(hazard.description);
                break;
              case 'warning':
                await speechService.speakWarning(hazard.description);
                break;
              case 'info':
                await speechService.speakInfo(hazard.description);
                break;
            }
          }
        } catch (error) {
          console.error('Gemini analysis error:', error);
        }

        // 7. Ensure minimum gap between cycles
        const elapsed = Date.now() - cycleStart;
        if (elapsed < MIN_CYCLE_GAP_MS) {
          await sleep(MIN_CYCLE_GAP_MS - elapsed);
        }
      }
    }

    loop();

    return () => {
      abortRef.current = true;
    };
  }, [enabled, cameraRef]);

  return { lastHazards };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
