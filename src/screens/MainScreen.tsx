import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CameraView } from 'expo-camera';
import GestureOverlay from '../components/GestureOverlay';
import StatusBar from '../components/StatusBar';
import { useBlindNavController } from '../hooks/useBlindNavController';
import { useHazardDetection } from '../hooks/useHazardDetection';

export default function MainScreen() {
  const cameraRef = useRef<InstanceType<typeof CameraView>>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const {
    mode,
    hazardDetectionEnabled,
    hazardsActive,
    isNavigating,
    currentInstruction,
    remainingDistance,
    lastGesture,
    handleGesture,
  } = useBlindNavController(cameraReady);
  const { lastHazards } = useHazardDetection(cameraRef, hazardsActive);

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        onCameraReady={() => setCameraReady(true)}
      />

      <StatusBar
        mode={mode}
        hazardDetectionEnabled={hazardDetectionEnabled}
        isNavigating={isNavigating}
        currentInstruction={currentInstruction}
        remainingDistance={remainingDistance}
        lastHazards={lastHazards}
        lastGesture={lastGesture ?? undefined}
      />

      <GestureOverlay onGesture={handleGesture} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
