import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { AppMode } from '../types';

interface StatusBarProps {
  mode: AppMode;
  hazardDetectionEnabled: boolean;
  isNavigating: boolean;
  currentInstruction?: string;
  remainingDistance?: number;
  lastGesture?: string;
}

const MODE_LABELS: Record<AppMode, string> = {
  explore: 'EXPLORE',
  navigate: 'NAVIGATING',
  destination: 'SET DESTINATION',
  select_destination: 'CHOOSE PLACE',
  favorites: 'FAVORITES',
};

const MODE_COLORS: Record<AppMode, string> = {
  explore: '#2980b9',
  navigate: '#27ae60',
  destination: '#8e44ad',
  select_destination: '#d35400',
  favorites: '#f39c12',
};

function formatDistance(meters: number): string {
  if (meters < 100) return `${Math.round(meters)}m`;
  if (meters < 1000) return `${Math.round(meters / 10) * 10}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

const GESTURE_HINTS: Record<AppMode, string[]> = {
  explore: [
    'TAP = Help',
    'SWIPE UP = Destination',
    'SWIPE DOWN = Location',
    'HOLD = Favorites',
  ],
  navigate: [
    'TAP = Repeat',
    'DOUBLE TAP = Stop',
    'SWIPE DOWN = Location',
  ],
  destination: [
    'Speak your destination',
    'DOUBLE TAP = Done',
    'SWIPE LEFT = Cancel',
  ],
  select_destination: [
    'SWIPE RIGHT = Next',
    'SWIPE LEFT = Previous',
    'DOUBLE TAP = Choose',
    'HOLD = Cancel',
  ],
  favorites: [
    'SWIPE RIGHT = Next',
    'DOUBLE TAP = Go',
    'SWIPE LEFT = Back',
  ],
};

export default function StatusBar({
  mode,
  hazardDetectionEnabled,
  isNavigating,
  currentInstruction,
  remainingDistance,
  lastGesture,
}: StatusBarProps) {
  return (
    <View style={styles.container} pointerEvents="none">
      {/* Top: Mode + status badges */}
      <View style={styles.topBar}>
        <View style={[styles.modeBadge, { backgroundColor: MODE_COLORS[mode] }]}>
          <Text style={styles.modeText}>{MODE_LABELS[mode]}</Text>
        </View>
        <View style={styles.statusRow}>
          {hazardDetectionEnabled && (
            <View style={[styles.smallBadge, { backgroundColor: '#e74c3c' }]}>
              <Text style={styles.smallBadgeText}>HAZARD ON</Text>
            </View>
          )}
          {isNavigating && remainingDistance != null && (
            <View style={[styles.smallBadge, { backgroundColor: '#27ae60' }]}>
              <Text style={styles.smallBadgeText}>{formatDistance(remainingDistance)}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Navigation instruction banner */}
      {currentInstruction ? (
        <View style={styles.instructionBanner}>
          <Text style={styles.instructionText}>{currentInstruction}</Text>
        </View>
      ) : null}

      {/* Last gesture feedback */}
      {lastGesture ? (
        <View style={styles.gestureFeedback}>
          <Text style={styles.gestureFeedbackText}>{lastGesture}</Text>
        </View>
      ) : null}

      {/* Bottom: Gesture hints */}
      <View style={styles.bottomBar}>
        {GESTURE_HINTS[mode].map((hint) => (
          <View key={hint} style={styles.hintPill}>
            <Text style={styles.hintText}>{hint}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    justifyContent: 'space-between',
  },

  // Top bar
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 16,
  },
  modeBadge: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  modeText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 1,
  },
  statusRow: {
    flexDirection: 'row',
    gap: 8,
  },
  smallBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  smallBadgeText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },

  // Instruction banner
  instructionBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#27ae60',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  instructionText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
  },

  // Gesture feedback flash
  gestureFeedback: {
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
  },
  gestureFeedbackText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },

  // Bottom hint bar
  bottomBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  hintPill: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  hintText: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 14,
    fontWeight: '600',
  },
});
