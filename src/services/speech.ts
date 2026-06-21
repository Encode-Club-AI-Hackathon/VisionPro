import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { setAudioModeAsync } from 'expo-audio';
import type { TTSMessage } from '../types';

const ELEVENLABS_API_KEY = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY ?? '';
// Default voice: "Rachel" — clear and natural for navigation prompts
const ELEVENLABS_VOICE_ID =
  process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
const ELEVENLABS_MODEL = 'eleven_flash_v2_5';

const MIN_NAV_REPEAT_MS = 5_000;
const MIN_PROMPT_REPEAT_MS = 2_000;
const MAX_QUEUE_SIZE = 3;
let playbackRouteReset: Promise<void> | null = null;

// Active ElevenLabs sound — held so interrupt() can stop it mid-sentence
let activeSound: Audio.Sound | null = null;
let activeSoundDone: (() => void) | null = null;

// Persistent audio cache: phrase text → local file URI (lives across app restarts)
const TTS_CACHE_DIR = `${FileSystem.documentDirectory}tts-cache/`;
const memoryCache = new Map<string, string>(); // text → file URI, warm after first lookup
let cacheDirReady: Promise<void> | null = null;

interface SpeechItem {
  text: string;
  urgent: boolean;
  createdAt: number;
}

class NavigationSpeechQueue {
  private items: SpeechItem[] = [];

  push(item: SpeechItem): void {
    if (this.items.some((queued) => queued.text === item.text)) return;

    if (item.urgent) {
      this.items.unshift(item);
    } else {
      this.items.push(item);
    }

    while (this.items.length > MAX_QUEUE_SIZE) {
      this.items.pop();
    }
  }

  shift(): SpeechItem | null {
    return this.items.shift() ?? null;
  }

  clear(): void {
    this.items = [];
  }

  get length(): number {
    return this.items.length;
  }
}

class SpeechService {
  private queue = new NavigationSpeechQueue();
  private isSpeaking = false;
  private currentText: string | null = null;
  private lastNavigationText: string | null = null;
  private lastNavigationAt = 0;
  private lastPromptAt = 0;

  async speak(message: TTSMessage): Promise<void> {
    if (message.priority === 'critical') {
      await this.speakImmediate(message.text);
      return;
    }
    if (message.priority === 'navigation') {
      await this.speakNavigation(message.text);
      return;
    }
    if (message.priority === 'warning') {
      await this.speakWarning(message.text);
      return;
    }
    await this.speakInfo(message.text);
  }

  async speakImmediate(text: string): Promise<void> {
    await this.interrupt();
    this.queue.push({ text, urgent: true, createdAt: Date.now() });
    this.processQueue().catch((e) => console.error('[speech] processQueue error:', e));
  }

  async speakWarning(text: string): Promise<void> {
    await this.enqueue(text, false);
  }

  async speakNavigation(text: string): Promise<void> {
    const now = Date.now();
    if (
      this.lastNavigationText === text &&
      now - this.lastNavigationAt < MIN_NAV_REPEAT_MS
    ) {
      return;
    }
    this.lastNavigationText = text;
    this.lastNavigationAt = now;
    await this.enqueue(text, false);
  }

  async speakInfo(text: string): Promise<void> {
    const now = Date.now();
    if (now - this.lastPromptAt < MIN_PROMPT_REPEAT_MS) return;
    this.lastPromptAt = now;
    await this.enqueue(text, false);
  }

  private async enqueue(text: string, urgent: boolean): Promise<void> {
    if (this.currentText === text) return;
    this.queue.push({ text, urgent, createdAt: Date.now() });

    if (urgent && this.isSpeaking) {
      await this.interrupt();
    }

    if (!this.isSpeaking) {
      this.processQueue().catch((e) => console.error('[speech] processQueue error:', e));
    }
  }

  private async processQueue(): Promise<void> {
    const item = this.queue.shift();
    if (!item) {
      this.isSpeaking = false;
      this.currentText = null;
      return;
    }

    this.isSpeaking = true;
    this.currentText = item.text;

    await configurePlaybackAudioMode();

    try {
      if (ELEVENLABS_API_KEY) {
        await playWithElevenLabs(item.text);
      } else {
        await playWithExpoSpeech(item.text);
      }
    } catch (e) {
      console.error('[speech] playback error:', e);
    }

    this.currentText = null;
    this.processQueue().catch((e) => console.error('[speech] processQueue error:', e));
  }

  async interrupt(): Promise<void> {
    await stopActiveSound();
    Speech.stop();
    this.isSpeaking = false;
    this.currentText = null;
  }

  clearQueue(): void {
    this.queue.clear();
  }

  clearNonCritical(): void {
    this.queue.clear();
  }

  clearInfo(): void {
    this.queue.clear();
  }

  canSpeakNavigation(): boolean {
    return !this.isSpeaking && this.queue.length === 0;
  }

  get busy(): boolean {
    return this.isSpeaking || this.queue.length > 0;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  async waitUntilIdle(): Promise<void> {
    if (!this.busy) return;
    return new Promise((resolve) => {
      const check = () => {
        if (!this.busy) resolve();
        else setTimeout(check, 200);
      };
      check();
    });
  }
}

// ---------------------------------------------------------------------------
// Persistent TTS cache
// ---------------------------------------------------------------------------

function hashText(text: string): string {
  // djb2 hash — stable, fast, good enough for filenames
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = (((h << 5) + h) ^ text.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

async function ensureCacheDir(): Promise<void> {
  if (!cacheDirReady) {
    cacheDirReady = (async () => {
      const info = await FileSystem.getInfoAsync(TTS_CACHE_DIR);
      if (!info.exists) {
        await FileSystem.makeDirectoryAsync(TTS_CACHE_DIR, { intermediates: true });
      }
    })();
  }
  await cacheDirReady;
}

async function getCachedUri(text: string): Promise<string | null> {
  if (memoryCache.has(text)) return memoryCache.get(text)!;

  const uri = `${TTS_CACHE_DIR}${hashText(text)}.mp3`;
  const info = await FileSystem.getInfoAsync(uri).catch(() => ({ exists: false } as FileSystem.FileInfo));
  if (info.exists) {
    memoryCache.set(text, uri);
    return uri;
  }
  return null;
}

async function saveToCache(text: string, buffer: ArrayBuffer): Promise<string> {
  await ensureCacheDir();
  const uri = `${TTS_CACHE_DIR}${hashText(text)}.mp3`;
  await FileSystem.writeAsStringAsync(uri, arrayBufferToBase64(buffer), {
    encoding: FileSystem.EncodingType.Base64,
  });
  memoryCache.set(text, uri);
  return uri;
}

// ---------------------------------------------------------------------------
// ElevenLabs playback
// ---------------------------------------------------------------------------

async function playWithElevenLabs(text: string): Promise<void> {
  const cached = await getCachedUri(text);
  if (cached) {
    console.log('[elevenlabs] cache hit:', text.slice(0, 50));
    await playAudioFile(cached);
    return;
  }

  console.log('[elevenlabs] fetching TTS for:', text.slice(0, 60));

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`ElevenLabs ${response.status}: ${body}`);
  }

  const buffer = await response.arrayBuffer();
  const fileUri = await saveToCache(text, buffer);

  console.log('[elevenlabs] saved to cache, playing:', fileUri);
  await playAudioFile(fileUri);
}

async function playAudioFile(uri: string): Promise<void> {
  // expo-av needs its own audio mode call for playback on iOS
  await Audio.setAudioModeAsync({
    playsInSilentModeIOS: true,
    allowsRecordingIOS: false,
  });

  return new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      activeSoundDone = null;
      resolve();
    };

    activeSoundDone = done;

    Audio.Sound.createAsync({ uri })
      .then(({ sound }) => {
        activeSound = sound;

        sound.setOnPlaybackStatusUpdate((status) => {
          if (!status.isLoaded) {
            if ((status as { error?: string }).error) {
              console.error('[elevenlabs] playback status error:', (status as { error?: string }).error);
              sound.unloadAsync().catch(() => {});
              activeSound = null;
              done();
            }
            return;
          }
          if (status.didJustFinish) {
            sound.unloadAsync().catch(() => {});
            activeSound = null;
            done();
          }
        });

        sound.playAsync().catch((e) => {
          console.error('[elevenlabs] playAsync error:', e);
          sound.unloadAsync().catch(() => {});
          activeSound = null;
          done();
        });
      })
      .catch((e) => {
        console.error('[elevenlabs] createAsync error:', e);
        activeSound = null;
        done();
      });
  });
}

async function stopActiveSound(): Promise<void> {
  const sound = activeSound;
  const done = activeSoundDone;
  activeSound = null;
  activeSoundDone = null;

  if (sound) {
    await sound.stopAsync().catch(() => {});
    await sound.unloadAsync().catch(() => {});
  }
  done?.();
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]);
    }
  }
  return btoa(binary);
}

async function playWithExpoSpeech(text: string): Promise<void> {
  return new Promise<void>((resolve) => {
    Speech.speak(text, {
      language: 'en-US',
      rate: 0.95,
      onDone: resolve,
      onError: () => resolve(),
      onStopped: () => resolve(),
    });
  });
}

async function configurePlaybackAudioMode(): Promise<void> {
  if (playbackRouteReset) {
    await playbackRouteReset;
    return;
  }
  playbackRouteReset = resetPlaybackRoute();
  await playbackRouteReset;
  playbackRouteReset = null;
}

async function resetPlaybackRoute(): Promise<void> {
  try {
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
  } catch (error) {
    console.warn('[speech] Failed to configure playback audio mode:', error);
  }
}

export const speechService = new SpeechService();
