import type { AudioRecorder } from 'expo-audio';
import {
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import AudioModule from 'expo-audio/build/AudioModule';

import { generateText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

// ── Flock proxy ──────────────────────────────────────────────────────────────
const flock = createOpenAICompatible({
  name: 'flock',
  baseURL: 'https://api.flock.io/v1',
  headers: { 'x-litellm-api-key': process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '' },
});
const model = flock('gemini-3-flash-preview');

// ── Direct Gemini API (commented out — swap fetch blocks below to use) ────────
// const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
// const GEMINI_MODEL = 'gemini-3.1-flash-lite';

const WAV_OPTIONS = {
  ios: {
    extension: '.wav',
    outputFormat: IOSOutputFormat.LINEARPCM,
    audioQuality: AudioQuality.HIGH,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 128000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  android: {
    extension: '.wav',
    outputFormat: 'default' as const,
    audioEncoder: 'default' as const,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 128000,
  },
  web: {},
  isMeteringEnabled: false,
};

let isListening = false;
let recorder: AudioRecorder | null = null;
let onResultCallback: ((text: string) => void) | null = null;
let onErrorCallback: ((error: string) => void) | null = null;

export async function startListening(
  onResult: (text: string) => void,
  onError: (error: string) => void
): Promise<void> {
  if (recorder) {
    await recorder.stop().catch(() => {});
    recorder = null;
  }
  isListening = false;
  onResultCallback = null;
  onErrorCallback = null;

  onResultCallback = onResult;
  onErrorCallback = onError;

  try {
    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) {
      onError('Microphone permission not granted');
      return;
    }

    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });

    recorder = new AudioModule.AudioRecorder(WAV_OPTIONS);
    await recorder.prepareToRecordAsync();
    recorder.record();
    isListening = true;
  } catch (err) {
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    onError(`Failed to start recording: ${err}`);
    cleanup();
  }
}

export async function stopListeningAndSubmit(): Promise<void> {
  if (!isListening || !recorder) {
    onErrorCallback?.('Not currently listening');
    cleanup();
    return;
  }

  try {
    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) {
      onErrorCallback?.('No audio recorded');
      cleanup();
      return;
    }

    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });

    const response = await fetch(uri);
    const blob = await response.blob();
    const base64 = await blobToBase64(blob);

    // ── Flock proxy ────────────────────────────────────────────────────────
    const { text: rawText } = await generateText({
      model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Transcribe this audio. The user is speaking a destination, address, or question. Return ONLY the transcribed text, nothing else. No quotes, no explanation.',
            },
            { type: 'file' as const, data: base64, mediaType: 'audio/wav' as const },
          ],
        },
      ],
      temperature: 0,
    });
    const text = rawText.trim();

    // ── Direct Gemini API (commented out) ─────────────────────────────────
    // const res = await fetch(
    //   `${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent?key=${process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? ''}`,
    //   {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify({
    //       contents: [{
    //         parts: [
    //           { text: 'Transcribe this audio. The user is speaking a destination, address, or question. Return ONLY the transcribed text, nothing else. No quotes, no explanation.' },
    //           { inline_data: { mime_type: 'audio/wav', data: base64 } },
    //         ],
    //       }],
    //       generationConfig: { temperature: 0, maxOutputTokens: 256 },
    //     }),
    //   }
    // );
    // if (!res.ok) throw new Error(`gemini ${res.status}: ${await res.text().catch(() => '')}`);
    // const json = await res.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
    // const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';

    if (text) {
      onResultCallback?.(text);
    } else {
      onErrorCallback?.('Could not understand the audio. Please try again.');
    }
  } catch (err) {
    onErrorCallback?.(`Voice recognition failed: ${err}`);
  } finally {
    cleanup();
  }
}

export function cancelListening(): void {
  if (recorder && isListening) {
    recorder.stop().catch(() => {});
    setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
  }
  cleanup();
}

export function getIsListening(): boolean {
  return isListening;
}

function cleanup(): void {
  isListening = false;
  recorder = null;
  onResultCallback = null;
  onErrorCallback = null;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] ?? result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
