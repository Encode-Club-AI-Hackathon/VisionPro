# Agent Guidelines for VisionPro

## Before Writing Any Code

1. Read the file you're modifying first. The codebase has been heavily iterated and files may differ from what you expect.
2. Check the system reminders in the conversation — they contain the latest file contents when the user has made manual edits.
3. Run `bunx tsc --noEmit` after every change to catch type errors.

## Expo SDK 54 Constraints

This project runs on **Expo SDK 54** (not the latest) because the iOS Expo Go app only supports SDK 54. Do not:
- Upgrade Expo or React Native versions
- Use APIs that were added after SDK 54
- Reference `expo/tsconfig.base` module options that require TS 6+

If you need to check an Expo API, read the type definitions in `node_modules/expo-*/build/*.d.ts` rather than assuming the latest docs apply.

## Speech Service Rules

The speech service (`src/services/speech.ts`) is the most critical piece of the app. Follow these rules:

1. **Never fire-and-forget speech.** If you call `speechService.speakInfo()` etc., understand that it may be dropped if the queue is full or the text is a duplicate.
2. **Urgent messages interrupt.** `speakImmediate()` and `speakWarning()` will stop current speech. Only use for genuinely urgent content.
3. **Navigation text is rate-limited.** The same navigation text won't repeat within 5 seconds. Don't try to work around this.
4. **Gestures clear the queue.** The gesture handler in `useBlindNavController.ts` calls `clearQueue()` + `interrupt()` before every gesture action. Any speech you queued may be wiped.
5. **After recording audio, you must reset the audio mode** (`allowsRecordingIOS: false`) or TTS will be silent.

## Hazard Detection Rules

The hazard detection system (`useHazardDetection.ts` + `gemini.ts`) runs on a fixed 5-second interval:

1. **Do not make it wait for TTS.** The scan loop is intentionally decoupled from speech.
2. **Do not remove the `isAnalyzing` guard.** It prevents overlapping Gemini calls if a response takes longer than 5 seconds.
3. **Camera capture failures are expected.** The camera can be busy. Silently skip, never throw.
4. **The Gemini prompt is carefully tuned.** It only asks for immediate, actionable hazards — no scenery, no distant objects, no parked cars. Don't add "info" severity back to the prompt.
5. **Tag-based dedup** — Gemini returns a `tag` field (e.g., `stairs_ahead`) used for 30-second dedup. The description text is NOT used for matching because Gemini rephrases it differently each frame.

## Navigation Rules

The navigation system (`useNavigation.ts` + `navigation.ts`) is complex. Key things to know:

1. **Mutable state lives in refs**, not `useState`. This is intentional — `watchPositionAsync` callbacks would capture stale state otherwise.
2. **`startNavigationRef`** breaks the circular dependency between `startNavigation` and `handleLocationUpdate` (rerouting needs to call startNavigation).
3. **`navGenRef`** is a generation counter that prevents race conditions when multiple `startNavigation` calls overlap.
4. **Wrong-way detection** uses a scoring system with smoothed travel bearing computed from position history. Don't simplify this to raw GPS heading — it's too noisy.
5. **Step advancement** uses both waypoint proximity AND polyline progress for robustness.
6. **OSRM is the routing backend** (free, no API key). Don't replace with a paid service without asking.

## Gesture System Rules

All gestures are handled in `useBlindNavController.ts`:

1. **Every gesture case must produce speech.** A silent gesture is a broken gesture for blind users.
2. **Mode transitions must be explicit.** Always call `setMode()` when changing modes.
3. **The `select_destination` mode** is for choosing between multiple search results (swipe left/right to cycle, double tap to confirm, long press to cancel).
4. **Don't add new gesture types** without updating both `GestureOverlay.tsx` (detection) and `StatusBar.tsx` (hint pills).

## Google Places Integration

Destination search (`places.ts`) uses the **Google Places API (New)** — not the legacy Places API:

1. Uses `places:searchText` and `places:searchNearby` endpoints
2. Auth via `X-Goog-Api-Key` header (not query param)
3. Field mask controls response size — only request fields you need
4. Category detection (pharmacy, cafe, etc.) routes to `searchNearby` with `includedTypes` for better results

## Testing

There are no automated tests yet. To verify changes:

1. `bunx tsc --noEmit` — must pass with zero errors
2. `bunx expo start` — must launch without crashes
3. Test on a real iOS device with Expo Go for camera/speech/location features
4. Simulator can test gesture handling and UI layout but not camera or TTS
