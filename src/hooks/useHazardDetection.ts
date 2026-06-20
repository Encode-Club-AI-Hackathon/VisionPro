import { useRef, useState, useEffect, useCallback } from 'react';
import type CameraView from 'expo-camera/build/CameraView';
import { analyzeFrame } from '../services/gemini';
import { speechService } from '../services/speech';
import type { HazardReport } from '../types';

// Fixed interval between scans — runs independently of TTS
const SCAN_INTERVAL_MS = 5_000;
// How long before the same hazard tag can be spoken again
const DEDUP_WINDOW_MS = 30_000;
// If speech queue is this full, skip adding info-level hazards
const QUEUE_PRESSURE_THRESHOLD = 3;

export function useHazardDetection(
  cameraRef: React.RefObject<CameraView | null>,
  enabled: boolean
) {
  const [lastHazards, setLastHazards] = useState<HazardReport[]>([]);
  const recentlySaid = useRef<Map<string, number>>(new Map());
  const isAnalyzing = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const scan = useCallback(async () => {
    // Skip if already analyzing or camera not ready
    if (isAnalyzing.current || !cameraRef.current) return;

    isAnalyzing.current = true;

    try {
      // 1. Capture frame
      let photo: { base64?: string | null } | undefined;
      try {
        photo = await cameraRef.current.takePictureAsync({
          base64: true,
          quality: 0.3,
          skipProcessing: true,
        });
      } catch {
        // Camera busy, skip this cycle
        return;
      }

      if (!photo?.base64) return;

      // 2. Analyze with Gemini (runs in background, doesn't block TTS)
      const hazards = await analyzeFrame(photo.base64);
      setLastHazards(hazards);

      // 3. Prune stale dedup entries
      const now = Date.now();
      for (const [key, ts] of recentlySaid.current) {
        if (now - ts > DEDUP_WINDOW_MS) {
          recentlySaid.current.delete(key);
        }
      }

      // 4. Check queue pressure — if speech is backed up, drop info items
      //    from the queue to make room for new hazards
      const queueLen = speechService.queueLength;
      if (queueLen >= QUEUE_PRESSURE_THRESHOLD) {
        speechService.clearInfo();
      }

      // 5. Queue new hazards by priority — the priority queue handles ordering
      for (const hazard of hazards) {
        const lastSaid = recentlySaid.current.get(hazard.tag);
        if (lastSaid && now - lastSaid < DEDUP_WINDOW_MS) {
          continue; // already said recently
        }

        // Under queue pressure, skip info-level hazards entirely
        if (hazard.severity === 'info' && queueLen >= QUEUE_PRESSURE_THRESHOLD) {
          continue;
        }

        recentlySaid.current.set(hazard.tag, now);

        switch (hazard.severity) {
          case 'critical':
            speechService.speakImmediate(hazard.description);
            break;
          case 'warning':
            speechService.speakWarning(hazard.description);
            break;
          case 'info':
            speechService.speakInfo(hazard.description);
            break;
        }
      }
    } catch (error) {
      console.error('Gemini analysis error:', error);
    } finally {
      isAnalyzing.current = false;
    }
  }, [cameraRef]);

  useEffect(() => {
    if (enabled) {
      // Run first scan immediately
      scan();
      // Then on a fixed interval
      intervalRef.current = setInterval(scan, SCAN_INTERVAL_MS);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, scan]);

  return { lastHazards };
}
