import * as Speech from 'expo-speech';
import type { TTSMessage, TTSPriority } from '../types';

const PRIORITY_ORDER: Record<TTSPriority, number> = {
  critical: 0,
  warning: 1,
  navigation: 2,
  info: 3,
};

class SpeechService {
  private queue: TTSMessage[] = [];
  private isSpeaking = false;
  private currentMessageId: string | null = null;
  private currentText: string | null = null;

  async speak(message: TTSMessage): Promise<void> {
    // Don't queue the same text that's currently being spoken
    if (this.currentText === message.text) return;
    // Don't queue if the same text is already waiting in the queue
    if (this.queue.some((m) => m.text === message.text)) return;

    if (message.priority === 'critical') {
      // Critical messages interrupt everything
      await this.interrupt();
      this.queue.unshift(message);
    } else {
      // Insert based on priority
      const insertIndex = this.queue.findIndex(
        (m) => PRIORITY_ORDER[m.priority] > PRIORITY_ORDER[message.priority]
      );
      if (insertIndex === -1) {
        this.queue.push(message);
      } else {
        this.queue.splice(insertIndex, 0, message);
      }
    }

    if (!this.isSpeaking) {
      await this.processQueue();
    }
  }

  async speakImmediate(text: string, priority: TTSPriority = 'critical'): Promise<void> {
    await this.speak({ text, priority });
  }

  async speakInfo(text: string): Promise<void> {
    await this.speak({ text, priority: 'info' });
  }

  async speakNavigation(text: string): Promise<void> {
    await this.speak({ text, priority: 'navigation' });
  }

  async speakWarning(text: string): Promise<void> {
    await this.speak({ text, priority: 'warning' });
  }

  private async processQueue(): Promise<void> {
    if (this.queue.length === 0) {
      this.isSpeaking = false;
      return;
    }

    this.isSpeaking = true;
    const message = this.queue.shift()!;
    this.currentMessageId = message.id ?? null;
    this.currentText = message.text;

    return new Promise<void>((resolve) => {
      Speech.speak(message.text, {
        language: 'en-US',
        rate: 0.95,
        onDone: () => {
          this.currentMessageId = null;
          this.currentText = null;
          this.processQueue().then(resolve);
        },
        onError: () => {
          this.currentMessageId = null;
          this.currentText = null;
          this.processQueue().then(resolve);
        },
        onStopped: () => {
          this.currentMessageId = null;
          this.currentText = null;
          resolve();
        },
      });
    });
  }

  async interrupt(): Promise<void> {
    await Speech.stop();
    this.isSpeaking = false;
    this.currentMessageId = null;
    this.currentText = null;
  }

  clearQueue(): void {
    this.queue = [];
  }

  clearNonCritical(): void {
    this.queue = this.queue.filter((m) => m.priority === 'critical');
  }

  get busy(): boolean {
    return this.isSpeaking || this.queue.length > 0;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  /** Returns a promise that resolves once the queue is fully drained. */
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

export const speechService = new SpeechService();
