# BlindNav

A mobile accessibility app that helps visually impaired users navigate the world using real-time camera-based hazard detection, turn-by-turn walking directions, and voice-first interaction.

Built with Expo (React Native) and powered by Google Gemini 3.1 Flash Lite for vision analysis.

## How It Works

BlindNav uses the phone's camera to continuously scan the environment for obstacles and hazards. A priority-based text-to-speech system announces dangers immediately while queuing less urgent information. Users interact entirely through full-screen gestures — no need to find buttons on screen.

For users with partial vision, a high-contrast visual HUD overlays the camera feed showing the current mode, navigation instructions, hazard alerts with color-coded severity, and contextual gesture hints.

## Features

- **Real-time hazard detection** — Camera frames are analyzed by Gemini 3.1 Flash Lite every few seconds to identify obstacles, vehicles, stairs, curbs, and surface hazards
- **Priority TTS** — Critical warnings interrupt everything; less urgent info is queued. Duplicate hazards are suppressed for 30 seconds using stable tags
- **Turn-by-turn navigation** — Walking directions via OSRM with GPS tracking, automatic step advancement, and off-route rerouting
- **Gesture-only interaction** — All controls are full-screen gestures with haptic feedback. Tapping always tells you what you can do next
- **High-contrast visual HUD** — Large text, color-coded hazard cards, mode badges, and gesture hint pills for users with partial vision
- **Favorites** — Save and quickly navigate to frequent destinations
- **Voice destination input** — Swipe up and speak where you want to go

## Gesture Controls

| Gesture | Action |
|---------|--------|
| **Tap** | Hear current status and available actions |
| **Double tap** | Start or stop navigation |
| **Swipe up** | Set a destination by voice |
| **Swipe down** | Hear your current location |
| **Swipe right** | Next item / confirm |
| **Swipe left** | Cancel / go back |
| **Long press** | Open saved favorites |
| **Two-finger tap** | Toggle hazard detection on/off |

Gestures always interrupt any ongoing speech so feedback is immediate.

## Tech Stack

| Component | Technology |
|-----------|------------|
| Framework | Expo (React Native) |
| Vision AI | Google Gemini 3.1 Flash Lite via `@ai-sdk/google` |
| Text-to-speech | `expo-speech` (native iOS/Android TTS) |
| Camera | `expo-camera` |
| Location | `expo-location` (GPS + Apple/Google geocoding) |
| Routing | OSRM public API (walking directions) |
| Haptics | `expo-haptics` |
| Gestures | `react-native-gesture-handler` |
| Storage | `@react-native-async-storage/async-storage` |

## Project Structure

```
blind-nav/
├── App.tsx                         # Entry point, permissions, welcome message
├── src/
│   ├── screens/
│   │   └── MainScreen.tsx          # Single screen — camera + overlay + mode logic
│   ├── components/
│   │   ├── GestureOverlay.tsx      # Full-screen gesture detection
│   │   └── StatusBar.tsx           # Visual HUD with hazards, hints, instructions
│   ├── services/
│   │   ├── speech.ts               # Priority TTS queue with dedup
│   │   ├── gemini.ts               # Gemini Vision API integration
│   │   ├── navigation.ts           # OSRM directions, distance/bearing math
│   │   ├── geocoding.ts            # Address <-> coordinates
│   │   └── voiceInput.ts           # Speech recognition wrapper
│   ├── hooks/
│   │   ├── useHazardDetection.ts   # Camera capture loop + Gemini analysis
│   │   └── useNavigation.ts        # GPS tracking + route following
│   ├── store/
│   │   └── favorites.ts            # Saved destinations (AsyncStorage)
│   └── types/
│       └── index.ts                # TypeScript type definitions
```

## Setup

### Prerequisites

- [Bun](https://bun.sh) (or Node.js)
- [Expo Go](https://expo.dev/go) on your iOS/Android device
- A [Google Gemini API key](https://aistudio.google.com/apikey)

### Install and Run

```bash
cd blind-nav

# Install dependencies
bun install

# Add your API keys
echo "EXPO_PUBLIC_GEMINI_API_KEY=your_gemini_key_here" > .env
echo "EXPO_PUBLIC_GOOGLE_PLACES_API_KEY=your_google_places_key_here" >> .env

# Start the dev server
bunx expo start
```

Scan the QR code with Expo Go on your device. The app requires camera and location permissions on first launch.

## Architecture Decisions

**Single screen, no navigation stack.** Screen transitions are disorienting for blind users. The app uses modes (explore, navigate, destination, favorites) controlled by gestures instead.

**Sequential hazard detection loop.** Instead of a fixed interval timer that piles up while TTS is still speaking, the loop waits for speech to finish before capturing the next frame. This prevents the backlog problem.

**Tag-based hazard dedup.** Gemini returns a stable `tag` per hazard (e.g., `stairs_ahead`, `car_left`) used for deduplication rather than trying to match free-form descriptions that vary between frames.

**Gesture interruption.** Any gesture immediately clears the speech queue and stops current speech so the user gets instant feedback, even if hazard descriptions were mid-sentence.

## License

See [LICENSE](LICENSE) for details.
