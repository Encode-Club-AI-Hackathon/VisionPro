import { Audio } from 'expo-av';
import { generateText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const flock = createOpenAICompatible({
  name: 'flock',
  baseURL: 'https://api.flock.io/v1',
  headers: {
    'x-litellm-api-key': process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '',
  },
});

const model = flock('gemini-3-flash-preview');

let isListening = false;
let recording: Audio.Recording | null = null;
let onResultCallback: ((text: string) => void) | null = null;
let onErrorCallback: ((error: string) => void) | null = null;

export async function startListening(
  onResult: (text: string) => void,
  onError: (error: string) => void
): Promise<void> {
  // Force-unload any stale recording from a previous session. cancelListening fires
  // stopAndUnloadAsync asynchronously, so the native audio session may still be active
  // when a new session starts — causing an "already recording" error from Expo Audio.
  if (recording) {
    await recording.stopAndUnloadAsync().catch(() => {});
    recording = null;
  }
  isListening = false;
  onResultCallback = null;
  onErrorCallback = null;

  onResultCallback = onResult;
  onErrorCallback = onError;

  try {
    const { granted } = await Audio.requestPermissionsAsync();
    if (!granted) {
      onError('Microphone permission not granted');
      return;
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      playThroughEarpieceAndroid: false,
    });

    recording = new Audio.Recording();
    await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    await recording.startAsync();
    isListening = true;
  } catch (err) {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      playThroughEarpieceAndroid: false,
    }).catch(() => {});
    onError(`Failed to start recording: ${err}`);
    cleanup();
  }
}

export async function stopListeningAndSubmit(): Promise<void> {
  if (!isListening || !recording) {
    onErrorCallback?.('Not currently listening');
    cleanup();
    return;
  }

  try {
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    if (!uri) {
      onErrorCallback?.('No audio recorded');
      cleanup();
      return;
    }

    // Reset audio mode so TTS works again
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      playThroughEarpieceAndroid: false,
    });

    // Read audio file as base64
    const response = await fetch(uri);
    const blob = await response.blob();
    const base64 = await blobToBase64(blob);

    // Send to Gemini for transcription
    const { text } = await generateText({
      model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Transcribe this audio. The user is speaking a destination or address. Return ONLY the transcribed text, nothing else. No quotes, no explanation.',
            },
            {
              type: 'file' as const,
              data: base64,
              mediaType: 'audio/mp4' as const,
            },
          ],
        },
      ],
      temperature: 0,
    });

    const trimmed = text.trim();
    if (trimmed) {
      onResultCallback?.(trimmed);
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
  if (recording && isListening) {
    recording.stopAndUnloadAsync().catch(() => {});
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      playThroughEarpieceAndroid: false,
    }).catch(() => {});
  }
  cleanup();
}

export function getIsListening(): boolean {
  return isListening;
}

function cleanup(): void {
  isListening = false;
  recording = null;
  onResultCallback = null;
  onErrorCallback = null;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data:...;base64, prefix
      const base64 = result.split(',')[1] ?? result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
