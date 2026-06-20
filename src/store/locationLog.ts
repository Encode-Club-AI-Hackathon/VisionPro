import { File, Paths } from 'expo-file-system';
import type { Coordinate } from '../types';

const MAX_ENTRIES = 100;

function logFile(): File {
  return new File(Paths.document, 'blindnav_sessions.json');
}

export interface LocationLogEntry {
  id: string;
  timestamp: number;
  date: string; // ISO string, human-readable
  userLocation: {
    coordinate: Coordinate;
    address: string;
  };
  destination: {
    name: string;
    address: string;
    coordinate: Coordinate;
  };
  source: 'voice_search' | 'favorite';
}

async function readLog(): Promise<LocationLogEntry[]> {
  try {
    const file = logFile();
    if (!file.exists) return [];
    const json = await file.text();
    return JSON.parse(json);
  } catch {
    return [];
  }
}

export async function appendLocationLogEntry(
  entry: Omit<LocationLogEntry, 'id' | 'date'>
): Promise<void> {
  try {
    const log = await readLog();
    const newEntry: LocationLogEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date: new Date(entry.timestamp).toISOString(),
    };
    log.unshift(newEntry);
    if (log.length > MAX_ENTRIES) log.length = MAX_ENTRIES;
    logFile().write(JSON.stringify(log, null, 2));
    console.log('[LocationLog] saved:', newEntry.date, '→', newEntry.destination.name);
    console.log('[LocationLog] file:', logFile().uri);
  } catch (error) {
    console.error('[LocationLog] Failed to save entry:', error);
  }
}

export async function getLocationLog(): Promise<LocationLogEntry[]> {
  return readLog();
}

export function clearLocationLog(): void {
  const file = logFile();
  if (file.exists) file.delete();
}
