/**
 * AppNavigator.tsx
 *
 * Stack navigator: Checklist → Map
 *
 * The checklist is always the entry point. The user cannot skip it and go
 * directly to the map (by design – the psychological readiness check is a
 * core safety feature of the app).
 *
 * The map screen header is hidden because the map is full-screen and the
 * emergency banner is rendered as an absolute overlay inside MapScreen.
 */

import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import ChecklistScreen from '../screens/ChecklistScreen';
import MapScreen from '../screens/MapScreen';

export type RootStackParamList = {
  Checklist: undefined;
  Map: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Checklist"
      screenOptions={{
        // Use a soft fade transition to keep the calming UX on checklist
        cardStyleInterpolator: ({ current }) => ({
          cardStyle: { opacity: current.progress },
        }),
        gestureEnabled: false, // prevent accidental back swipe during emergency
      }}
    >
      <Stack.Screen
        name="Checklist"
        component={ChecklistScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Map"
        component={MapScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}
