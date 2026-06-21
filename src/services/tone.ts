import AudioModule from 'expo-audio/build/AudioModule';
import type { AudioStatus } from 'expo-audio';

let tonePlayer: InstanceType<typeof AudioModule.AudioPlayer> | null = null;

export async function playTone(): Promise<void> {
  try {
    tonePlayer?.remove();
    tonePlayer = new AudioModule.AudioPlayer({ uri: generateBeepDataUri() }, 100, false);
    tonePlayer.play();

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 500);
      const sub = tonePlayer!.addListener('playbackStatusUpdate', (status: AudioStatus) => {
        if (status.didJustFinish) {
          clearTimeout(timeout);
          sub.remove();
          resolve();
        }
      });
    });
  } catch {
    // Tone is non-critical, just continue
  }
}

function generateBeepDataUri(): string {
  const sampleRate = 8000;
  const duration = 0.25; // seconds
  const frequency = 880; // A5
  const numSamples = Math.floor(sampleRate * duration);

  const dataSize = numSamples * 2; // 16-bit samples
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

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.max(0, 1 - (i / numSamples) * 2);
    const sample = Math.sin(2 * Math.PI * frequency * t) * envelope * 0.5;
    view.setInt16(44 + i * 2, Math.floor(sample * 32767), true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return 'data:audio/wav;base64,' + btoa(binary);
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
