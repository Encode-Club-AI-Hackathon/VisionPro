export type AppMode = 'explore' | 'navigate' | 'destination' | 'select_destination' | 'favorites';

export type TTSPriority = 'critical' | 'warning' | 'navigation' | 'info';

export interface TTSMessage {
  text: string;
  priority: TTSPriority;
  id?: string;
}

export interface Coordinate {
  latitude: number;
  longitude: number;
}

export interface Favorite {
  id: string;
  name: string;
  address: string;
  coordinate: Coordinate;
}

export interface DestinationSearchResult {
  id: string;
  name: string;
  address: string;
  coordinate: Coordinate;
  distanceMeters: number;
}

export interface RouteStep {
  instruction: string;
  distance: number; // meters
  duration: number; // seconds
  coordinate: Coordinate;
  maneuver?: string;
}

export interface Route {
  steps: RouteStep[];
  totalDistance: number;
  totalDuration: number;
  polyline: Coordinate[];
}

export interface HazardReport {
  tag: string; // stable dedup key e.g. "stairs_ahead", "car_left"
  description: string;
  severity: 'critical' | 'warning' | 'info';
  timestamp: number;
}

export type GestureType =
  | 'single_tap'
  | 'double_tap'
  | 'swipe_right'
  | 'swipe_left'
  | 'swipe_up'
  | 'swipe_down'
  | 'long_press'
  | 'two_finger_tap';
