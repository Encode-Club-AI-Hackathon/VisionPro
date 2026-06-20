import type { Coordinate, Route, RouteStep } from '../types';

const OSRM_BASE = 'https://router.project-osrm.org/route/v1/foot';

export async function getWalkingRoute(
  origin: Coordinate,
  destination: Coordinate
): Promise<Route | null> {
  try {
    const url =
      `${OSRM_BASE}/${origin.longitude},${origin.latitude}` +
      `;${destination.longitude},${destination.latitude}` +
      `?overview=full&geometries=geojson&steps=true`;

    const response = await fetch(url);
    if (!response.ok) {
      console.error('OSRM error:', response.status);
      return null;
    }

    const data: any = await response.json();
    if (data.code !== 'Ok' || !data.routes?.length) return null;

    const route = data.routes[0];
    const legs = route.legs[0];

    const steps: RouteStep[] = legs.steps.map(
      (step: {
        maneuver: { type: string; modifier?: string; location: [number, number] };
        distance: number;
        duration: number;
        name: string;
      }) => ({
        instruction: formatInstruction(step),
        distance: step.distance,
        duration: step.duration,
        coordinate: {
          latitude: step.maneuver.location[1],
          longitude: step.maneuver.location[0],
        },
        maneuver: step.maneuver.type,
      })
    );

    const polyline: Coordinate[] = route.geometry.coordinates.map(
      ([lng, lat]: [number, number]) => ({
        latitude: lat,
        longitude: lng,
      })
    );

    return {
      steps,
      totalDistance: route.distance,
      totalDuration: route.duration,
      polyline,
    };
  } catch (error) {
    console.error('Route fetch failed:', error);
    return null;
  }
}

function formatInstruction(step: {
  maneuver: { type: string; modifier?: string };
  distance: number;
  name: string;
}): string {
  const { type, modifier } = step.maneuver;
  const distanceText = formatDistance(step.distance);
  const streetName = step.name ? ` onto ${step.name}` : '';

  switch (type) {
    case 'depart':
      return `Start walking${streetName}. Continue for ${distanceText}.`;
    case 'arrive':
      return 'You have arrived at your destination.';
    case 'turn':
      return `Turn ${modifier ?? 'ahead'}${streetName}. Continue for ${distanceText}.`;
    case 'continue':
      return `Continue straight${streetName} for ${distanceText}.`;
    case 'new name':
      return `Continue onto${streetName} for ${distanceText}.`;
    case 'end of road':
      return `At the end of the road, turn ${modifier ?? 'ahead'}${streetName}.`;
    case 'roundabout':
      return `Enter the roundabout and take the exit${streetName}.`;
    default:
      return `${modifier ? modifier.charAt(0).toUpperCase() + modifier.slice(1) : 'Continue'}${streetName}. ${distanceText}.`;
  }
}

function formatDistance(meters: number): string {
  if (meters < 100) return `${Math.round(meters)} meters`;
  if (meters < 1000) return `${Math.round(meters / 10) * 10} meters`;
  return `${(meters / 1000).toFixed(1)} kilometers`;
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
