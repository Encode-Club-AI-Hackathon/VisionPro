import { useRef, useState, useEffect, useCallback } from "react";
import type CameraView from "expo-camera/build/CameraView";
import { analyzeFrame } from "../services/gemini";
import { addContextImage } from "../services/navContext";
import type { HazardReport } from "../types";

// Set to false to quickly disable hazard detection during development
export const HAZARD_DETECTION_ENABLED = true;

// Fixed interval between scans — runs independently of TTS
const SCAN_INTERVAL_MS = 2_000;

export function useHazardDetection(cameraRef: React.RefObject<CameraView | null>, enabled: boolean) {
  const [lastHazards, setLastHazards] = useState<HazardReport[]>([]);
  const isAnalyzing = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const scan = useCallback(async () => {
    if (isAnalyzing.current) {
      console.log('[hazard] skipping scan — already analyzing');
      return;
    }
    if (!cameraRef.current) {
      console.log('[hazard] skipping scan — no camera ref');
      return;
    }

    isAnalyzing.current = true;
    console.log('[hazard] starting scan');

    try {
      let photo: { base64?: string | null } | undefined;
      try {
        photo = await cameraRef.current.takePictureAsync({
          base64: true,
          quality: 0.3,
          skipProcessing: true,
        });
      } catch (e) {
        console.warn('[hazard] camera capture failed:', e);
        return;
      }

      if (!photo?.base64) {
        console.warn('[hazard] no base64 in photo');
        return;
      }

      console.log('[hazard] captured frame, sending to Gemini');
      addContextImage(photo.base64);

      const hazards = await analyzeFrame(photo.base64);
      console.log('[hazard] setLastHazards:', hazards.length, 'hazard(s)');
      setLastHazards(hazards);
    } catch (error) {
      console.error('[hazard] scan error:', error);
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
