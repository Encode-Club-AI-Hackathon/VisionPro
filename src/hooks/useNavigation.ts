import { useState, useEffect, useRef, useCallback } from 'react';
import * as Location from 'expo-location';
import {
  getWalkingRoute,
  distanceBetween,
  bearingBetween,
  getDirectionFromBearing,
} from '../services/navigation';
import { speechService } from '../services/speech';
import type { Coordinate, Route, RouteStep } from '../types';

const WAYPOINT_THRESHOLD_M = 15; // meters to consider waypoint reached
const REROUTE_THRESHOLD_M = 50; // meters off route before re-routing

interface UseNavigationResult {
  isNavigating: boolean;
  currentStep: RouteStep | null;
  currentInstruction: string;
  remainingDistance: number;
  currentLocation: Coordinate | null;
  startNavigation: (destination: Coordinate) => Promise<void>;
  stopNavigation: () => void;
  speakCurrentLocation: () => Promise<void>;
}

export function useNavigation(): UseNavigationResult {
  const [isNavigating, setIsNavigating] = useState(false);
  const [currentStep, setCurrentStep] = useState<RouteStep | null>(null);
  const [currentInstruction, setCurrentInstruction] = useState('');
  const [remainingDistance, setRemainingDistance] = useState(0);
  const [currentLocation, setCurrentLocation] = useState<Coordinate | null>(null);

  const routeRef = useRef<Route | null>(null);
  const stepIndexRef = useRef(0);
  const destinationRef = useRef<Coordinate | null>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const headingSubRef = useRef<Location.LocationSubscription | null>(null);
  const currentHeading = useRef(0);

  const cleanup = useCallback(() => {
    locationSubRef.current?.remove();
    headingSubRef.current?.remove();
    locationSubRef.current = null;
    headingSubRef.current = null;
    routeRef.current = null;
    stepIndexRef.current = 0;
    destinationRef.current = null;
    setIsNavigating(false);
    setCurrentStep(null);
    setCurrentInstruction('');
    setRemainingDistance(0);
  }, []);

  const advanceStep = useCallback(() => {
    const route = routeRef.current;
    if (!route) return;

    stepIndexRef.current += 1;
    if (stepIndexRef.current >= route.steps.length) {
      speechService.speakImmediate('You have arrived at your destination.');
      cleanup();
      return;
    }

    const step = route.steps[stepIndexRef.current];
    setCurrentStep(step);
    setCurrentInstruction(step.instruction);
    speechService.speakNavigation(step.instruction);
  }, [cleanup]);

  const handleLocationUpdate = useCallback(
    (location: Location.LocationObject) => {
      const coord: Coordinate = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };
      setCurrentLocation(coord);

      if (location.coords.heading != null && location.coords.heading >= 0) {
        currentHeading.current = location.coords.heading;
      }

      if (!routeRef.current || !isNavigating) return;

      const route = routeRef.current;
      const stepIdx = stepIndexRef.current;
      const step = route.steps[stepIdx];
      if (!step) return;

      // Check if we've reached the current waypoint
      const distToWaypoint = distanceBetween(coord, step.coordinate);
      setRemainingDistance(distToWaypoint);

      if (distToWaypoint < WAYPOINT_THRESHOLD_M) {
        advanceStep();
        return;
      }

      // Check if user is off route
      const nextStep =
        stepIdx + 1 < route.steps.length ? route.steps[stepIdx + 1] : null;
      if (nextStep) {
        const distToNextWaypoint = distanceBetween(coord, nextStep.coordinate);
        // If closer to next waypoint than current, skip ahead
        if (distToNextWaypoint < distToWaypoint && distToNextWaypoint < WAYPOINT_THRESHOLD_M) {
          stepIndexRef.current += 1;
          advanceStep();
          return;
        }
      }

      // If too far off route, reroute
      if (distToWaypoint > REROUTE_THRESHOLD_M && destinationRef.current) {
        speechService.speakWarning('You seem to be off route. Recalculating.');
        startNavigation(destinationRef.current);
      }
    },
    [isNavigating, advanceStep]
  );

  const startNavigation = useCallback(
    async (destination: Coordinate) => {
      cleanup();

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        speechService.speakImmediate('Location permission is required for navigation.');
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const origin: Coordinate = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };
      setCurrentLocation(origin);

      speechService.speakInfo('Calculating route. Please wait.');

      const route = await getWalkingRoute(origin, destination);
      if (!route || route.steps.length === 0) {
        speechService.speakImmediate('Could not find a walking route to that destination.');
        return;
      }

      routeRef.current = route;
      destinationRef.current = destination;
      stepIndexRef.current = 0;

      const totalDistText =
        route.totalDistance < 1000
          ? `${Math.round(route.totalDistance)} meters`
          : `${(route.totalDistance / 1000).toFixed(1)} kilometers`;
      const totalTimeMin = Math.round(route.totalDuration / 60);

      speechService.speakNavigation(
        `Route found. ${totalDistText}, approximately ${totalTimeMin} minutes walking.`
      );

      const firstStep = route.steps[0];
      setCurrentStep(firstStep);
      setCurrentInstruction(firstStep.instruction);
      setIsNavigating(true);

      // Delay first instruction slightly
      setTimeout(() => {
        speechService.speakNavigation(firstStep.instruction);
      }, 2000);

      // Start GPS tracking
      locationSubRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval: 5,
          timeInterval: 2000,
        },
        handleLocationUpdate
      );
    },
    [cleanup, handleLocationUpdate]
  );

  const stopNavigation = useCallback(() => {
    speechService.speakInfo('Navigation stopped.');
    cleanup();
  }, [cleanup]);

  const speakCurrentLocation = useCallback(async () => {
    try {
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const results = await Location.reverseGeocodeAsync({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });

      if (results.length > 0) {
        const place = results[0];
        const parts = [place.name, place.street, place.city].filter(Boolean);
        speechService.speakInfo(`You are at ${parts.join(', ')}`);
      } else {
        speechService.speakInfo('Could not determine your current location.');
      }
    } catch {
      speechService.speakInfo('Unable to get your current location.');
    }
  }, []);

  useEffect(() => {
    return () => {
      locationSubRef.current?.remove();
      headingSubRef.current?.remove();
    };
  }, []);

  return {
    isNavigating,
    currentStep,
    currentInstruction,
    remainingDistance,
    currentLocation,
    startNavigation,
    stopNavigation,
    speakCurrentLocation,
  };
}
