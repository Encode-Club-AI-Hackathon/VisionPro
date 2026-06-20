import { Audio } from 'expo-av';

let isListening = false;

export async function requestMicrophonePermission(): Promise<boolean> {
  const { granted } = await Audio.requestPermissionsAsync();
  return granted;
}

// Note: Expo doesn't have a built-in speech recognition module.
// On iOS, we use a workaround: record audio and send to a speech-to-text service,
// or use the native SFSpeechRecognizer via a custom native module.
// For this implementation, we provide a simulated voice input that can be
// replaced with a real speech recognition integration.

type VoiceResultCallback = (text: string) => void;
type VoiceErrorCallback = (error: string) => void;

let onResultCallback: VoiceResultCallback | null = null;
let onErrorCallback: VoiceErrorCallback | null = null;

export function startListening(
  onResult: VoiceResultCallback,
  onError: VoiceErrorCallback
): void {
  if (isListening) return;
  isListening = true;
  onResultCallback = onResult;
  onErrorCallback = onError;

  // In production, this would hook into iOS SFSpeechRecognizer
  // or a cloud speech-to-text API via audio recording.
  // For now, we set up the audio session for recording.
  setupAudioSession().catch((err) => {
    onError(`Failed to start voice input: ${err}`);
    isListening = false;
  });
}

export function stopListening(): void {
  isListening = false;
  onResultCallback = null;
  onErrorCallback = null;
}

export function getIsListening(): boolean {
  return isListening;
}

// Simulate voice input result for testing
export function simulateVoiceResult(text: string): void {
  if (onResultCallback) {
    onResultCallback(text);
  }
  stopListening();
}

async function setupAudioSession(): Promise<void> {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
  });
}
