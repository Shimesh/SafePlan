/**
 * ShelterList.tsx
 *
 * Horizontal scrollable list of nearby shelters displayed at the bottom of
 * MapScreen during normal navigation (not shown in emergency mode – the
 * EmergencyBanner takes over the UX at that point).
 *
 * Each card shows: shelter name, distance from user, capacity, type badge.
 * Shelters are sorted by distance (nearest first) using the Haversine util
 * when userLocation is available; otherwise shown in API order.
 *
 * Memoised to prevent re-render on every GPS tick.
 */

import React, { memo, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Shelter, LatLng } from '../types';
import { sortSheltersByDistance } from '../utils/haversine';

interface Props {
  shelters: Shelter[];
  userLocation: LatLng | null;
  title: string;
}

// ─── Individual shelter card ───────────────────────────────────────────────
interface CardProps {
  shelter: Shelter;
}

const ShelterCard = memo(function ShelterCard({ shelter }: CardProps) {
  const { t } = useTranslation();

  const distanceLabel =
    shelter.distanceMeters != null
      ? shelter.distanceMeters < 1000
        ? `${Math.round(shelter.distanceMeters)} m`
        : `${(shelter.distanceMeters / 1000).toFixed(1)} km`
      : null;

  const typeColor =
    shelter.type === 'municipal' ? '#1565C0' :
    shelter.type === 'private'   ? '#6A1B9A' :
    '#2E7D32';

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`${shelter.name}. ${distanceLabel ?? ''}`}
    >
      {/* Icon */}
      <Text style={styles.cardIcon}>🛡️</Text>

      {/* Info */}
      <View style={styles.cardInfo}>
        <Text style={styles.cardName} numberOfLines={2}>{shelter.name}</Text>

        {distanceLabel && (
          <Text style={styles.cardDistance}>{distanceLabel}</Text>
        )}

        <View style={styles.cardMeta}>
          {/* Type badge */}
          <View style={[styles.typeBadge, { backgroundColor: typeColor }]}>
            <Text style={styles.typeBadgeText}>{shelter.type}</Text>
          </View>

          {/* Capacity */}
          {shelter.capacity && (
            <Text style={styles.cardCapacity}>
              {t('map.capacity', { n: shelter.capacity })}
            </Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
});

// ─── Main list component ───────────────────────────────────────────────────
const ShelterList = memo(function ShelterList({ shelters, userLocation, title }: Props) {
  const { t } = useTranslation();

  // Sort by distance whenever userLocation or shelters change
  const sorted = useMemo(
    () => userLocation ? sortSheltersByDistance(userLocation, shelters) : shelters,
    [userLocation, shelters]
  );

  if (sorted.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>{t('map.noShelters')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Handle bar for drag affordance */}
      <View style={styles.handle} />

      {/* Section header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{title}</Text>
        <Text style={styles.headerCount}>
          {t('map.shelterCount', { count: sorted.length })}
        </Text>
      </View>

      {/* Horizontal card scroll */}
      <FlatList
        data={sorted}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => <ShelterCard shelter={item} />}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
});

export default ShelterList;

// ─── Styles ────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    paddingBottom: 8,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CFD8DC',
    marginTop: 8,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1B2631',
  },
  headerCount: {
    fontSize: 12,
    color: '#78909C',
  },
  listContent: {
    paddingHorizontal: 12,
    gap: 10,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F8E9',
    borderRadius: 14,
    padding: 12,
    width: 200,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  cardIcon: {
    fontSize: 24,
  },
  cardInfo: {
    flex: 1,
  },
  cardName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1B2631',
    marginBottom: 3,
  },
  cardDistance: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1565C0',
    marginBottom: 4,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  typeBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  typeBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  cardCapacity: {
    fontSize: 11,
    color: '#546E7A',
  },
  emptyContainer: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyText: {
    color: '#90A4AE',
    fontSize: 14,
  },
});
