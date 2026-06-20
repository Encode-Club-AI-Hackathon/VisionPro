import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';
import type { TTSMessage, TTSPriority } from '../types';

const PRIORITY_RANK: Record<TTSPriority, number> = {
  critical: 0,
  warning: 1,
  navigation: 2,
  info: 3,
};

// Pause (ms) after speaking a message before starting the next one.
// Higher priority = shorter pause so urgent info flows faster.
const PAUSE_AFTER: Record<TTSPriority, number> = {
  critical: 400,
  warning: 800,
  navigation: 1200,
  info: 1500,
};

const MAX_QUEUE_SIZE = 6;
let playbackRouteReset: Promise<void> | null = null;

class SpeechService {
  private queue: TTSMessage[] = [];
  private isSpeaking = false;
  private currentPriority: TTSPriority | null = null;
  private currentText: string | null = null;
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;

  async speak(message: TTSMessage): Promise<void> {
    // Don't queue exact duplicate text
    if (this.currentText === message.text) return;
    if (this.queue.some((m) => m.text === message.text)) return;

    if (message.priority === 'critical') {
      // Critical: interrupt, re-queue interrupted message, then play
      const interrupted = this.captureInterrupted();
      await this.interruptInternal();
      this.queue.unshift(message);
      // Put the interrupted message back after the critical one
      if (interrupted) {
        this.insertByPriority(interrupted);
      }
    } else if (
      message.priority === 'warning' &&
      this.isSpeaking &&
      this.currentPriority != null &&
      PRIORITY_RANK[this.currentPriority] > PRIORITY_RANK['warning']
    ) {
      // Warning interrupts lower-priority speech, re-queues interrupted
      const interrupted = this.captureInterrupted();
      await this.interruptInternal();
      this.queue.unshift(message);
      if (interrupted) {
        this.insertByPriority(interrupted);
      }
    } else {
      this.insertByPriority(message);
    }

    this.trimQueue();

    if (!this.isSpeaking) {
      this.processQueue();
    }
  }

  private insertByPriority(message: TTSMessage): void {
    // Don't re-insert duplicates
    if (this.queue.some((m) => m.text === message.text)) return;

    const rank = PRIORITY_RANK[message.priority];
    let insertAt = this.queue.length;
    for (let i = 0; i < this.queue.length; i++) {
      if (PRIORITY_RANK[this.queue[i].priority] > rank) {
        insertAt = i;
        break;
      }
    }
    this.queue.splice(insertAt, 0, message);
  }

  /** Capture what's currently being spoken so it can be re-queued. */
  private captureInterrupted(): TTSMessage | null {
    if (!this.isSpeaking || !this.currentText || !this.currentPriority) return null;
    return { text: this.currentText, priority: this.currentPriority };
  }

  async speakImmediate(text: string): Promise<void> {
    await this.speak({ text, priority: 'critical' });
  }

  async speakWarning(text: string): Promise<void> {
    await this.speak({ text, priority: 'warning' });
  }

  async speakNavigation(text: string): Promise<void> {
    await this.speak({ text, priority: 'navigation' });
  }

  async speakInfo(text: string): Promise<void> {
    await this.speak({ text, priority: 'info' });
  }

  private trimQueue(): void {
    while (this.queue.length > MAX_QUEUE_SIZE) {
      this.queue.pop();
    }
  }

  private async processQueue(): Promise<void> {
    if (this.queue.length === 0) {
      this.isSpeaking = false;
      this.currentPriority = null;
      this.currentText = null;
      return;
    }

    this.isSpeaking = true;
    const message = this.queue.shift()!;
    this.currentPriority = message.priority;
    this.currentText = message.text;

    await configurePlaybackAudioMode();

    Speech.speak(message.text, {
      language: 'en-US',
      rate: 0.95,
      onDone: () => {
        // Pause before next message so the user can absorb what was said
        const pause = PAUSE_AFTER[message.priority];
        this.pauseTimer = setTimeout(() => {
          this.pauseTimer = null;
          this.processQueue().catch(() => {});
        }, pause);
      },
      onError: () => {
        this.processQueue().catch(() => {});
      },
      onStopped: () => {
        // Stopped via interrupt — don't continue, the interrupter handles it
        this.isSpeaking = false;
        this.currentPriority = null;
        this.currentText = null;
      },
    });
  }

  /** Interrupt without clearing state — used internally before re-queuing. */
  private async interruptInternal(): Promise<void> {
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
    await Speech.stop();
    this.isSpeaking = false;
    this.currentPriority = null;
    this.currentText = null;
  }

  /** Public interrupt — stops speech and clears interrupted message (gesture use). */
  async interrupt(): Promise<void> {
    await this.interruptInternal();
  }

  clearQueue(): void {
    this.queue = [];
  }

  clearNonCritical(): void {
    this.queue = this.queue.filter((m) => m.priority === 'critical');
  }

  clearInfo(): void {
    this.queue = this.queue.filter((m) => m.priority !== 'info');
  }

  get busy(): boolean {
    return this.isSpeaking || this.queue.length > 0 || this.pauseTimer != null;
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
