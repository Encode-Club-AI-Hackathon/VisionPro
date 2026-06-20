import * as Speech from 'expo-speech';
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

  private processQueue(): void {
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

    Speech.speak(message.text, {
      language: 'en-US',
      rate: 0.95,
      onDone: () => {
        // Pause before next message so the user can absorb what was said
        const pause = PAUSE_AFTER[message.priority];
        this.pauseTimer = setTimeout(() => {
          this.pauseTimer = null;
          this.processQueue();
        }, pause);
      },
      onError: () => {
        this.processQueue();
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

export const speechService = new SpeechService();
