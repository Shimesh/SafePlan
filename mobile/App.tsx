/**
 * App.tsx – SafeRoute Israel
 *
 * Root of the application. Responsibilities:
 *  1. Import and initialise i18n (must happen before any component renders)
 *  2. Apply RTL or LTR layout direction based on the active language
 *  3. Set up React Navigation with SafeAreaProvider and GestureHandler
 *  4. Render the AppNavigator
 *
 * RTL note:
 *   I18nManager.forceRTL() requires an app restart to fully take effect in
 *   React Native. In production, use expo-updates (Updates.reloadAsync()) or
 *   react-native-restart after calling forceRTL. During development, manually
 *   reload the app (Cmd+R / shake → Reload) after switching languages.
 */

// i18n must be imported BEFORE any component that uses useTranslation()
import './src/i18n';

import React, { useEffect } from 'react';
import { I18nManager, LogBox } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import i18n, { RTL_LANGUAGES } from './src/i18n';
import AppNavigator from './src/navigation/AppNavigator';

// Suppress the react-native-maps warning about missing Google Maps key in dev
LogBox.ignoreLogs([
  'No Google Maps API key',
  'Setting a timer',
]);

export default function App() {
  useEffect(() => {
    // ── RTL / LTR layout gate ──────────────────────────────────────────
    // Determine if the current language is RTL (Hebrew or Arabic).
    const lang = i18n.language as string;
    const shouldBeRTL = RTL_LANGUAGES.includes(lang as 'he' | 'ar');

    if (I18nManager.isRTL !== shouldBeRTL) {
      I18nManager.forceRTL(shouldBeRTL);
      // In production, reload the app here:
      // Updates.reloadAsync(); // expo-updates
      // RNRestart.Restart();   // react-native-restart
      console.log(
        `[App] RTL direction changed to ${shouldBeRTL}. ` +
        `Please reload the app for layout changes to take effect.`
      );
    }
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <NavigationContainer>
          <StatusBar style="auto" />
          <AppNavigator />
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
