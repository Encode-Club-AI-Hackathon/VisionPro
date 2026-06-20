import * as Location from 'expo-location';
import type { Coordinate, DestinationSearchResult } from '../types';
import { distanceBetween } from './navigation';

const PLACES_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const PLACES_NEARBY_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchNearby';
const DEFAULT_RADIUS_M = 1500;
const WIDE_RADIUS_M = 5000;
const MAX_RESULTS = 5;

const GOOGLE_PLACES_API_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ??
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ??
  '';

const CATEGORY_TYPES: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /\b(pharmacy|chemist|drugstore|drug store)\b/i, type: 'pharmacy' },
  { pattern: /\b(cafe|coffee|coffee shop)\b/i, type: 'cafe' },
  { pattern: /\b(restaurant|food|eat|lunch|dinner)\b/i, type: 'restaurant' },
  { pattern: /\b(supermarket|grocery|groceries)\b/i, type: 'supermarket' },
  { pattern: /\b(convenience store|corner shop)\b/i, type: 'convenience_store' },
  { pattern: /\b(atm|cash machine)\b/i, type: 'atm' },
  { pattern: /\b(bank)\b/i, type: 'bank' },
  { pattern: /\b(hospital|emergency room|a and e|a&e)\b/i, type: 'hospital' },
  { pattern: /\b(doctor|gp|clinic)\b/i, type: 'doctor' },
  { pattern: /\b(bus stop|bus station)\b/i, type: 'bus_station' },
  { pattern: /\b(train station|railway station|station)\b/i, type: 'train_station' },
  { pattern: /\b(subway|tube|metro|underground)\b/i, type: 'subway_station' },
  { pattern: /\b(toilet|bathroom|restroom|loo)\b/i, type: 'public_bathroom' },
];

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
}

interface PlacesResponse {
  places?: GooglePlace[];
}

export async function findDestinationsNearMe(
  query: string,
  origin?: Coordinate
): Promise<DestinationSearchResult[]> {
  if (!GOOGLE_PLACES_API_KEY) {
    console.warn('Google Places API key not set');
    return [];
  }

  const currentLocation = origin ?? await getCurrentCoordinate();
  if (!currentLocation) return [];

  const normalizedQuery = normalizeQuery(query);
  const category = CATEGORY_TYPES.find((item) => item.pattern.test(normalizedQuery));

  const places = category
    ? await searchNearbyByType(category.type, currentLocation, DEFAULT_RADIUS_M)
    : await searchTextNearLocation(normalizedQuery, currentLocation, DEFAULT_RADIUS_M);

  const widerPlaces =
    places.length > 0
      ? places
      : category
        ? await searchNearbyByType(category.type, currentLocation, WIDE_RADIUS_M)
        : await searchTextNearLocation(normalizedQuery, currentLocation, WIDE_RADIUS_M);

  return normalizePlaces(widerPlaces, currentLocation);
}

export async function getCurrentCoordinate(): Promise<Coordinate | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    return {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    };
  } catch (error) {
    console.error('Current location lookup failed:', error);
    return null;
  }
}

async function searchTextNearLocation(
  query: string,
  origin: Coordinate,
  radiusMeters: number
): Promise<GooglePlace[]> {
  const response = await fetchPlaces(PLACES_TEXT_SEARCH_URL, {
    textQuery: query,
    maxResultCount: MAX_RESULTS,
    locationBias: {
      circle: {
        center: origin,
        radius: radiusMeters,
      },
    },
  });

  return response.places ?? [];
}

async function searchNearbyByType(
  includedType: string,
  origin: Coordinate,
  radiusMeters: number
): Promise<GooglePlace[]> {
  const response = await fetchPlaces(PLACES_NEARBY_SEARCH_URL, {
    includedTypes: [includedType],
    maxResultCount: MAX_RESULTS,
    rankPreference: 'DISTANCE',
    locationRestriction: {
      circle: {
        center: origin,
        radius: radiusMeters,
      },
    },
  });

  return response.places ?? [];
}

async function fetchPlaces(url: string, body: object): Promise<PlacesResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': [
        'places.id',
        'places.displayName',
        'places.formattedAddress',
        'places.shortFormattedAddress',
        'places.location',
      ].join(','),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    console.error('Google Places search failed:', response.status);
    return {};
  }

  return response.json();
}

function normalizePlaces(
  places: GooglePlace[],
  origin: Coordinate
): DestinationSearchResult[] {
  return places
    .filter((place) => place.location?.latitude != null && place.location.longitude != null)
    .map((place, index) => {
      const coordinate = {
        latitude: place.location!.latitude!,
        longitude: place.location!.longitude!,
      };

      return {
        id: place.id ?? `${coordinate.latitude},${coordinate.longitude},${index}`,
        name: place.displayName?.text ?? 'Unnamed place',
        address: place.shortFormattedAddress ?? place.formattedAddress ?? 'Address unavailable',
        coordinate,
        distanceMeters: distanceBetween(origin, coordinate),
      };
    })
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

function normalizeQuery(query: string): string {
  return query
    .replace(/\b(nearest|closest|near me|nearby|around me|find me|take me to)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
