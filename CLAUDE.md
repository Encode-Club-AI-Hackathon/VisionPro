@AGENTS.md

# VisionPro

Accessibility navigation app for visually impaired users. Single-screen Expo React Native app using camera-based hazard detection, turn-by-turn navigation, and voice-first interaction.

## Quick Reference

- **Runtime**: Expo SDK 54, React Native 0.81, React 19
- **Language**: TypeScript (strict mode)
- **Package manager**: Bun (`bun install`, `bun run`)
- **Dev server**: `bunx expo start`
- **Type check**: `bunx tsc --noEmit`
- **Target**: iOS via Expo Go

## Env Vars

All env vars must be prefixed with `EXPO_PUBLIC_` to be accessible in client code:

- `EXPO_PUBLIC_GEMINI_API_KEY` — Google Gemini API key (hazard detection + voice transcription)
- `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` — Google Places API (New) key (destination search)

## Architecture

Single screen, no navigation stack. Mode-driven (`explore`, `navigate`, `destination`, `select_destination`, `favorites`). All interaction through full-screen gestures — no buttons.

### Key Patterns

- **Speech is the primary output.** Every user action must produce spoken feedback. Never leave the user in silence.
- **Gestures interrupt speech.** Any gesture clears the speech queue and stops current speech before handling the action.
- **Hazard detection runs on a fixed 5s interval**, decoupled from TTS. The speech queue handles prioritization.
- **Speech queue has a max size of 3.** Urgent items jump to front. Duplicates are dropped. Navigation text is rate-limited to prevent repeats.
- **Tag-based hazard dedup.** Gemini returns a stable `tag` per hazard used for 30s dedup, not the description text.
- **Navigation uses refs for mutable state** (route, step index, position history) to avoid stale closure issues in `watchPositionAsync` callbacks. Only UI-bound values use `useState`.

### File Roles

| File | Responsibility |
|------|---------------|
| `App.tsx` | Permissions, welcome message |
| `MainScreen.tsx` | Camera + StatusBar + GestureOverlay composition |
| `useBlindNavController.ts` | All gesture handling and mode transitions |
| `useHazardDetection.ts` | 5s camera capture loop + Gemini analysis |
| `useNavigation.ts` | GPS tracking, OSRM route following, wrong-way detection |
| `speech.ts` | Priority TTS queue with dedup and rate limiting |
| `gemini.ts` | Gemini vision API for hazard detection |
| `voiceInput.ts` | Audio recording + Gemini transcription |
| `places.ts` | Google Places (New) API for destination search |
| `navigation.ts` | OSRM API, distance/bearing math, polyline utilities |
| `tone.ts` | Programmatic WAV beep generation |
| `favorites.ts` | AsyncStorage CRUD |

## UX Rules

- **Never add screen transitions.** Single screen only. Modes are controlled by gestures.
- **Every gesture must produce immediate spoken feedback.** If a gesture triggers an async operation, speak an acknowledgment first ("Searching...", "Calculating route...").
- **Tap always means "help".** Single tap tells the user their current mode and available gestures.
- **Keep spoken text concise.** Users can't re-read; they have to listen to the whole thing.
- **Hazard prompt should only report immediate, actionable blockers.** No parked cars, distant objects, background scenery, or generic caution.
- **Audio mode must be reset after recording.** `allowsRecordingIOS: false` must be set before TTS will work after voice input.

## Common Pitfalls

- `StyleSheet.absoluteFillObject` doesn't exist in this RN version — use explicit `position: 'absolute', top: 0, left: 0, right: 0, bottom: 0`.
- `expo-camera` `takePictureAsync` can throw "Image could not be captured" if the camera is busy — always wrap in try/catch and silently skip.
- The `watchPositionAsync` callback captures closure values at subscription time. Use refs for anything that changes during navigation.
- `expo/tsconfig.base` may reference module options unsupported by the installed TS version. The project uses a custom `tsconfig.json` that doesn't extend it directly (though it's listed, `skipLibCheck: true` handles conflicts).
