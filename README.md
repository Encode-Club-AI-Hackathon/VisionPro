# VisionPro

A mobile accessibility app that helps visually impaired users navigate the world using real-time camera-based hazard detection, turn-by-turn walking directions, and voice-first interaction — controlled entirely by touch gestures, no screen-reading required.

Built with Expo (React Native) and powered by Google Gemini for vision analysis and voice transcription.

---

## How It Works

VisionPro uses the phone's back camera to continuously scan the environment every 3 seconds. A priority-based text-to-speech system announces dangers immediately while queuing less urgent information. Users interact entirely through full-screen gestures — no buttons to find, no screen to read.

For users with partial vision, a high-contrast visual HUD overlays the camera feed showing the current mode, navigation instructions, hazard alerts, and contextual gesture hints.

---

## Features

- **Real-time hazard detection** — Camera frames are analyzed by Gemini every 3.5 seconds in both explore and navigation modes. Hazards are classified as critical (stop now) or warning (steer around): moving vehicles, open holes, head-height obstacles, steps, kerb drops, people blocking the path, bollards, puddles, and more. Duplicate hazards are suppressed for 10 seconds using stable AI-assigned tags. Multiple simultaneous hazards are batched into a single announcement.

- **ElevenLabs TTS** — Speech is synthesised using ElevenLabs Flash V2.5 for natural, low-latency voice output. Phrases are cached locally on first use so repeated announcements (navigation instructions, common prompts) play instantly from disk with no API call. Falls back to the device's built-in speech engine if no ElevenLabs key is configured.

- **Priority text-to-speech queue** — Critical warnings interrupt everything instantly. Navigation instructions, warnings, and info are queued separately with a max depth of 3. The same text won't repeat within 5 seconds. Any gesture clears the queue and stops speech immediately.

- **Turn-by-turn walking navigation** — Walking directions from Google Maps with live GPS tracking, automatic step advancement, approach prompts at 30m / 15m / 7m, off-route detection, wrong-way detection, and periodic progress updates.

- **Navigation Q&A** — During navigation, hold the screen to ask a question. The AI answers using your current route, recent GPS movement, and the latest camera frame. Visual questions ("what do I see?") use the camera. Navigation questions ("which way?") use the route steps.

- **Voice destination input** — Swipe up and speak your destination. Supports addresses, place names, and categories (e.g. "nearest pharmacy"). Results are read aloud one by one for selection.

- **Gesture-only interaction** — All controls are full-screen gestures with haptic feedback. Single tap always tells you exactly what you can do in the current mode.

- **Favorites** — Save and quickly re-navigate to frequent destinations.

- **High-contrast visual HUD** — Large text, color-coded hazard cards, mode badges, and gesture hint pills for users with partial vision.

---

## Gesture Controls

**Single tap is always the help gesture** — it announces your current mode and all available actions for that mode.

### Explore mode (default)

| Gesture | Action |
|---------|--------|
| **Tap** | Hear mode, hazard status, and all available gestures |
| **Swipe up** | Set a destination by voice |
| **Swipe down** | Hear your current address |
| **Long press** | Open saved favorites |
| **Two-finger tap** | Toggle hazard detection on/off |

### Navigation mode

| Gesture | Action |
|---------|--------|
| **Tap** | Repeat current instruction and available gestures |
| **Double tap** | Stop navigation and return to explore mode |
| **Swipe down** | Hear your current address |
| **Hold** | Ask the AI a question (release to speak, double tap when done) |

> When off-route, double tap confirms rerouting.

### Listening for destination

| Gesture | Action |
|---------|--------|
| **Tap** | Hear prompt again |
| **Double tap** | Submit what you said |
| **Swipe left** | Cancel and return to explore mode |

### Choosing a destination

| Gesture | Action |
|---------|--------|
| **Tap** | Hear the current result again |
| **Swipe right** | Next result |
| **Swipe left** | Previous result |
| **Double tap** | Start navigation to selected destination |
| **Long press** | Repeat the current option |

### Asking a question (during navigation)

| Gesture | Action |
|---------|--------|
| **Tap** | Hear prompt again |
| **Double tap** | Submit your question |
| **Swipe left** | Cancel and return to navigation |

### Favorites

| Gesture | Action |
|---------|--------|
| **Tap** | Hear the current favorite |
| **Swipe right** | Next favorite |
| **Double tap** | Navigate to selected favorite |
| **Swipe left** | Close favorites |

---

## Haptic Feedback

Every gesture triggers a haptic response so you know it registered. Long press has a distinct double-bump haptic at the moment the threshold is crossed (while your finger is still down), then executes when you lift.

---

## AI Infrastructure — Flock

All AI inference in VisionPro routes through **[Flock](https://flock.io)**, a UK-based sovereign AI gateway. This means every AI call the app makes — hazard detection, voice transcription, navigation Q&A — is processed within UK jurisdiction rather than passing through US-based cloud infrastructure.

Flock exposes an OpenAI-compatible API (powered by LiteLLM under the hood), which lets us use the Vercel AI SDK's `@ai-sdk/openai-compatible` adapter and swap or mix models without changing application code. The app currently uses `gemini-3-flash-preview` routed through Flock's endpoint at `api.flock.io/v1`.

```
User action → App (Expo / React Native)
                ↓
          Flock API (UK sovereign gateway)
                ↓
         Gemini 3 Flash Preview
                ↓
           Response back to app
```

**Why this matters for accessibility.** VisionPro is built for users in the UK. Routing AI calls through UK-sovereign infrastructure means user data — camera frames, voice recordings, location context — is processed under UK data protection law and never leaves UK jurisdiction. For a health and accessibility product this is a meaningful compliance and trust consideration.

**The three AI call types:**

| Call | Trigger | What's sent |
|------|---------|-------------|
| Hazard detection | Every 3 seconds | Camera frame (JPEG) |
| Voice transcription | After user speaks | WAV audio recording |
| Navigation Q&A | On hold gesture | Question + route steps + GPS trail + optional camera frame |

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Framework | Expo SDK 54 (React Native 0.81) |
| Language | TypeScript (strict) |
| Package manager | Bun |
| AI gateway | Flock (UK sovereign, LiteLLM-based) |
| AI model | Google Gemini 3 Flash Preview via `@ai-sdk/openai-compatible` |
| Text-to-speech | ElevenLabs (with expo-speech fallback) |
| Camera | `expo-camera` |
| Location | `expo-location` (GPS + reverse geocoding) |
| Routing | Google Maps Directions API (walking) |
| Place search | Google Places API (New) |
| Audio recording | `expo-audio` |
| Haptics | `expo-haptics` |
| Gestures | `react-native-gesture-handler` |
| Storage | `@react-native-async-storage/async-storage` |

---

## Project Structure

```
├── App.tsx                          # Entry point, permissions, welcome message
└── src/
    ├── screens/
    │   └── MainScreen.tsx           # Single screen — camera + HUD + gesture layer
    ├── components/
    │   ├── GestureOverlay.tsx       # Full-screen gesture detection (RNGH)
    │   └── StatusBar.tsx            # Visual HUD: mode badge, instructions, hazard cards, hints
    ├── hooks/
    │   ├── useVisionProController.ts # All gesture handling and mode transitions
    │   ├── useHazardDetection.ts    # 3s camera capture loop + Gemini analysis
    │   └── useNavigation.ts         # GPS tracking, route following, wrong-way detection
    ├── services/
    │   ├── speech.ts                # Priority TTS queue with dedup and rate limiting
    │   ├── gemini.ts                # Gemini Vision API — hazard detection
    │   ├── navQA.ts                 # Navigation Q&A — answers questions using route + GPS + camera
    │   ├── navContext.ts            # Circular buffers: last 5 camera frames, last 10 GPS points
    │   ├── voiceInput.ts            # Audio recording (WAV) + Gemini transcription
    │   ├── navigation.ts            # Google Directions API, distance/bearing math, polyline utils
    │   ├── places.ts                # Google Places API (New) — destination search
    │   ├── tone.ts                  # Programmatic WAV beep (listen cue)
    │   └── favorites.ts             # AsyncStorage CRUD for saved destinations
    ├── store/
    │   └── favorites.ts             # Saved destinations (AsyncStorage)
    └── types/
        └── index.ts                 # Shared TypeScript types
```

---

## Setup

### Prerequisites

- [Bun](https://bun.sh)
- [Expo Go](https://expo.dev/go) on your iOS device (SDK 54)
- A Google Gemini API key — [get one at aistudio.google.com](https://aistudio.google.com/apikey)
- A Google Cloud API key with **Places API (New)** and **Directions API** enabled

### Install and run

```bash
# Install dependencies
bun install

# Create your environment file
cp .env.example .env
# Then fill in your keys:
#   EXPO_PUBLIC_GEMINI_API_KEY=...
#   EXPO_PUBLIC_GOOGLE_PLACES_API_KEY=...
#   EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=...

# Start the dev server
bunx expo start
```

Scan the QR code with Expo Go on your iOS device. The app requests camera, microphone, and location permissions on first launch.

> **Note:** This project targets Expo SDK 54 because that is the version supported by the Expo Go iOS app. Do not upgrade Expo or React Native versions.

---

## Architecture Decisions

**Single screen, no navigation stack.** Screen transitions are disorienting for blind users. The app uses modes (`explore`, `navigate`, `destination`, `select_destination`, `asking`, `favorites`) controlled entirely by gestures.

**Fixed 3-second hazard scan interval.** The scan loop runs independently of TTS on a fixed 3s interval. This keeps environmental awareness consistent regardless of how long speech takes.

**Tag-based hazard deduplication.** Gemini returns a stable `tag` per hazard (e.g., `stairs_ahead`, `car_left`) reused across frames. Dedup is based on the tag, not the description text, because Gemini rephrases descriptions slightly each frame.

**Gesture interruption.** Any gesture immediately clears the speech queue and stops current speech so the user gets instant feedback, even if hazard descriptions are mid-sentence.

**Refs for navigation state.** All mutable navigation state (route, step index, position history) lives in refs rather than `useState` to avoid stale closure issues inside `watchPositionAsync` callbacks.

**Navigation Q&A context buffers.** A circular buffer keeps the last 5 camera frames and last 10 GPS points in memory. When the user asks a question during navigation, the AI receives the current route, recent movement, and (for visual questions) the latest camera frame.

**Visual questions vs. navigation questions.** The Q&A system detects whether a question is about the visual environment or about route/direction using keyword matching. Visual questions attach the last camera frame; navigation questions use route steps alone — mixing them caused the model to return empty responses.

**Flock as a single AI entrypoint.** Rather than calling Gemini directly, all three AI paths (hazard detection, transcription, Q&A) go through the same Flock gateway using a single API key and a consistent request format. This makes it straightforward to swap models, add rate limiting, or audit usage centrally — and keeps every AI call within UK jurisdiction.

---

## License

See [LICENSE](LICENSE) for details.
