import { useState, useEffect, useRef, useCallback } from 'react';
import * as Location from 'expo-location';
import {
  getWalkingRoute,
  distanceBetween,
  bearingBetween,
  getDirectionFromBearing,
  distanceToRoutePolyline,
  buildStepToPolylineMap,
  nearestPolylineIndex,
  polylineDistanceFrom,
} from '../services/navigation';
import { speechService } from '../services/speech';
import type { Coordinate, Route, RouteStep } from '../types';

const WAYPOINT_THRESHOLD_M = 7;
const POLYLINE_STEP_ADVANCE_THRESHOLD_M = 40;
const ROUTE_WARNING_THRESHOLD_M = 15;
const REROUTE_THRESHOLD_M = 30;
const TURN_PROMPT_DISTANCES_M = [30, 15, 7];
const ROUTE_WARNING_COOLDOWN_MS = 20_000;
const WRONG_WAY_COOLDOWN_MS = 15_000;
const WRONG_WAY_SCORE_FIRE = 6;
const WRONG_WAY_SCORE_MAX = 12;
const WRONG_WAY_ANGLE_STRONG = 120;
const WRONG_WAY_ANGLE_MODERATE = 90;

const POSITION_HISTORY_MAX = 8;
const POSITION_MIN_SPACING_M = 1.5;

interface UseNavigationResult {
  isNavigating: boolean;
  currentStep: RouteStep | null;
  currentInstruction: string;
  remainingDistance: number;
  startNavigation: (destination: Coordinate) => Promise<void>;
  stopNavigation: () => void;
  speakCurrentLocation: () => Promise<void>;
}

function computeSmoothedBearing(positions: Coordinate[]): number | null {
  if (positions.length < 2) return null;

  let sinSum = 0;
  let cosSum = 0;
  let totalWeight = 0;

  for (let i = 1; i < positions.length; i++) {
    const dist = distanceBetween(positions[i - 1], positions[i]);
    if (dist < 0.5) continue;
    const bearing = bearingBetween(positions[i - 1], positions[i]);
    const weight = i; // newer pairs weighted more
    const rad = (bearing * Math.PI) / 180;
    sinSum += Math.sin(rad) * weight;
    cosSum += Math.cos(rad) * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return null;
  const meanRad = Math.atan2(sinSum / totalWeight, cosSum / totalWeight);
  return ((meanRad * 180) / Math.PI + 360) % 360;
}

export function useNavigation(): UseNavigationResult {
  const [isNavigating, setIsNavigating] = useState(false);
  const [currentStep, setCurrentStep] = useState<RouteStep | null>(null);
  const [currentInstruction, setCurrentInstruction] = useState('');
  const [remainingDistance, setRemainingDistance] = useState(0);

  const routeRef = useRef<Route | null>(null);
  const stepIndexRef = useRef(0);
  const destinationRef = useRef<Coordinate | null>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const isNavigatingRef = useRef(false);
  const currentLocationRef = useRef<Coordinate | null>(null);

  const positionHistoryRef = useRef<Coordinate[]>([]);
  const smoothTravelBearingRef = useRef<number | null>(null);
  const stepPolylineMapRef = useRef<number[]>([]);
  const currentPolylineIndexRef = useRef(0);

  const wrongWayScoreRef = useRef(0);
  const lastWrongWayWarningAtRef = useRef(0);
  const spokenTurnPromptsRef = useRef<Set<string>>(new Set());
  const lastRouteWarningAtRef = useRef(0);

  // Ref to startNavigation so handleLocationUpdate can call it without circular deps
  const startNavigationRef = useRef<(destination: Coordinate) => Promise<void>>(async () => {});

  const cleanup = useCallback(() => {
    locationSubRef.current?.remove();
    locationSubRef.current = null;
    routeRef.current = null;
    stepIndexRef.current = 0;
    destinationRef.current = null;
    currentLocationRef.current = null;
    isNavigatingRef.current = false;
    positionHistoryRef.current = [];
    smoothTravelBearingRef.current = null;
    stepPolylineMapRef.current = [];
    currentPolylineIndexRef.current = 0;
    wrongWayScoreRef.current = 0;
    lastWrongWayWarningAtRef.current = 0;
    spokenTurnPromptsRef.current.clear();
    lastRouteWarningAtRef.current = 0;
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
    wrongWayScoreRef.current = 0;
    spokenTurnPromptsRef.current.clear();
    speechService.speakNavigation(formatGuidedInstruction(step, currentLocationRef.current));
  }, [cleanup]);

  const handleLocationUpdate = useCallback(
    async (location: Location.LocationObject) => {
      if (!isNavigatingRef.current) return;

      const coord: Coordinate = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };
      currentLocationRef.current = coord;

      // Maintain position history, filtering GPS noise
      const history = positionHistoryRef.current;
      const last = history.length > 0 ? history[history.length - 1] : null;
      if (!last || distanceBetween(last, coord) >= POSITION_MIN_SPACING_M) {
        history.push(coord);
        if (history.length > POSITION_HISTORY_MAX) history.shift();
        smoothTravelBearingRef.current = computeSmoothedBearing(history);
      }

      const route = routeRef.current;
      if (!route) return;

      const stepIdx = stepIndexRef.current;
      const step = route.steps[stepIdx];
      if (!step) return;

      // Track progress along polyline — never go backward
      const nearestIdx = nearestPolylineIndex(coord, route.polyline);
      if (nearestIdx > currentPolylineIndexRef.current) {
        currentPolylineIndexRef.current = nearestIdx;
      }

      // Remaining = actual walking distance along polyline from current position
      const remainingPolylineDist = polylineDistanceFrom(
        currentPolylineIndexRef.current,
        route.polyline
      );
      setRemainingDistance(remainingPolylineDist);

      // Off-route detection with automatic reroute
      const routeDeviation = distanceToRoutePolyline(coord, route.polyline);
      if (
        Number.isFinite(routeDeviation) &&
        routeDeviation > REROUTE_THRESHOLD_M &&
        destinationRef.current
      ) {
        speechService.speakWarning('Off route. Recalculating.');
        await startNavigationRef.current(destinationRef.current);
        return;
      }

      if (Number.isFinite(routeDeviation) && routeDeviation > ROUTE_WARNING_THRESHOLD_M) {
        const now = Date.now();
        if (now - lastRouteWarningAtRef.current > ROUTE_WARNING_COOLDOWN_MS) {
          lastRouteWarningAtRef.current = now;
          speechService.speakWarning('You may be drifting from the route.');
        }
      }

      const distToWaypoint = distanceBetween(coord, step.coordinate);

      // Primary step advance: physically within threshold of waypoint
      if (distToWaypoint < WAYPOINT_THRESHOLD_M) {
        advanceStep();
        return;
      }

      // Secondary step advance: polyline progress has entered next step's zone
      const nextStepPolylineIdx = stepPolylineMapRef.current[stepIdx + 1] ?? Infinity;
      if (
        currentPolylineIndexRef.current >= nextStepPolylineIdx &&
        distToWaypoint < POLYLINE_STEP_ADVANCE_THRESHOLD_M
      ) {
        advanceStep();
        return;
      }

      // Approach prompts at 30m, 15m, 7m
      for (const promptDistance of TURN_PROMPT_DISTANCES_M) {
        const key = `${stepIdx}:${promptDistance}`;
        if (
          distToWaypoint <= promptDistance &&
          distToWaypoint > WAYPOINT_THRESHOLD_M &&
          !spokenTurnPromptsRef.current.has(key)
        ) {
          spokenTurnPromptsRef.current.add(key);
          const bearing = bearingBetween(coord, step.coordinate);
          const smoothBearing = smoothTravelBearingRef.current;
          const direction =
            smoothBearing !== null
              ? getDirectionFromBearing(bearing, smoothBearing)
              : bearingToCardinalDirection(bearing);
          const distText = promptDistance === 7 ? 'now' : `in about ${promptDistance} meters`;
          speechService.speakNavigation(
            `${formatGuidedInstruction(step, coord)} The waypoint is ${direction}, ${distText}.`
          );
          break;
        }
      }

      // Wrong-way detection using smoothed multi-sample travel bearing
      const smoothBearing = smoothTravelBearingRef.current;
      if (smoothBearing !== null) {
        const requiredBearing = bearingBetween(coord, step.coordinate);
        const angleDiff = Math.abs(((smoothBearing - requiredBearing + 540) % 360) - 180);

        if (angleDiff > WRONG_WAY_ANGLE_STRONG) {
          wrongWayScoreRef.current = Math.min(
            wrongWayScoreRef.current + 3,
            WRONG_WAY_SCORE_MAX
          );
        } else if (angleDiff > WRONG_WAY_ANGLE_MODERATE) {
          wrongWayScoreRef.current = Math.min(
            wrongWayScoreRef.current + 1,
            WRONG_WAY_SCORE_MAX
          );
        } else if (angleDiff < 60) {
          wrongWayScoreRef.current = Math.max(0, wrongWayScoreRef.current - 2);
        }

        if (
          wrongWayScoreRef.current >= WRONG_WAY_SCORE_FIRE &&
          Date.now() - lastWrongWayWarningAtRef.current >= WRONG_WAY_COOLDOWN_MS
        ) {
          lastWrongWayWarningAtRef.current = Date.now();
          wrongWayScoreRef.current = 0;
          const direction = getDirectionFromBearing(requiredBearing, smoothBearing);
          speechService.speakNavigation(buildWrongWayMessage(direction));
        }
      }
    },
    [advanceStep]
  );

  const startNavigation = useCallback(
    async (destination: Coordinate) => {
      cleanup();

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        speechService.speakImmediate('Location permission required for navigation.');
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const origin: Coordinate = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };
      currentLocationRef.current = origin;
      positionHistoryRef.current = [origin];

      speechService.speakInfo('Calculating route. Please wait.');

      const route = await getWalkingRoute(origin, destination);
      if (!route || route.steps.length === 0) {
        speechService.speakImmediate('Could not find a walking route to that destination.');
        return;
      }

      routeRef.current = route;
      destinationRef.current = destination;
      stepIndexRef.current = 0;
      stepPolylineMapRef.current = buildStepToPolylineMap(route.steps, route.polyline);
      currentPolylineIndexRef.current = 0;
      isNavigatingRef.current = true;

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
      setRemainingDistance(route.totalDistance);
      setIsNavigating(true);

      setTimeout(() => {
        speechService.speakNavigation(formatGuidedInstruction(firstStep, origin));
      }, 2000);

      locationSubRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval: 1,
          timeInterval: 1000,
        },
        handleLocationUpdate
      );
    },
    [cleanup, handleLocationUpdate]
  );

  // Keep startNavigationRef in sync so handleLocationUpdate can call it
  useEffect(() => {
    startNavigationRef.current = startNavigation;
  }, [startNavigation]);

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
    };
  }, []);

  return {
    isNavigating,
    currentStep,
    currentInstruction,
    remainingDistance,
    startNavigation,
    stopNavigation,
    speakCurrentLocation,
  };
}

function formatGuidedInstruction(step: RouteStep, current: Coordinate | null): string {
  if (!current) return step.instruction;

  const bearing = bearingBetween(current, step.coordinate);
  const cardinalDirection = bearingToCardinalDirection(bearing);

  if (/continue/i.test(step.instruction)) {
    return `${step.instruction} Head ${cardinalDirection}.`;
  }

  if (/start walking/i.test(step.instruction)) {
    return `${step.instruction} Start by heading ${cardinalDirection}.`;
  }

  return step.instruction;
}

function buildWrongWayMessage(direction: string): string {
  if (direction === 'behind you') return 'Wrong way. Turn around.';
  if (direction === 'to your right') return 'Wrong way. Turn right.';
  if (direction === 'to your left') return 'Wrong way. Turn left.';
  if (direction === 'slightly right') return 'Wrong way. Bear right.';
  if (direction === 'slightly left') return 'Wrong way. Bear left.';
  return `Wrong way. The route is ${direction}.`;
}

function bearingToCardinalDirection(bearing: number): string {
  if (bearing >= 337.5 || bearing < 22.5) return 'north';
  if (bearing < 67.5) return 'northeast';
  if (bearing < 112.5) return 'east';
  if (bearing < 157.5) return 'southeast';
  if (bearing < 202.5) return 'south';
  if (bearing < 247.5) return 'southwest';
  if (bearing < 292.5) return 'west';
  return 'northwest';
}
