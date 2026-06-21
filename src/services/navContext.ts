import type { Coordinate, Route } from '../types';

const MAX_IMAGES = 5;
const MAX_GPS_POINTS = 10;

export interface GpsPoint {
  latitude: number;
  longitude: number;
  timestamp: number;
}

export interface NavContextSnapshot {
  images: string[];
  gpsPoints: GpsPoint[];
  route: Route | null;
  destinationName: string | null;
  remainingDistance: number | null;
}

let images: string[] = [];
let gpsPoints: GpsPoint[] = [];
let route: Route | null = null;
let destinationName: string | null = null;
let remainingDistance: number | null = null;

export function addContextImage(base64: string): void {
  if (images.length >= MAX_IMAGES) images.shift();
  images.push(base64.replace(/[\s\r\n]/g, ''));
}

export function addContextGpsPoint(coord: Coordinate): void {
  gpsPoints.push({ latitude: coord.latitude, longitude: coord.longitude, timestamp: Date.now() });
  if (gpsPoints.length > MAX_GPS_POINTS) gpsPoints.shift();
}

export function setContextRoute(r: Route): void {
  route = r;
}

export function setContextDestinationName(name: string): void {
  destinationName = name;
}

export function setContextRemainingDistance(dist: number): void {
  remainingDistance = dist;
}

export function clearNavigationState(): void {
  gpsPoints = [];
  route = null;
  destinationName = null;
  remainingDistance = null;
  // images are intentionally kept — they still represent the current environment
}

export function clearNavContext(): void {
  images = [];
  gpsPoints = [];
  route = null;
  destinationName = null;
  remainingDistance = null;
}

export function getNavContext(): NavContextSnapshot {
  return {
    images: [...images],
    gpsPoints: [...gpsPoints],
    route,
    destinationName,
    remainingDistance,
  };
}
