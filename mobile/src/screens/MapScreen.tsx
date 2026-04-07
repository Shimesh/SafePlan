/**
 * MapScreen.tsx – Main navigation screen with real-time shelter overlay
 *
 * Layout: The map uses StyleSheet.absoluteFillObject so it fills 100% of the
 * viewport. All other UI elements (search bar, nav bar, shelter list, emergency
 * banner) are positioned absolutely on top of the map.
 *
 * Camera modes:
 *  - Idle:        city-level zoom (12), pitch 0
 *  - Navigating:  street-level zoom (17), pitch 45 (3D tilt), follows user
 *  - Emergency:   fit both user + shelter into view, pitch 0
 *
 * Step advancement:
 *  NavigationBar watches currentLocation in the store and advances steps when
 *  the user is within 50m of the current step's endLocation. It never uses a timer.
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
  useWindowDimensions,
} from 'react-native';
import MapView, {
  Polyline,
  PROVIDER_GOOGLE,
  Region,
  Camera,
} from 'react-native-maps';
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
import NavigationBar   from '../components/NavigationBar';
import ShelterMarker   from '../components/ShelterMarker';
import ShelterList     from '../components/ShelterList';

import type { Alert as AlertType, LatLng } from '../types';

// ─── Initial map region (Israel center) ───────────────────────────────────
const ISRAEL_CENTER: Region = {
  latitude:       31.5,
  longitude:      34.9,
  latitudeDelta:  2.0,
  longitudeDelta: 2.0,
};

// ─── Location tracking config ─────────────────────────────────────────────
const LOCATION_OPTIONS: Location.LocationOptions = {
  accuracy:         Location.Accuracy.High,
  timeInterval:     5000,  // update every 5 s to save battery
  distanceInterval: 20,    // or every 20 m, whichever comes first
};

// ─── Min milliseconds between camera follow updates during navigation ──────
const CAMERA_FOLLOW_THROTTLE_MS = 4000;

export default function MapScreen() {
  const { t }   = useTranslation();
  const mapRef  = useRef<MapView>(null);
  const { width, height } = useWindowDimensions();

  // ── Store slices ─────────────────────────────────────────────────────
  const {
    currentLocation,
    route,
    destination,
    isNavigating,
    setCurrentLocation,
    setRoute,
    setDestination,
    setSteps,
    startNavigation,
    stopNavigation,
  } = useNavigationStore();

  const {
    isEmergencyMode,
    shelterRoute,
    activateEmergency,
  } = useAlertStore();

  const { shelters, loading: sheltersLoading, fetchShelters } = useShelterStore();

  // ── Local UI state ────────────────────────────────────────────────────
  const [destinationInput, setDestinationInput]       = useState('');
  const [routeLoading, setRouteLoading]               = useState(false);
  const [isStraightLineRoute, setIsStraightLineRoute] = useState(false);
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const lastCameraFollow     = useRef(0);

  // ─────────────────────────────────────────────────────────────────────────
  // Camera helpers
  // ─────────────────────────────────────────────────────────────────────────
  const animateCameraTo = useCallback((pos: LatLng, zoom = 14, pitch = 0) => {
    mapRef.current?.animateCamera(
      {
        center:  { latitude: pos.lat, longitude: pos.lng },
        zoom,
        pitch,
        heading: 0,
        altitude: 500,
      } as Camera,
      { duration: 800 }
    );
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Camera follow during navigation (throttled, 3D tilt)
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isNavigating || isEmergencyMode || !currentLocation) return;
    const now = Date.now();
    if (now - lastCameraFollow.current < CAMERA_FOLLOW_THROTTLE_MS) return;
    lastCameraFollow.current = now;

    mapRef.current?.animateCamera(
      {
        center:  { latitude: currentLocation.lat, longitude: currentLocation.lng },
        zoom:    17,
        pitch:   45,     // 3D tilt during navigation
        heading: 0,
        altitude: 300,
      } as Camera,
      { duration: 1000 }
    );
  }, [currentLocation, isNavigating, isEmergencyMode]);

  // ─────────────────────────────────────────────────────────────────────────
  // GPS tracking
  // ─────────────────────────────────────────────────────────────────────────
  const startGPSTracking = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        t('common.error'),
        'Location permission is required for navigation.',
        [{ text: t('common.ok') }]
      );
      return;
    }

    // First GPS fix → city-level zoom (12)
    const initial = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    const initialLatLng: LatLng = {
      lat: initial.coords.latitude,
      lng: initial.coords.longitude,
    };
    setCurrentLocation(initialLatLng);
    animateCameraTo(initialLatLng, 12, 0); // city-level, flat

    locationSubscription.current = await Location.watchPositionAsync(
      LOCATION_OPTIONS,
      (loc) => {
        setCurrentLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      }
    );
  }, [animateCameraTo, setCurrentLocation, t]);

  // ─────────────────────────────────────────────────────────────────────────
  // Emergency handler – core auto-reroute logic
  // ─────────────────────────────────────────────────────────────────────────
  const handleAlert = useCallback(async (alert: AlertType, _attempt = 0) => {
    const pos         = useNavigationStore.getState().currentLocation;
    const allShelters = useShelterStore.getState().shelters;

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

    const nearest = findNearestShelter(pos, allShelters);

    let shelterPolyline = [];
    let etaMinutes = 5;
    try {
      const result = await getRoute(pos, { lat: nearest.lat, lng: nearest.lng });
      shelterPolyline = result.polyline;
      etaMinutes = Math.ceil(result.durationSeconds / 60);
    } catch (err) {
      console.error('[MapScreen] Shelter route fetch failed, using straight line:', err);
      shelterPolyline = [pos, { lat: nearest.lat, lng: nearest.lng }];
      setIsStraightLineRoute(true);
    }

    const nearestWithEta = { ...nearest, etaMinutes };
    activateEmergency(alert, nearestWithEta, shelterPolyline);

    // Fit camera to show both user and shelter
    mapRef.current?.fitToCoordinates(
      [
        { latitude: pos.lat, longitude: pos.lng },
        { latitude: nearest.lat, longitude: nearest.lng },
      ],
      { edgePadding: { top: 100, right: 60, bottom: 80, left: 60 }, animated: true }
    );
  }, [activateEmergency, setIsStraightLineRoute]);

  // ─────────────────────────────────────────────────────────────────────────
  // Initialisation
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchShelters();
    startGPSTracking();

    const socket = socketService.connect();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.on('alert', (payload: any) => handleAlert(payload as AlertType));

    let cancelMock: (() => void) | undefined;
    if (process.env.EXPO_PUBLIC_MOCK_MODE === 'true') {
      cancelMock = runMockScenario(handleAlert);
    }

    return () => {
      socket.off('alert');   // remove all 'alert' listeners registered above
      locationSubscription.current?.remove();
      socketService.disconnect();
      cancelMock?.();
    };
  }, [handleAlert, fetchShelters, startGPSTracking]);

  // ─────────────────────────────────────────────────────────────────────────
  // Route planning (normal navigation)
  // ─────────────────────────────────────────────────────────────────────────
  const handleSearchRoute = useCallback(async () => {
    Keyboard.dismiss();
    if (!destinationInput.trim() || !currentLocation) return;

    const lower = destinationInput.toLowerCase();
    const CITY_COORDS: Array<[string[], LatLng]> = [
      [['תל אביב', 'tel aviv', 'telaviv'],        { lat: 32.0853, lng: 34.7818 }],
      [['ירושלים', 'jerusalem'],                   { lat: 31.7683, lng: 35.2137 }],
      [['חיפה', 'haifa'],                          { lat: 32.7940, lng: 34.9896 }],
      [['באר שבע', 'beer sheva', 'beersheba'],     { lat: 31.2518, lng: 34.7913 }],
      [['נתניה', 'netanya'],                       { lat: 32.3226, lng: 34.8533 }],
      [['רמת גן', 'ramat gan'],                    { lat: 32.0680, lng: 34.8240 }],
      [['פתח תקווה', 'petah tikva'],               { lat: 32.0840, lng: 34.8878 }],
      [['ראשון לציון', 'rishon', 'rishon lezion'], { lat: 31.9642, lng: 34.8044 }],
      [['אשדוד', 'ashdod'],                        { lat: 31.8014, lng: 34.6552 }],
      [['הוד', 'hod hasharon'],                    { lat: 32.1526, lng: 34.9067 }],
      [['ראש העין', 'rosh', 'rosh haayin'],        { lat: 32.0956, lng: 34.9574 }],
      [['רעננה', "ra'anana", 'raanana'],            { lat: 32.1846, lng: 34.8706 }],
    ];

    let destCoord: LatLng = { lat: 32.1784, lng: 34.9038 };
    for (const [keywords, coord] of CITY_COORDS) {
      if (keywords.some((kw) => lower.includes(kw))) {
        destCoord = coord;
        break;
      }
    }

    setDestination({ ...destCoord, name: destinationInput });
    setRouteLoading(true);

    try {
      const result = await getRoute(currentLocation, destCoord);
      setRoute(result.polyline);
      setSteps(result.steps);
      startNavigation();

      // Fit map to route, accounting for the nav bar at top
      mapRef.current?.fitToCoordinates(
        result.polyline.map((p) => ({ latitude: p.lat, longitude: p.lng })),
        { edgePadding: { top: 140, right: 40, bottom: 240, left: 40 }, animated: true }
      );

      // After 1.5s, animate to 3D navigation view
      setTimeout(() => {
        if (currentLocation) {
          animateCameraTo(currentLocation, 17, 45);
        }
      }, 1500);
    } catch (err) {
      console.error('[MapScreen] Route fetch failed:', err);
      Alert.alert(t('common.error'), t('common.retry'), [{ text: t('common.ok') }]);
    } finally {
      setRouteLoading(false);
    }
  }, [
    destinationInput, currentLocation, setDestination, setRoute,
    setSteps, startNavigation, animateCameraTo, t,
  ]);

  const handleStopNavigation = useCallback(() => {
    stopNavigation();
    setSteps([]);
    // Return to city-level overview
    if (currentLocation) {
      animateCameraTo(currentLocation, 12, 0);
    }
  }, [stopNavigation, setSteps, currentLocation, animateCameraTo]);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>

      {/* ── Full-screen map ─────────────────────────────────────────── */}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFillObject}
        initialRegion={ISRAEL_CENTER}
        showsUserLocation
        showsMyLocationButton={false}
        showsTraffic={isNavigating}
        showsBuildings                // enables 3D buildings
        toolbarEnabled={false}
      >
        {/* Normal route polyline */}
        {route && !isEmergencyMode && (
          <Polyline
            coordinates={route.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
            strokeColor="#1565C0"
            strokeWidth={5}
          />
        )}

        {/* Emergency shelter route */}
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

      {/* ── Emergency banner (absolute, z 999) ─────────────────────── */}
      {isEmergencyMode && <EmergencyBanner />}

      {/* ── Turn-by-turn nav bar (shown during normal navigation) ──── */}
      {isNavigating && !isEmergencyMode && <NavigationBar />}

      {/* ── Search bar (shown when not navigating) ─────────────────── */}
      {!isNavigating && !isEmergencyMode && (
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder={t('map.searchPlaceholder')}
            placeholderTextColor="#90A4AE"
            value={destinationInput}
            onChangeText={setDestinationInput}
            onSubmitEditing={handleSearchRoute}
            returnKeyType="search"
          />
          <TouchableOpacity
            style={[styles.searchButton, routeLoading && styles.searchButtonDisabled]}
            onPress={handleSearchRoute}
            disabled={routeLoading}
          >
            {routeLoading
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.searchButtonText}>{t('map.searchButton')}</Text>
            }
          </TouchableOpacity>
        </View>
      )}

      {/* ── Stop navigation button ──────────────────────────────────── */}
      {isNavigating && !isEmergencyMode && (
        <TouchableOpacity
          style={styles.stopNavButton}
          onPress={handleStopNavigation}
          activeOpacity={0.85}
        >
          <Text style={styles.stopNavText}>✕ {t('map.stopNav')}</Text>
        </TouchableOpacity>
      )}

      {/* ── Shelter list panel (floating, bottom) ──────────────────── */}
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

      {/* ── Straight-line route warning ─────────────────────────────── */}
      {isEmergencyMode && isStraightLineRoute && (
        <View style={styles.straightLineWarning}>
          <Text style={styles.straightLineWarningText}>
            {t('emergency.straightLineWarning')}
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',   // black behind map while loading
  },
  // ── Search bar (absolute, floats over map) ─────────────────────────
  searchContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 54 : 36,
    left: 16,
    right: 16,
    zIndex: 10,
    flexDirection: 'row',
    gap: 8,
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
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
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
  // ── Stop navigation button ─────────────────────────────────────────
  stopNavButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 120 : 100,
    right: 16,
    zIndex: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  stopNavText: {
    color: '#D32F2F',
    fontSize: 13,
    fontWeight: '700',
  },
  // ── Shelter list panel (floating above bottom) ─────────────────────
  shelterListContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: 220,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 12,
    zIndex: 10,
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
  // ── Straight-line warning ──────────────────────────────────────────
  straightLineWarning: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    backgroundColor: '#E65100',
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  straightLineWarningText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
    textAlign: 'center',
  },
});
