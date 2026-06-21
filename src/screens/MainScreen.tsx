import React, { useRef, useState, useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { CameraView } from "expo-camera";
import GestureOverlay from "../components/GestureOverlay";
import StatusBar from "../components/StatusBar";
import { useBlindNavController } from "../hooks/useBlindNavController";
import { useHazardDetection, HAZARD_DETECTION_ENABLED } from "../hooks/useHazardDetection";
import { speechService } from "../services/speech";

export default function MainScreen() {
  const cameraRef = useRef<InstanceType<typeof CameraView>>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const { mode, hazardDetectionEnabled, isNavigating, isProcessing, currentInstruction, remainingDistance, lastGesture, handleGesture } =
    useBlindNavController(cameraReady);

  const { lastHazards } = useHazardDetection(cameraRef, hazardDetectionEnabled && HAZARD_DETECTION_ENABLED);

  const seenTagsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (lastHazards.length === 0) return;
    const now = Date.now();
    const DEDUP_MS = 30_000;

    for (const hazard of lastHazards) {
      const lastSeen = seenTagsRef.current.get(hazard.tag) ?? 0;
      if (now - lastSeen < DEDUP_MS) continue;
      seenTagsRef.current.set(hazard.tag, now);

      if (hazard.severity === "critical") {
        const suffix = mode === "select_destination" ? " Tap for options." : "";
        speechService.speakImmediate(hazard.description + suffix);
      } else {
        speechService.speakWarning(hazard.description);
      }
    }
  }, [lastHazards, isNavigating, mode]);

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back" onCameraReady={() => setCameraReady(true)} />

      <StatusBar
        mode={mode}
        hazardDetectionEnabled={hazardDetectionEnabled}
        isNavigating={isNavigating}
        isProcessing={isProcessing}
        currentInstruction={currentInstruction}
        remainingDistance={remainingDistance}
        lastGesture={lastGesture ?? undefined}
      />

      <GestureOverlay onGesture={handleGesture} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  camera: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
