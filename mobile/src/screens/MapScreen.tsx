/**
 * MapScreen.tsx – Main navigation screen with real-time shelter overlay
 *
 * Lifecycle:
 *  1. Mount: fetch shelters, start GPS tracking, connect Socket.io
 *  2. User types destination → fetch Google Directions route → render polyline
 *  3. Socket.io emits 'alert' → handleAlert() fires:
 *      a. Find nearest shelter (Haversine)
 *      b. Fetch shelter route (Google Directions)
 *      c. activateEmergency() in alertStore → EmergencyBanner renders
 *      d. Map camera animates to shelter
 *  4. Unmount: stop GPS, disconnect socket
 *
 * Performance notes:
 *  - Shelter markers memoised with React.memo in ShelterMarker
 *  - Route fetch is debounced (destination input)
 *  - Location updates throttled to every 5 seconds to save battery
 */

import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
} from 'react-native';
import MapView, { Polyline, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';

import { useNavigationStore } from '../store/navigationStore';
import { useAlertStore }      from '../store/alertStore';
import { useShelterStore }    from '../store/shelterStore';
import socketService          from '../services/socketService';
import { getRoute }           from '../services/mapsService';
import { findNearestShelter } from '../utils/haversine';
import { runMockScenario }    from '../utils/mockData';

import EmergencyBanner from '../components/EmergencyBanner';
import ShelterMarker   from '../components/ShelterMarker';
import ShelterList     from '../components/ShelterList';

import type { Alert as AlertType, LatLng }  from '../types';

// ─── Initial map region (Israel center) ───────────────────────────────────
const ISRAEL_CENTER: Region = {
  latitude:       31.5,
  longitude:      34.9,
  latitudeDelta:  2.0,
  longitudeDelta: 2.0,
};

// ─── Location tracking config ─────────────────────────────────────────────
const LOCATION_OPTIONS: Location.LocationOptions = {
  accuracy:          Location.Accuracy.High,
  timeInterval:      5000,  // update every 5 s to save battery
  distanceInterval:  20,    // or every 20 m, whichever comes first
};

export default function MapScreen() {
  const { t } = useTranslation();
  const mapRef = useRef<MapView>(null);

  // ── Store slices ─────────────────────────────────────────────────────
  const {
    currentLocation,
    route,
    destination,
    isNavigating,
    setCurrentLocation,
    setRoute,
    setDestination,
    startNavigation,
  } = useNavigationStore();

  const {
    isEmergencyMode,
    shelterRoute,
    activateEmergency,
  } = useAlertStore();

  const { shelters, loading: sheltersLoading, fetchShelters } = useShelterStore();

  // ── Local UI state ────────────────────────────────────────────────────
  const [destinationInput, setDestinationInput] = useState('');
  const [routeLoading, setRouteLoading]          = useState(false);
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);

  // ─────────────────────────────────────────────────────────────────────────
  // Initialisation
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchShelters();
    startGPSTracking();

    // Connect socket and register alert handler
    const socket = socketService.connect();
    socket.on('alert', handleAlert);

    // If running in mock mode, trigger emergency after 60 s
    let cancelMock: (() => void) | undefined;
    if (process.env.EXPO_PUBLIC_MOCK_MODE === 'true') {
      cancelMock = runMockScenario(handleAlert);
    }

    return () => {
      // Always deregister the listener before disconnecting to prevent
      // duplicate alert handlers if the component remounts
      socket.off('alert', handleAlert);
      locationSubscription.current?.remove();
      socketService.disconnect();
      cancelMock?.();
    };
  }, [handleAlert]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────────────────────────────────────────────────────────────────
  // GPS tracking
  // ─────────────────────────────────────────────────────────────────────────
  const startGPSTracking = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        t('common.error'),
        'Location permission is required for navigation.',
        [{ text: t('common.ok') }]
      );
      return;
    }

    // Snap the camera to the user on first fix
    const initial = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    const initialLatLng: LatLng = {
      lat: initial.coords.latitude,
      lng: initial.coords.longitude,
    };
    setCurrentLocation(initialLatLng);
    animateCameraTo(initialLatLng, 13);

    // Start continuous updates
    locationSubscription.current = await Location.watchPositionAsync(
      LOCATION_OPTIONS,
      (loc) => {
        setCurrentLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      }
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Emergency handler – core auto-reroute logic
  // ─────────────────────────────────────────────────────────────────────────
  const handleAlert = useCallback(async (alert: AlertType, _attempt = 0) => {
    // Always read from store (not hook closure) to get the latest GPS position
    const pos = useNavigationStore.getState().currentLocation;
    const allShelters = useShelterStore.getState().shelters;

    // If GPS or shelters are not yet ready, retry up to 3 times with 1s delay.
    // This handles the race where an alert arrives before the first GPS fix.
    if (!pos || allShelters.length === 0) {
      if (_attempt < 3) {
        console.warn(
          `[MapScreen] Alert received but GPS/shelters not ready (attempt ${_attempt + 1}/3). Retrying in 1s…`
        );
        setTimeout(() => handleAlert(alert, _attempt + 1), 1000);
      } else {
        console.error('[MapScreen] Alert dropped: GPS/shelters unavailable after 3 retries.');
      }
      return;
    }

    // 1. Find nearest shelter by straight-line distance
    const nearest = findNearestShelter(pos, allShelters);

    // 2. Fetch driving route to that shelter
    let route = [];
    let etaMinutes = 5; // conservative fallback
    try {
      const result = await getRoute(pos, { lat: nearest.lat, lng: nearest.lng });
      route = result.polyline;
      etaMinutes = Math.ceil(result.durationSeconds / 60);
    } catch (err) {
      console.error('[MapScreen] Shelter route fetch failed, using straight line:', err);
      // Fallback: render a two-point polyline (direct line to shelter)
      route = [pos, { lat: nearest.lat, lng: nearest.lng }];
    }

    // 3. Update shelter record with ETA for display in banner and list
    const nearestWithEta = { ...nearest, etaMinutes };

    // 4. Activate emergency mode in the store (renders EmergencyBanner)
    activateEmergency(alert, nearestWithEta, route);

    // 5. Animate camera to show both current position and shelter
    animateCameraTo({ lat: nearest.lat, lng: nearest.lng }, 14);
  }, [activateEmergency]);

  // ─────────────────────────────────────────────────────────────────────────
  // Route planning (normal navigation)
  // ─────────────────────────────────────────────────────────────────────────
  const handleSearchRoute = useCallback(async () => {
    Keyboard.dismiss();
    if (!destinationInput.trim() || !currentLocation) return;

    // For a full implementation, use the Google Places API to geocode the
    // address string. Here we demonstrate with a hardcoded Kfar Saba coord
    // when the input contains "כפר סבא" or "kfar saba" (mock geocoder).
    const lower = destinationInput.toLowerCase();
    let destCoord: LatLng = { lat: 32.1784, lng: 34.9038 }; // default: Kfar Saba

    if (lower.includes('hod') || lower.includes('הוד')) {
      destCoord = { lat: 32.1526, lng: 34.9067 }; // Hod HaSharon
    } else if (lower.includes('rosh') || lower.includes('ראש')) {
      destCoord = { lat: 32.0956, lng: 34.9574 }; // Rosh HaAyin
    } else if (lower.includes('ra\'anana') || lower.includes('רעננה')) {
      destCoord = { lat: 32.1846, lng: 34.8706 }; // Ra'anana
    }

    setDestination({ ...destCoord, name: destinationInput });
    setRouteLoading(true);

    try {
      const result = await getRoute(currentLocation, destCoord);
      setRoute(result.polyline);
      startNavigation();

      // Fit the map to show the full route
      mapRef.current?.fitToCoordinates(
        result.polyline.map((p) => ({ latitude: p.lat, longitude: p.lng })),
        { edgePadding: { top: 80, right: 40, bottom: 200, left: 40 }, animated: true }
      );
    } catch (err) {
      console.error('[MapScreen] Route fetch failed:', err);
      Alert.alert(t('common.error'), t('common.retry'), [{ text: t('common.ok') }]);
    } finally {
      setRouteLoading(false);
    }
  }, [destinationInput, currentLocation, setDestination, setRoute, startNavigation, t]);

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────
  const animateCameraTo = (pos: LatLng, zoom = 14) => {
    mapRef.current?.animateToRegion({
      latitude:       pos.lat,
      longitude:      pos.lng,
      latitudeDelta:  0.05 / (zoom / 10),
      longitudeDelta: 0.05 / (zoom / 10),
    }, 800);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Emergency banner – absolute overlay, z-index 999 */}
      {isEmergencyMode && <EmergencyBanner />}

      {/* Search bar */}
      <View style={[
        styles.searchContainer,
        isEmergencyMode && styles.searchContainerEmergency,
      ]}>
        <TextInput
          style={styles.searchInput}
          placeholder={t('map.searchPlaceholder')}
          placeholderTextColor="#90A4AE"
          value={destinationInput}
          onChangeText={setDestinationInput}
          onSubmitEditing={handleSearchRoute}
          returnKeyType="search"
          editable={!isEmergencyMode}
        />
        <TouchableOpacity
          style={[styles.searchButton, isEmergencyMode && styles.searchButtonDisabled]}
          onPress={handleSearchRoute}
          disabled={isEmergencyMode || routeLoading}
        >
          {routeLoading
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={styles.searchButtonText}>{t('map.searchButton')}</Text>
          }
        </TouchableOpacity>
      </View>

      {/* Google Map */}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={ISRAEL_CENTER}
        showsUserLocation
        showsMyLocationButton
        showsTraffic={isNavigating}
        toolbarEnabled={false}
      >
        {/* Normal route polyline (blue) */}
        {route && !isEmergencyMode && (
          <Polyline
            coordinates={route.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
            strokeColor="#1565C0"
            strokeWidth={5}
            lineDashPattern={undefined}
          />
        )}

        {/* Emergency shelter route (red, thicker) */}
        {isEmergencyMode && shelterRoute && (
          <Polyline
            coordinates={shelterRoute.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
            strokeColor="#D32F2F"
            strokeWidth={7}
          />
        )}

        {/* Shelter markers */}
        {shelters.map((shelter) => (
          <ShelterMarker
            key={shelter.id}
            shelter={shelter}
            isEmergencyMode={isEmergencyMode}
          />
        ))}
      </MapView>

      {/* Shelter list panel (slides up from bottom) */}
      {!isEmergencyMode && (
        <View style={styles.shelterListContainer}>
          {sheltersLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#1565C0" />
              <Text style={styles.loadingText}>{t('map.loadingShelters')}</Text>
            </View>
          ) : (
            <ShelterList
              shelters={shelters}
              userLocation={currentLocation}
              title={t('map.sheltersNearby')}
            />
          )}
        </View>
      )}
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#E3F2FD',
  },
  searchContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 54 : 36,
    left: 16,
    right: 16,
    zIndex: 10,
    flexDirection: 'row',
    gap: 8,
  },
  searchContainerEmergency: {
    // Push below the emergency banner (~180px tall)
    top: Platform.OS === 'ios' ? 200 : 180,
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#1B2631',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  searchButton: {
    backgroundColor: '#1565C0',
    borderRadius: 12,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 80,
    shadowColor: '#1565C0',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  searchButtonDisabled: {
    backgroundColor: '#90A4AE',
  },
  searchButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  map: {
    flex: 1,
  },
  shelterListContainer: {
    maxHeight: 220,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 8,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    gap: 12,
  },
  loadingText: {
    color: '#546E7A',
    fontSize: 14,
  },
});
