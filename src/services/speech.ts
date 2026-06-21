import * as Speech from 'expo-speech';
import { setAudioModeAsync } from 'expo-audio';
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
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
  } catch (error) {
    console.warn('Failed to configure playback audio mode:', error);
  }
}


export const speechService = new SpeechService();
