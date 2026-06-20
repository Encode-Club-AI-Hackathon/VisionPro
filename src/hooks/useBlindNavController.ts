import { useCallback, useRef, useState } from 'react';
import { findDestinationsNearMe, getCurrentCoordinate } from '../services/places';
import { reverseGeocode } from '../services/geocoding';
import { speechService } from '../services/speech';
import { playTone } from '../services/tone';
import { cancelListening, startListening, stopListeningAndSubmit } from '../services/voiceInput';
import { getFavorites, getFavoritesCount } from '../store/favorites';
import { appendLocationLogEntry } from '../store/locationLog';
import type {
  AppMode,
  DestinationSearchResult,
  GestureType,
} from '../types';
import { useNavigation } from './useNavigation';

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

export function useBlindNavController(cameraReady: boolean) {
  const [mode, setMode] = useState<AppMode>('explore');
  const [hazardDetectionEnabled, setHazardDetectionEnabled] = useState(true);
  const [lastGesture, setLastGesture] = useState<string | null>(null);
  const [activeDestinationName, setActiveDestinationName] = useState<string | undefined>();

  const gestureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const favoritesIndex = useRef(0);
  const destinationIndex = useRef(0);
  const pendingDestinations = useRef<DestinationSearchResult[]>([]);

  const {
    isNavigating,
    currentStep,
    currentInstruction,
    remainingDistance,
    startNavigation,
    stopNavigation,
    speakCurrentLocation,
  } = useNavigation();

  const clearDestinations = useCallback(() => {
    pendingDestinations.current = [];
    destinationIndex.current = 0;
  }, []);

  const flashGesture = useCallback((gesture: GestureType) => {
    setLastGesture(GESTURE_LABELS[gesture]);
    if (gestureTimer.current) clearTimeout(gestureTimer.current);
    gestureTimer.current = setTimeout(() => setLastGesture(null), 1500);
  }, []);

  const handleDestinationVoiceResult = useCallback(
    async (text: string) => {
      setMode('explore');
      speechService.speakInfo(`Searching for ${text}`);

      const destinations = await findDestinationsNearMe(text);
      if (destinations.length === 0) {
        clearDestinations();
        speechService.speakWarning(
          `Could not find a nearby location for "${text}". Please try again.`
        );
        return;
      }

      pendingDestinations.current = destinations;
      destinationIndex.current = 0;
      setMode('select_destination');
      speechService.speakInfo(formatDestinationChoice(destinations[0], 0, destinations.length));
    },
    [clearDestinations]
  );

  const speakCurrentContext = useCallback(async () => {
    if (isNavigating && currentInstruction) {
      speechService.speakNavigation(
        `${currentInstruction} ` +
          'Tap to repeat. Double tap to stop navigation. Swipe down for your location.'
      );
      return;
    }

    if (mode === 'favorites') {
      const favorites = await getFavorites();
      if (favorites.length > 0) {
        const fav = favorites[favoritesIndex.current % favorites.length];
        speechService.speakInfo(
          `${fav.name}. ${fav.address}. ` +
            'Swipe right for next. Double tap to navigate here. Swipe left to go back.'
        );
      } else {
        speechService.speakInfo('No favorites saved. Swipe left to go back.');
      }
      return;
    }

    if (mode === 'destination') {
      speechService.speakInfo(
        'Listening for your destination. Speak now. Double tap when done. Swipe left to cancel.'
      );
      return;
    }

    if (mode === 'select_destination' && pendingDestinations.current.length > 0) {
      const destination = pendingDestinations.current[destinationIndex.current];
      speechService.speakInfo(
        formatDestinationChoice(
          destination,
          destinationIndex.current,
          pendingDestinations.current.length
        )
      );
      return;
    }

    const hazardStatus = hazardDetectionEnabled ? 'Hazard detection on' : 'Hazard detection off';
    speechService.speakInfo(
      `Explore mode. ${hazardStatus}. ` +
        'Swipe up to set a destination. Swipe down for your location. ' +
        'Long press for favorites. Two finger tap to toggle hazard detection.'
    );
  }, [currentInstruction, hazardDetectionEnabled, isNavigating, mode]);

  const startSelectedDestination = useCallback(async () => {
    const destination = pendingDestinations.current[destinationIndex.current];
    if (!destination) return;

    setMode('navigate');
    setActiveDestinationName(destination.name);
    clearDestinations();
    speechService.speakInfo(`Starting navigation to ${destination.name}`);

    // Log asynchronously — don't block navigation on it
    getCurrentCoordinate().then(async (userCoord) => {
      if (!userCoord) return;
      const userAddress = await reverseGeocode(userCoord);
      appendLocationLogEntry({
        timestamp: Date.now(),
        userLocation: { coordinate: userCoord, address: userAddress },
        destination: {
          name: destination.name,
          address: destination.address,
          coordinate: destination.coordinate,
        },
        source: 'voice_search',
      });
    });

    await startNavigation(destination.coordinate);
  }, [clearDestinations, startNavigation]);

  const startSelectedFavorite = useCallback(async () => {
    const favorites = await getFavorites();
    if (favorites.length === 0) return;

    const fav = favorites[favoritesIndex.current % favorites.length];
    setMode('navigate');
    setActiveDestinationName(fav.name);
    speechService.speakInfo(`Starting navigation to ${fav.name}`);

    // Log asynchronously — don't block navigation on it
    getCurrentCoordinate().then(async (userCoord) => {
      if (!userCoord) return;
      const userAddress = await reverseGeocode(userCoord);
      appendLocationLogEntry({
        timestamp: Date.now(),
        userLocation: { coordinate: userCoord, address: userAddress },
        destination: {
          name: fav.name,
          address: fav.address,
          coordinate: fav.coordinate,
        },
        source: 'favorite',
      });
    });

    await startNavigation(fav.coordinate);
  }, [startNavigation]);

  const speakNextFavorite = useCallback(async () => {
    const count = await getFavoritesCount();
    if (count === 0) return;

    favoritesIndex.current = (favoritesIndex.current + 1) % count;
    const favorites = await getFavorites();
    const fav = favorites[favoritesIndex.current];
    speechService.speakInfo(`${fav.name}. Swipe right for next, double tap to navigate.`);
  }, []);

  const speakDestinationChoice = useCallback(() => {
    const destination = pendingDestinations.current[destinationIndex.current];
    if (!destination) return;

    speechService.speakInfo(
      formatDestinationChoice(
        destination,
        destinationIndex.current,
        pendingDestinations.current.length
      )
    );
  }, []);

  const speakNextDestination = useCallback(() => {
    if (pendingDestinations.current.length === 0) return;

    destinationIndex.current =
      (destinationIndex.current + 1) % pendingDestinations.current.length;
    speakDestinationChoice();
  }, [speakDestinationChoice]);

  const speakPreviousDestination = useCallback(() => {
    if (pendingDestinations.current.length === 0) return;

    destinationIndex.current =
      (destinationIndex.current - 1 + pendingDestinations.current.length) %
      pendingDestinations.current.length;
    speakDestinationChoice();
  }, [speakDestinationChoice]);

  const startDestinationInput = useCallback(async () => {
    setMode('destination');
    await speechService.speakInfo('Speak your destination after the tone. Double tap when done.');
    await speechService.waitUntilIdle();
    await playTone();
    startListening(handleDestinationVoiceResult, (error) => {
      speechService.speakWarning(`Voice input failed. ${error}`);
      setMode('explore');
    });
  }, [handleDestinationVoiceResult]);

  const openFavorites = useCallback(async () => {
    setMode('favorites');
    const favorites = await getFavorites();
    if (favorites.length === 0) {
      speechService.speakInfo('No saved favorites. Swipe left to go back.');
      return;
    }

    favoritesIndex.current = 0;
    speechService.speakInfo(
      `Favorites. ${favorites.length} saved. ${favorites[0].name}. ` +
        'Swipe right for next, double tap to navigate.'
    );
  }, []);

  const handleGesture = useCallback(
    async (gesture: GestureType) => {
      speechService.clearQueue();
      await speechService.interrupt();
      flashGesture(gesture);

      switch (gesture) {
        case 'single_tap':
          await speakCurrentContext();
          break;

        case 'double_tap':
          if (mode === 'destination') {
            await stopListeningAndSubmit();
          } else if (isNavigating) {
            stopNavigation();
            setActiveDestinationName(undefined);
            setMode('explore');
          } else if (mode === 'select_destination') {
            await startSelectedDestination();
          } else if (mode === 'favorites') {
            await startSelectedFavorite();
          } else {
            speechService.speakInfo(
              'No destination set. Swipe up to set a destination, or long press for favorites.'
            );
          }
          break;

        case 'swipe_right':
          if (mode === 'favorites') {
            await speakNextFavorite();
          } else if (mode === 'select_destination') {
            speakNextDestination();
          } else {
            speechService.speakInfo('Confirmed');
          }
          break;

        case 'swipe_left':
          if (mode === 'favorites') {
            setMode('explore');
            speechService.speakInfo('Leaving favorites. Back to explore mode.');
          } else if (mode === 'destination') {
            cancelListening();
            setMode('explore');
            speechService.speakInfo('Cancelled. Back to explore mode.');
          } else if (mode === 'select_destination') {
            speakPreviousDestination();
          } else {
            speechService.speakInfo('Cancelled');
          }
          break;

        case 'swipe_up':
          clearDestinations();
          await startDestinationInput();
          break;

        case 'swipe_down':
          if (mode === 'select_destination') {
            speakDestinationChoice();
          } else {
            await speakCurrentLocation();
          }
          break;

        case 'long_press':
          if (mode === 'select_destination') {
            clearDestinations();
            setMode('explore');
            speechService.speakInfo('Destination selection cancelled. Back to explore mode.');
          } else {
            await openFavorites();
          }
          break;

        case 'two_finger_tap':
          setHazardDetectionEnabled((enabled) => {
            const next = !enabled;
            speechService.speakInfo(`Hazard detection ${next ? 'enabled' : 'disabled'}`);
            return next;
          });
          break;
      }
    },
    [
      clearDestinations,
      flashGesture,
      isNavigating,
      mode,
      openFavorites,
      speakCurrentContext,
      speakCurrentLocation,
      speakDestinationChoice,
      speakNextDestination,
      speakNextFavorite,
      speakPreviousDestination,
      startDestinationInput,
      startSelectedDestination,
      startSelectedFavorite,
      stopNavigation,
    ]
  );

  return {
    mode,
    hazardDetectionEnabled,
    isNavigating,
    currentInstruction,
    remainingDistance,
    lastGesture,
    handleGesture,
  };
}

function formatDestinationChoice(
  destination: DestinationSearchResult,
  selectedIndex: number,
  totalResults: number
): string {
  const distance = formatSpokenDistance(destination.distanceMeters);
  const moreResults =
    totalResults > 1 ? ' Swipe right for the next nearby result.' : '';

  return (
    `Result ${selectedIndex + 1} of ${totalResults}. ` +
    `${destination.name}, ${distance} away. ` +
    `${destination.address}. Double tap to start navigation.${moreResults}`
  );
}

function formatSpokenDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} meters`;
  return `${(meters / 1000).toFixed(1)} kilometers`;
}
