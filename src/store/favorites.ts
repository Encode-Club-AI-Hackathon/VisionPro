import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Favorite, Coordinate } from '../types';

const STORAGE_KEY = 'visionpro_favorites';

export async function getFavorites(): Promise<Favorite[]> {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export async function addFavorite(
  name: string,
  address: string,
  coordinate: Coordinate
): Promise<Favorite> {
  const favorites = await getFavorites();
  const favorite: Favorite = {
    id: Date.now().toString(36),
    name,
    address,
    coordinate,
  };
  favorites.push(favorite);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
  return favorite;
}

export async function removeFavorite(id: string): Promise<void> {
  const favorites = await getFavorites();
  const filtered = favorites.filter((f) => f.id !== id);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

export async function getFavoriteByIndex(index: number): Promise<Favorite | null> {
  const favorites = await getFavorites();
  return favorites[index] ?? null;
}

export async function getFavoritesCount(): Promise<number> {
  const favorites = await getFavorites();
  return favorites.length;
}
