/**
 * ShelterMarker.tsx
 *
 * Custom Google Maps marker for a bomb shelter.
 *
 * Normal mode:   green shield icon with shelter name callout
 * Emergency mode: red/pulsing marker to highlight the nearest shelter
 *
 * Uses react-native-maps <Marker> with a custom callout for tap details.
 * Memoised with React.memo to prevent re-renders when unrelated store state
 * changes (e.g. user location updates every 5 s).
 */

import React, { memo } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Marker, Callout } from 'react-native-maps';
import { useTranslation } from 'react-i18next';
import type { Shelter } from '../types';

interface Props {
  shelter: Shelter;
  isEmergencyMode: boolean;
  /** If true, this is the shelter being routed to (render differently). */
  isTarget?: boolean;
}

const ShelterMarker = memo(function ShelterMarker({
  shelter,
  isEmergencyMode,
  isTarget = false,
}: Props) {
  const { t } = useTranslation();

  const bgColor = isEmergencyMode && isTarget
    ? '#D32F2F'   // red – the shelter we're heading to
    : isEmergencyMode
    ? '#7B1FA2'   // purple – other shelters in emergency mode
    : '#2E7D32';  // green – normal mode

  return (
    <Marker
      coordinate={{ latitude: shelter.lat, longitude: shelter.lng }}
      title={shelter.name}
      tracksViewChanges={false}  // important perf: disable after initial render
    >
      {/* Custom pin */}
      <View style={[styles.pin, { backgroundColor: bgColor }]}>
        <Text style={styles.pinIcon}>
          {isTarget ? '🎯' : '🛡️'}
        </Text>
      </View>

      {/* Callout bubble (shown on tap) */}
      <Callout tooltip={false}>
        <View style={styles.callout}>
          <Text style={styles.calloutName}>{shelter.name}</Text>
          {shelter.address && (
            <Text style={styles.calloutAddress}>{shelter.address}</Text>
          )}
          {shelter.capacity && (
            <Text style={styles.calloutCapacity}>
              {t('map.capacity', { n: shelter.capacity })}
            </Text>
          )}
          {shelter.distanceMeters != null && (
            <Text style={styles.calloutDistance}>
              {shelter.distanceMeters < 1000
                ? `${Math.round(shelter.distanceMeters)} m`
                : `${(shelter.distanceMeters / 1000).toFixed(1)} km`}
            </Text>
          )}
        </View>
      </Callout>
    </Marker>
  );
});

export default ShelterMarker;

// ─── Styles ────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  pin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  pinIcon: {
    fontSize: 18,
    lineHeight: 22,
  },
  callout: {
    minWidth: 180,
    maxWidth: 240,
    padding: 10,
  },
  calloutName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1B2631',
    marginBottom: 4,
  },
  calloutAddress: {
    fontSize: 12,
    color: '#546E7A',
    marginBottom: 3,
  },
  calloutCapacity: {
    fontSize: 12,
    color: '#2E7D32',
    fontWeight: '600',
  },
  calloutDistance: {
    fontSize: 12,
    color: '#1565C0',
    fontWeight: '600',
    marginTop: 2,
  },
});
