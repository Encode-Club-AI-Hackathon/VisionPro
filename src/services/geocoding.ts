import * as Location from 'expo-location';
import type { Coordinate } from '../types';

export async function geocodeAddress(address: string): Promise<Coordinate | null> {
  try {
    const results = await Location.geocodeAsync(address);
    if (results.length === 0) return null;
    return {
      latitude: results[0].latitude,
      longitude: results[0].longitude,
    };
  } catch (error) {
    console.error('Geocoding failed:', error);
    return null;
  }
}

export async function reverseGeocode(coordinate: Coordinate): Promise<string> {
  try {
    const results = await Location.reverseGeocodeAsync(coordinate);
    if (results.length === 0) return 'Unknown location';

    const place = results[0];
    const parts = [place.name, place.street, place.city].filter(Boolean);
    return parts.join(', ') || 'Unknown location';
  } catch (error) {
    console.error('Reverse geocoding failed:', error);
    return 'Unknown location';
  }
}
