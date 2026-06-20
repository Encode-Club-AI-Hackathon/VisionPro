import React, { useRef, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  GestureDetector,
  Gesture,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import type { GestureType } from '../types';

interface GestureOverlayProps {
  onGesture: (gesture: GestureType) => void;
  children?: React.ReactNode;
}

export default function GestureOverlay({ onGesture, children }: GestureOverlayProps) {
  const lastTapTime = useRef(0);
  const tapCount = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fireGesture = useCallback(
    (type: GestureType) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onGesture(type);
    },
    [onGesture]
  );

  // Handle single vs double tap with timing
  const handleTap = useCallback(
    (fingerCount: number) => {
      if (fingerCount === 2) {
        fireGesture('two_finger_tap');
        return;
      }

      const now = Date.now();
      if (now - lastTapTime.current < 350) {
        // Double tap
        tapCount.current = 0;
        if (tapTimer.current) {
          clearTimeout(tapTimer.current);
          tapTimer.current = null;
        }
        fireGesture('double_tap');
      } else {
        // Potential single tap - wait to see if double tap follows
        tapCount.current = 1;
        lastTapTime.current = now;
        tapTimer.current = setTimeout(() => {
          if (tapCount.current === 1) {
            fireGesture('single_tap');
          }
          tapCount.current = 0;
        }, 350);
      }
    },
    [fireGesture]
  );

  const tap = Gesture.Tap()
    .maxDuration(500)
    .numberOfTaps(1)
    .onEnd((_event, success) => {
      if (success) {
        handleTap(1);
      }
    })
    .runOnJS(true);

  const twoFingerTap = Gesture.Tap()
    .numberOfTaps(1)
    .minPointers(2)
    .onEnd((_event, success) => {
      if (success) {
        handleTap(2);
      }
    })
    .runOnJS(true);

  const longPress = Gesture.LongPress()
    .minDuration(600)
    .onEnd((_event, success) => {
      if (success) {
        fireGesture('long_press');
      }
    })
    .runOnJS(true);

  const swipe = Gesture.Pan()
    .minDistance(50)
    .onEnd((event) => {
      const { translationX, translationY } = event;
      const absX = Math.abs(translationX);
      const absY = Math.abs(translationY);

      if (absX > absY) {
        // Horizontal swipe
        if (translationX > 0) {
          fireGesture('swipe_right');
        } else {
          fireGesture('swipe_left');
        }
      } else {
        // Vertical swipe
        if (translationY > 0) {
          fireGesture('swipe_down');
        } else {
          fireGesture('swipe_up');
        }
      }
    })
    .runOnJS(true);

  const composed = Gesture.Race(twoFingerTap, longPress, swipe, tap);

  return (
    <GestureHandlerRootView style={styles.container}>
      <GestureDetector gesture={composed}>
        <View style={styles.overlay}>
          {children}
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },
  overlay: {
    flex: 1,
  },
});
