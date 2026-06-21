import { useRef, useState, useEffect } from "react";
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
    const DEDUP_MS = 10_000;

    const newHazards = lastHazards.filter((h) => {
      const lastSeen = seenTagsRef.current.get(h.tag) ?? 0;
      if (now - lastSeen < DEDUP_MS) return false;
      seenTagsRef.current.set(h.tag, now);
      return true;
    });

    if (newHazards.length === 0) return;

    console.log('[mainscreen] new hazards:', newHazards.map((h) => `${h.severity}:${h.tag}`).join(', '));

    const criticals = newHazards.filter((h) => h.severity === "critical");
    const warnings = newHazards.filter((h) => h.severity === "warning");

    if (criticals.length > 0) {
      const suffix = mode === "select_destination" ? " Tap for options." : "";
      speechService.speakImmediate(criticals.map((h) => h.description).join(". ") + suffix);
    } else if (warnings.length > 0) {
      speechService.speakWarning(warnings.slice(0, 2).map((h) => h.description).join(". "));
    }
  }, [lastHazards, mode]);

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
        lastHazards={lastHazards}
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
