# VisionPro

Accessibility navigation app for visually impaired users. Camera-based hazard detection, turn-by-turn walking directions, and voice-first interaction — controlled entirely by touch gestures.

---

## Features

- **Hazard detection** — Camera scanned every 3.5s via Gemini. Critical hazards (moving vehicles, open holes, head-height obstacles) interrupt speech immediately. Warnings (steps, people, bollards, puddles) are queued. Multiple hazards batched into one announcement. 10s dedup per tag.
- **ElevenLabs TTS** — Flash V2.5 for natural voice output. Phrases cached locally after first use for instant replay. Falls back to device TTS without an API key.
- **Priority speech queue** — Critical > warning > navigation > info. Max depth 3. Any gesture clears the queue instantly.
- **Turn-by-turn navigation** — OSRM routing with live GPS, automatic step advancement, approach cues at 30m/15m/7m, off-route and wrong-way detection.
- **Navigation Q&A** — Hold to ask a question during navigation. Answered using current route, recent GPS trail, and latest camera frame.
- **Voice destination input** — Speak a destination, address, or category ("nearest pharmacy"). Results read aloud for selection.
- **Favorites** — Save and re-navigate to frequent destinations.
- **Visual HUD** — High-contrast overlays for users with partial vision: mode badge, nav instructions, hazard cards, gesture hints.

---

## Gesture Controls

Single tap is always **help** — announces current mode and available gestures.

| Mode | Gesture | Action |
|------|---------|--------|
| **Explore** | Tap | Help |
| | Swipe up | Set destination by voice |
| | Swipe down | Hear current address |
| | Long press | Open favorites |
| | Two-finger tap | Toggle hazard detection |
| **Navigate** | Tap | Repeat current instruction |
| | Double tap | Stop navigation |
| | Swipe down | Hear current address |
| | Long press | Ask AI a question |
| **Destination** | Double tap | Submit |
| | Swipe left | Cancel |
| **Choose place** | Swipe right/left | Next / previous result |
| | Double tap | Start navigation |
| **Favorites** | Swipe right | Next |
| | Double tap | Navigate |
| | Swipe left | Close |

---

## AI Infrastructure — Flock

All AI calls route through **[Flock](https://flock.io)**, a UK-sovereign AI gateway built on LiteLLM. This means every camera frame, voice recording, and navigation query is processed within UK jurisdiction under UK data protection law — no US-based cloud infrastructure.

Flock exposes an OpenAI-compatible API, so the app uses a single key and a consistent request format across all three AI call types:

| Call | Trigger | Payload |
|------|---------|---------|
| Hazard detection | Every 3.5s | Camera frame (JPEG) |
| Voice transcription | After user speaks | WAV audio |
| Navigation Q&A | On hold gesture | Question + route + GPS trail + optional camera frame |

Current model: **Gemini 3 Flash Preview** via `api.flock.io/v1`.

---

## Tech Stack

| | |
|--|--|
| Framework | Expo SDK 54 (React Native 0.81) |
| Language | TypeScript (strict) |
| AI gateway | Flock (UK sovereign, LiteLLM) |
| AI model | Gemini 3 Flash Preview |
| TTS | ElevenLabs Flash V2.5 (expo-speech fallback) |
| Routing | OSRM (free, no key required) |
| Place search | Google Places API (New) |
| Camera | expo-camera |
| Location | expo-location |
| Audio | expo-audio / expo-av |
| Storage | AsyncStorage |

---

## Setup

```bash
bun install
cp .env.example .env   # fill in keys below
bunx expo start        # scan QR with Expo Go (iOS, SDK 54)
```

**Required env vars:**

```
EXPO_PUBLIC_GEMINI_API_KEY=         # Flock API key
EXPO_PUBLIC_GOOGLE_PLACES_API_KEY=  # Google Places API (New)
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=    # Google Directions API
```

**Optional:**

```
EXPO_PUBLIC_ELEVENLABS_API_KEY=     # ElevenLabs TTS (falls back to device TTS if unset)
EXPO_PUBLIC_ELEVENLABS_VOICE_ID=    # defaults to Rachel (21m00Tcm4TlvDq8ikWAM)
```

---

## Project Structure

```
App.tsx                          # Permissions, welcome message
src/
  screens/MainScreen.tsx         # Camera + HUD + gesture layer
  components/
    GestureOverlay.tsx           # Full-screen gesture detection
    StatusBar.tsx                # Visual HUD
  hooks/
    useBlindNavController.ts     # Gesture handling, mode transitions
    useHazardDetection.ts        # Camera loop + Gemini analysis
    useNavigation.ts             # GPS tracking, route following
  services/
    speech.ts                    # Priority TTS queue + ElevenLabs + cache
    gemini.ts                    # Hazard detection (vision)
    navQA.ts                     # Navigation Q&A
    voiceInput.ts                # Audio recording + transcription
    navigation.ts                # OSRM API, routing math
    places.ts                    # Google Places search
    tone.ts                      # Listen cue beep
    favorites.ts                 # Saved destinations
```
