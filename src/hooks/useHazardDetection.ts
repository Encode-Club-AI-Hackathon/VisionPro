import { useRef, useState, useEffect, useCallback } from 'react';
import type CameraView from 'expo-camera/build/CameraView';
import { analyzeFrame } from '../services/gemini';
import type { HazardReport } from '../types';

// Set to false to quickly disable hazard detection during development
export const HAZARD_DETECTION_ENABLED = true;

// Fixed interval between scans — runs independently of TTS
const SCAN_INTERVAL_MS = 5_000;

export function useHazardDetection(
  cameraRef: React.RefObject<CameraView | null>,
  enabled: boolean
) {
  const [lastHazards, setLastHazards] = useState<HazardReport[]>([]);
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
