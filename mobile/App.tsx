/**
 * App.tsx – SafeRoute Israel
 *
 * Root of the application. Responsibilities:
 *  1. Import and initialise i18n (must happen before any component renders)
 *  2. Apply RTL or LTR layout direction based on the active language
 *  3. Wrap the entire tree in an ErrorBoundary so a crash in any child
 *     does not produce a blank white screen — critical for a life-safety app
 *  4. Set up React Navigation with SafeAreaProvider and GestureHandler
 *  5. Render the AppNavigator
 *
 * RTL note:
 *   I18nManager.forceRTL() requires an app restart to fully take effect in
 *   React Native. In production, use expo-updates (Updates.reloadAsync()) or
 *   react-native-restart after calling forceRTL. During development, manually
 *   reload the app (Cmd+R / shake → Reload) after switching languages.
 */

// i18n must be imported BEFORE any component that uses useTranslation()
import './src/i18n';

import React, { Component, useEffect } from 'react';
import {
  I18nManager,
  LogBox,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import i18n, { RTL_LANGUAGES } from './src/i18n';
import AppNavigator from './src/navigation/AppNavigator';

// Suppress non-actionable warnings in dev
LogBox.ignoreLogs([
  'No Google Maps API key',
  'Setting a timer',
]);

// ─── Error Boundary ──────────────────────────────────────────────────────────
// A class component is required by React for error boundaries.
// Catches any render-time exception in the tree and shows a recovery UI
// instead of a blank white screen. Essential for a life-safety application.
interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

class ErrorBoundary extends Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // In production, forward to an error-tracking service (e.g. Sentry)
    console.error('[ErrorBoundary] Caught crash:', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={errStyles.container}>
          <Text style={errStyles.icon}>⚠️</Text>
          <Text style={errStyles.title}>SafeRoute Israel</Text>
          <Text style={errStyles.subtitle}>
            An unexpected error occurred. Please tap below to recover, or
            restart the app if the problem persists.
          </Text>
          {this.state.errorMessage ? (
            <Text style={errStyles.detail}>{this.state.errorMessage}</Text>
          ) : null}
          <TouchableOpacity style={errStyles.button} onPress={this.handleReset}>
            <Text style={errStyles.buttonText}>Try Again</Text>
          </TouchableOpacity>
          <Text style={errStyles.emergency}>
            In an emergency, call 112
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const errStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1B2631',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  icon:     { fontSize: 48, marginBottom: 16 },
  title:    { fontSize: 22, fontWeight: '800', color: '#FFFFFF', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#BDC3C7', textAlign: 'center', lineHeight: 22 },
  detail:   { fontSize: 12, color: '#E74C3C', marginTop: 12, textAlign: 'center' },
  button: {
    marginTop: 28,
    backgroundColor: '#2E7D32',
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 12,
  },
  buttonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  emergency:  { marginTop: 24, color: '#7F8C8D', fontSize: 13 },
});

// ─── Root App ────────────────────────────────────────────────────────────────
export default function App() {
  useEffect(() => {
    // ── RTL / LTR layout gate ────────────────────────────────────────────
    const lang = i18n.language as string;
    const shouldBeRTL = RTL_LANGUAGES.includes(lang as 'he' | 'ar');

    if (I18nManager.isRTL !== shouldBeRTL) {
      I18nManager.forceRTL(shouldBeRTL);
      // In production, reload the app here:
      // Updates.reloadAsync(); // expo-updates
      // RNRestart.Restart();   // react-native-restart
      console.log(
        `[App] RTL direction set to ${shouldBeRTL}. ` +
        `Please reload the app for layout changes to take full effect.`
      );
    }
  }, []);

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <NavigationContainer>
            <StatusBar style="auto" />
            <AppNavigator />
          </NavigationContainer>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
