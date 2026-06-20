import React, { useState, useRef, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { CameraView } from 'expo-camera';
import GestureOverlay from '../components/GestureOverlay';
import StatusBar from '../components/StatusBar';
import { speechService } from '../services/speech';
import { findDestinationsNearMe } from '../services/places';
import { playTone } from '../services/tone';
import { useHazardDetection } from '../hooks/useHazardDetection';
import { useNavigation } from '../hooks/useNavigation';
import { getFavorites, getFavoritesCount } from '../store/favorites';
import { startListening, stopListeningAndSubmit, cancelListening } from '../services/voiceInput';
import type { AppMode, GestureType, DestinationSearchResult } from '../types';

export default function MainScreen() {
  const cameraRef = useRef<InstanceType<typeof CameraView>>(null);
  const [mode, setMode] = useState<AppMode>('explore');
  const [hazardDetectionEnabled, setHazardDetectionEnabled] = useState(true);
  const [cameraReady, setCameraReady] = useState(false);
  const favoritesIndex = useRef(0);
  const destinationIndex = useRef(0);

  const {
    isNavigating,
    currentInstruction,
    remainingDistance,
    startNavigation,
    stopNavigation,
    speakCurrentLocation,
  } = useNavigation();

  const hazardsActive = hazardDetectionEnabled && cameraReady && mode !== 'destination';
  const { lastHazards } = useHazardDetection(cameraRef, hazardsActive);
  const [lastGesture, setLastGesture] = useState<string | null>(null);
  const gestureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDestinations = useRef<DestinationSearchResult[]>([]);

  const handleDestinationVoiceResult = useCallback(
    async (text: string) => {
      setMode('explore');
      speechService.speakInfo(`Searching for ${text}`);

      const destinations = await findDestinationsNearMe(text);
      if (destinations.length === 0) {
        pendingDestinations.current = [];
        destinationIndex.current = 0;
        speechService.speakWarning(
          `Could not find a nearby location for "${text}". Please try again.`
        );
        return;
      }

      pendingDestinations.current = destinations;
      destinationIndex.current = 0;
      speechService.speakInfo(formatDestinationChoice(destinations[0], destinations.length));
    },
    []
  );

  const GESTURE_LABELS: Record<GestureType, string> = {
    single_tap: 'Tap',
    double_tap: 'Double Tap',
    swipe_right: 'Swipe Right',
    swipe_left: 'Swipe Left',
    swipe_up: 'Swipe Up',
    swipe_down: 'Swipe Down',
    long_press: 'Long Press',
    two_finger_tap: 'Two-Finger Tap',
  };

  const handleGesture = useCallback(
    async (gesture: GestureType) => {
      // Interrupt any ongoing speech so gesture feedback is immediate
      speechService.clearQueue();
      await speechService.interrupt();

      // Flash gesture label on screen
      setLastGesture(GESTURE_LABELS[gesture]);
      if (gestureTimer.current) clearTimeout(gestureTimer.current);
      gestureTimer.current = setTimeout(() => setLastGesture(null), 1500);

      switch (gesture) {
        case 'single_tap': {
          // Speak status + contextual hints so users know what gestures are available
          if (isNavigating && currentInstruction) {
            speechService.speakNavigation(
              `${currentInstruction} ` +
              `Tap to repeat. Double tap to stop navigation. Swipe down for your location.`
            );
          } else if (mode === 'favorites') {
            const favorites = await getFavorites();
            if (favorites.length > 0) {
              const fav = favorites[favoritesIndex.current % favorites.length];
              speechService.speakInfo(
                `${fav.name}. ${fav.address}. ` +
                `Swipe right for next. Double tap to navigate here. Swipe left to go back.`
              );
            } else {
              speechService.speakInfo('No favorites saved. Swipe left to go back.');
            }
          } else if (mode === 'destination') {
            speechService.speakInfo(
              'Listening for your destination. Speak now. ' +
              'Double tap when done. Swipe left to cancel.'
            );
          } else if (pendingDestinations.current.length > 0) {
            const destination = pendingDestinations.current[destinationIndex.current];
            speechService.speakInfo(
              formatDestinationChoice(destination, pendingDestinations.current.length)
            );
          } else {
            // Explore mode — give status + available actions
            const hazardStatus = hazardDetectionEnabled ? 'Hazard detection on' : 'Hazard detection off';
            speechService.speakInfo(
              `Explore mode. ${hazardStatus}. ` +
              `Swipe up to set a destination. Swipe down for your location. ` +
              `Long press for favorites. Two finger tap to toggle hazard detection.`
            );
          }
          break;
        }

        case 'double_tap': {
          if (mode === 'destination') {
            // Submit voice input
            await stopListeningAndSubmit();
            break;
          } else if (isNavigating) {
            stopNavigation();
            setMode('explore');
          } else if (pendingDestinations.current.length > 0) {
            setMode('navigate');
            const destination = pendingDestinations.current[destinationIndex.current];
            pendingDestinations.current = [];
            destinationIndex.current = 0;
            speechService.speakInfo(`Starting navigation to ${destination.name}`);
            await startNavigation(destination.coordinate);
          } else if (mode === 'favorites') {
            // Start navigation to selected favorite
            const favorites = await getFavorites();
            if (favorites.length > 0) {
              const fav = favorites[favoritesIndex.current % favorites.length];
              setMode('navigate');
              speechService.speakInfo(`Starting navigation to ${fav.name}`);
              await startNavigation(fav.coordinate);
            }
          } else {
            speechService.speakInfo(
              'No destination set. Swipe up to set a destination, or long press for favorites.'
            );
          }
          break;
        }

        case 'swipe_right': {
          if (mode === 'favorites') {
            // Next favorite
            const count = await getFavoritesCount();
            if (count > 0) {
              favoritesIndex.current = (favoritesIndex.current + 1) % count;
              const favorites = await getFavorites();
              const fav = favorites[favoritesIndex.current];
              speechService.speakInfo(`${fav.name}. Swipe right for next, double tap to navigate.`);
            }
          } else if (pendingDestinations.current.length > 0) {
            destinationIndex.current =
              (destinationIndex.current + 1) % pendingDestinations.current.length;
            const destination = pendingDestinations.current[destinationIndex.current];
            speechService.speakInfo(
              formatDestinationChoice(destination, pendingDestinations.current.length)
            );
          } else {
            speechService.speakInfo('Confirmed');
          }
          break;
        }

        case 'swipe_left': {
          if (mode === 'favorites') {
            setMode('explore');
            speechService.speakInfo('Leaving favorites. Back to explore mode.');
          } else if (mode === 'destination') {
            cancelListening();
            setMode('explore');
            speechService.speakInfo('Cancelled. Back to explore mode.');
          } else if (pendingDestinations.current.length > 0) {
            pendingDestinations.current = [];
            destinationIndex.current = 0;
            speechService.speakInfo('Destination cleared. Back to explore mode.');
          } else {
            speechService.speakInfo('Cancelled');
          }
          break;
        }

        case 'swipe_up': {
          // Set destination via voice — pause hazards, prompt, tone, then listen
          setMode('destination');
          await speechService.speakInfo('Speak your destination after the tone. Double tap when done.');
          await speechService.waitUntilIdle();
          await playTone();
          startListening(
            handleDestinationVoiceResult,
            (error) => {
              speechService.speakWarning(`Voice input failed. ${error}`);
              setMode('explore');
            }
          );
          break;
        }

        case 'swipe_down': {
          await speakCurrentLocation();
          break;
        }

        case 'long_press': {
          setMode('favorites');
          const favorites = await getFavorites();
          if (favorites.length === 0) {
            speechService.speakInfo('No saved favorites. Swipe left to go back.');
          } else {
            favoritesIndex.current = 0;
            speechService.speakInfo(
              `Favorites. ${favorites.length} saved. ${favorites[0].name}. Swipe right for next, double tap to navigate.`
            );
          }
          break;
        }

        case 'two_finger_tap': {
          const newState = !hazardDetectionEnabled;
          setHazardDetectionEnabled(newState);
          speechService.speakInfo(`Hazard detection ${newState ? 'enabled' : 'disabled'}`);
          break;
        }
      }
    },
    [
      mode,
      isNavigating,
      currentInstruction,
      hazardDetectionEnabled,
      startNavigation,
      stopNavigation,
      speakCurrentLocation,
      handleDestinationVoiceResult,
    ]
  );

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

function formatDestinationChoice(
  destination: DestinationSearchResult,
  totalResults: number
): string {
  const distance = formatSpokenDistance(destination.distanceMeters);
  const moreResults =
    totalResults > 1 ? ' Swipe right for the next nearby result.' : '';

  return (
    `Found ${destination.name}, ${distance} away. ` +
    `${destination.address}. Double tap to start navigation.${moreResults}`
  );
}

function formatSpokenDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} meters`;
  return `${(meters / 1000).toFixed(1)} kilometers`;
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
