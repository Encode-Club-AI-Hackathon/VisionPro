import { Audio } from 'expo-av';

let toneSound: Audio.Sound | null = null;

export async function playTone(): Promise<void> {
  try {
    // Generate a short beep using a sine wave buffer
    // expo-av can play from a URI, so we use a data URI with a WAV beep
    if (toneSound) {
      await toneSound.unloadAsync();
    }

    const { sound } = await Audio.Sound.createAsync(
      { uri: generateBeepDataUri() },
      { shouldPlay: true, volume: 0.8 }
    );
    toneSound = sound;

    // Wait for it to finish
    await new Promise<void>((resolve) => {
      sound.setOnPlaybackStatusUpdate((status) => {
        if ('didJustFinish' in status && status.didJustFinish) {
          resolve();
        }
      });
      // Fallback timeout in case callback doesn't fire
      setTimeout(resolve, 500);
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

  // Build WAV file in memory
  const dataSize = numSamples * 2; // 16-bit samples
  const fileSize = 44 + dataSize;
  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  // WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, fileSize - 8, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Generate sine wave with fade out
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.max(0, 1 - (i / numSamples) * 2); // fade out
    const sample = Math.sin(2 * Math.PI * frequency * t) * envelope * 0.5;
    view.setInt16(44 + i * 2, Math.floor(sample * 32767), true);
  }

  // Convert to base64 data URI
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
