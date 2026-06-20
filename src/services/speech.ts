import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';
import type { TTSMessage } from '../types';

const MIN_NAV_REPEAT_MS = 5_000;
const MIN_PROMPT_REPEAT_MS = 2_000;
const MAX_QUEUE_SIZE = 3;
let playbackRouteReset: Promise<void> | null = null;

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
    this.processQueue().catch(() => {});
  }

  async speakWarning(text: string): Promise<void> {
    await this.enqueue(text, true);
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
      this.processQueue().catch(() => {});
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

    Speech.speak(item.text, {
      language: 'en-US',
      rate: 0.95,
      onDone: () => {
        this.currentText = null;
        this.processQueue().catch(() => {});
      },
      onError: () => {
        this.currentText = null;
        this.processQueue().catch(() => {});
      },
      onStopped: () => {
        this.isSpeaking = false;
        this.currentText = null;
      },
    });
  }

  async interrupt(): Promise<void> {
    await Speech.stop();
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
        if (!this.busy) {
          resolve();
        } else {
          setTimeout(check, 200);
        }
      };
      check();
    });
  }
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
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      playThroughEarpieceAndroid: false,
    });
    await primeExpoPlaybackSession();
  } catch (error) {
    console.warn('Failed to configure playback audio mode:', error);
  }
}

async function primeExpoPlaybackSession(): Promise<void> {
  let sound: Audio.Sound | null = null;

  try {
    const result = await Audio.Sound.createAsync(
      { uri: getSilentWavDataUri() },
      { shouldPlay: true, volume: 0 }
    );
    sound = result.sound;

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 120);
      sound?.setOnPlaybackStatusUpdate((status) => {
        if ('didJustFinish' in status && status.didJustFinish) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
  } finally {
    await sound?.unloadAsync().catch(() => {});
  }
}

function getSilentWavDataUri(): string {
  const sampleRate = 8000;
  const duration = 0.05;
  const numSamples = Math.floor(sampleRate * duration);
  const dataSize = numSamples * 2;
  const fileSize = 44 + dataSize;
  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, fileSize - 8, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return 'data:audio/wav;base64,' + btoa(binary);
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

export const speechService = new SpeechService();
