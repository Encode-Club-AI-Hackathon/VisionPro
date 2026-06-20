import type { Coordinate, Route, RouteStep } from '../types';

const GMAPS_DIRECTIONS_URL = 'https://maps.googleapis.com/maps/api/directions/json';

const GOOGLE_MAPS_API_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ??
  process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ??
  '';

export async function getWalkingRoute(
  origin: Coordinate,
  destination: Coordinate
): Promise<Route | null> {
  if (!GOOGLE_MAPS_API_KEY) {
    console.warn('Google Maps API key not set');
    return null;
  }

  try {
    const url =
      `${GMAPS_DIRECTIONS_URL}` +
      `?origin=${origin.latitude},${origin.longitude}` +
      `&destination=${destination.latitude},${destination.longitude}` +
      `&mode=walking` +
      `&language=en` +
      `&key=${GOOGLE_MAPS_API_KEY}`;

    const response = await fetch(url);
    if (!response.ok) {
      console.error('Google Directions error:', response.status);
      return null;
    }

    const data: any = await response.json();
    if (data.status !== 'OK' || !data.routes?.length) {
      console.error('Google Directions failed:', data.status);
      return null;
    }

    const route = data.routes[0];
    const leg = route.legs[0];

    const steps: RouteStep[] = leg.steps.map((step: any) => ({
      instruction: stripHtml(step.html_instructions),
      distance: step.distance.value,
      duration: step.duration.value,
      // end_location is the waypoint to reach — when the user arrives here the next
      // instruction fires (same semantics as OSRM's maneuver.location on next step).
      coordinate: {
        latitude: step.end_location.lat,
        longitude: step.end_location.lng,
      },
      maneuver: step.maneuver ?? 'straight',
    }));

    const polyline = decodePolyline(route.overview_polyline.points);

    return {
      steps,
      totalDistance: leg.distance.value,
      totalDuration: leg.duration.value,
      polyline,
    };
  } catch (error) {
    console.error('Route fetch failed:', error);
    return null;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<div[^>]*>/gi, '. ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .replace(/\.\s*\./g, '.')
    .trim();
}

function decodePolyline(encoded: string): Coordinate[] {
  const points: Coordinate[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }

  return points;
}

export function distanceBetween(a: Coordinate, b: Coordinate): number {
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * c;
}

export function bearingBetween(from: Coordinate, to: Coordinate): number {
  const dLon = toRad(to.longitude - from.longitude);
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearing = (toDeg(Math.atan2(y, x)) + 360) % 360;
  return bearing;
}

export function getDirectionFromBearing(bearing: number, heading: number): string {
  const relative = ((bearing - heading) + 360) % 360;

  if (relative < 30 || relative > 330) return 'ahead';
  if (relative >= 30 && relative < 60) return 'slightly right';
  if (relative >= 60 && relative < 120) return 'to your right';
  if (relative >= 120 && relative < 150) return 'behind you to the right';
  if (relative >= 150 && relative < 210) return 'behind you';
  if (relative >= 210 && relative < 240) return 'behind you to the left';
  if (relative >= 240 && relative < 300) return 'to your left';
  return 'slightly left';
}

export function distanceToRoutePolyline(
  point: Coordinate,
  polyline: Coordinate[]
): number {
  if (polyline.length === 0) return Infinity;
  if (polyline.length === 1) return distanceBetween(point, polyline[0]);

  let closest = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const distance = distanceToSegment(point, polyline[i], polyline[i + 1]);
    if (distance < closest) closest = distance;
  }

  return closest;
}

export function buildStepToPolylineMap(steps: RouteStep[], polyline: Coordinate[]): number[] {
  return steps.map((step) => nearestPolylineIndex(step.coordinate, polyline));
}

export function nearestPolylineIndex(point: Coordinate, polyline: Coordinate[]): number {
  let bestIndex = 0;
  let bestDist = Infinity;
  for (let i = 0; i < polyline.length; i++) {
    const d = distanceBetween(point, polyline[i]);
    if (d < bestDist) {
      bestDist = d;
      bestIndex = i;
    }
  }
  return bestIndex;
}

export function polylineDistanceFrom(startIndex: number, polyline: Coordinate[]): number {
  let total = 0;
  for (let i = startIndex; i < polyline.length - 1; i++) {
    total += distanceBetween(polyline[i], polyline[i + 1]);
  }
  return total;
}

function distanceToSegment(point: Coordinate, start: Coordinate, end: Coordinate): number {
  const originLat = toRad(point.latitude);
  const metersPerLat = 111_320;
  const metersPerLon = 111_320 * Math.cos(originLat);

  const px = point.longitude * metersPerLon;
  const py = point.latitude * metersPerLat;
  const sx = start.longitude * metersPerLon;
  const sy = start.latitude * metersPerLat;
  const ex = end.longitude * metersPerLon;
  const ey = end.latitude * metersPerLat;

  const dx = ex - sx;
  const dy = ey - sy;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return distanceBetween(point, start);

  const t = Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy) / lengthSq));
  const closest = {
    longitude: (sx + t * dx) / metersPerLon,
    latitude: (sy + t * dy) / metersPerLat,
  };

  return distanceBetween(point, closest);
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}
