import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import MainScreen from './src/screens/MainScreen';
import { speechService } from './src/services/speech';

export default function App() {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [locationGranted, setLocationGranted] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function init() {
      const camResult = await requestCameraPermission();
      const locResult = await Location.requestForegroundPermissionsAsync();
      setLocationGranted(locResult.status === 'granted');

      setReady(true);

      if (camResult.granted && locResult.status === 'granted') {
        setTimeout(() => {
          speechService.speakInfo(
            'Welcome to VisionPro. ' +
              'Tap anywhere for help and available actions.'
          );
        }, 1000);
      }
    }

    init();
  }, []);

  if (!ready) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>Loading VisionPro...</Text>
      </View>
    );
  }

  if (!cameraPermission?.granted || !locationGranted) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>
          VisionPro requires camera and location permissions to function.
          Please grant permissions in Settings.
        </Text>
      </View>
    );
  }

  return <MainScreen />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loadingText: {
    color: '#fff',
    fontSize: 18,
    textAlign: 'center',
  },
});
