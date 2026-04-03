/**
 * ChecklistScreen.tsx – "Departure Readiness" pre-drive checklist
 *
 * Design philosophy:
 *  - Calming soft green → blue gradient conveys safety and control
 *  - Each item animates with a spring effect when checked (tactile feedback)
 *  - Progress indicator shows completion at a glance
 *  - "Start Drive" is disabled until ≥ 4 of 6 items are checked
 *  - All strings come from useTranslation() for full i18n support
 *  - Layout is RTL-aware via I18nManager (set in App.tsx)
 *
 * Accessibility:
 *  - Each checklist row has accessibilityRole="checkbox" and accessibilityState
 *  - Colors meet WCAG AA contrast on both green and blue backgrounds
 */

import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Animated,
  SafeAreaView,
  Platform,
  Vibration,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/AppNavigator';

type ChecklistNavigationProp = StackNavigationProp<RootStackParamList, 'Checklist'>;

interface Props {
  navigation: ChecklistNavigationProp;
}

// ─── Checklist item keys (match translation file) ─────────────────────────
const ITEM_KEYS = ['phone', 'shoes', 'kids', 'water', 'meds', 'docs'] as const;
type ItemKey = typeof ITEM_KEYS[number];

// Minimum items to check before "Start Drive" is enabled
const MIN_REQUIRED = 4;

// ─── Single checklist row ──────────────────────────────────────────────────
interface ChecklistItemProps {
  label: string;
  checked: boolean;
  onPress: () => void;
  scaleAnim: Animated.Value;
}

function ChecklistItem({ label, checked, onPress, scaleAnim }: ChecklistItemProps) {
  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={[styles.itemRow, checked && styles.itemRowChecked]}
        onPress={onPress}
        activeOpacity={0.75}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={label}
      >
        {/* Checkbox circle */}
        <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
          {checked && <Text style={styles.checkmark}>✓</Text>}
        </View>
        <Text style={[styles.itemLabel, checked && styles.itemLabelChecked]}>
          {label}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Main screen ───────────────────────────────────────────────────────────
export default function ChecklistScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [checked, setChecked] = useState<Set<ItemKey>>(new Set());

  // One Animated.Value per item for independent spring animations
  const animations = useRef(
    ITEM_KEYS.reduce((acc, key) => {
      acc[key] = new Animated.Value(1);
      return acc;
    }, {} as Record<ItemKey, Animated.Value>)
  ).current;

  const canStart = checked.size >= MIN_REQUIRED;
  const allDone  = checked.size === ITEM_KEYS.length;

  // ── Toggle item with spring animation ────────────────────────────────
  const toggleItem = useCallback((key: ItemKey) => {
    // Spring punch: scale down then back to 1
    Animated.sequence([
      Animated.spring(animations[key], {
        toValue: 0.92,
        useNativeDriver: true,
        speed: 50,
        bounciness: 0,
      }),
      Animated.spring(animations[key], {
        toValue: 1,
        useNativeDriver: true,
        speed: 20,
        bounciness: 10,
      }),
    ]).start();

    // Short haptic vibration on native platforms
    if (Platform.OS !== 'web') Vibration.vibrate(30);

    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, [animations]);

  // ── Navigate to map ───────────────────────────────────────────────────
  const handleStart = useCallback(() => {
    if (!canStart) return;
    navigation.navigate('Map');
  }, [canStart, navigation]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.appName}>SafeRoute 🇮🇱</Text>
        <Text style={styles.title}>{t('checklist.title')}</Text>
        <Text style={styles.subtitle}>{t('checklist.subtitle')}</Text>
      </View>

      {/* Progress bar */}
      <View style={styles.progressContainer}>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${(checked.size / ITEM_KEYS.length) * 100}%` },
              canStart && styles.progressFillReady,
            ]}
          />
        </View>
        <Text style={styles.progressLabel}>
          {t('checklist.progress', {
            done: checked.size,
            total: ITEM_KEYS.length,
          })}
        </Text>
      </View>

      {/* Checklist items */}
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        {ITEM_KEYS.map((key) => (
          <ChecklistItem
            key={key}
            label={t(`checklist.items.${key}`)}
            checked={checked.has(key)}
            onPress={() => toggleItem(key)}
            scaleAnim={animations[key]}
          />
        ))}
      </ScrollView>

      {/* Status message */}
      <Text style={[styles.statusText, canStart && styles.statusTextGood]}>
        {allDone
          ? t('checklist.allGood')
          : canStart
          ? t('checklist.readyMinimum')  // 4-5 items checked — ready but not complete
          : t('checklist.notReady')}
      </Text>

      {/* Start Drive button */}
      <TouchableOpacity
        style={[styles.startButton, !canStart && styles.startButtonDisabled]}
        onPress={handleStart}
        disabled={!canStart}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canStart }}
        accessibilityLabel={t('checklist.startButton')}
      >
        <Text style={[styles.startButtonText, !canStart && styles.startButtonTextDisabled]}>
          {t('checklist.startButton')} →
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────
const COLORS = {
  background:     '#E8F5E9', // soft green
  headerGradient: '#E3F2FD', // soft blue
  primary:        '#2E7D32', // deep green
  primaryLight:   '#A5D6A7',
  accent:         '#1565C0', // blue for progress
  text:           '#1B2631',
  textSecondary:  '#546E7A',
  white:          '#FFFFFF',
  checkBg:        '#F1F8E9',
  checkBgActive:  '#C8E6C9',
  disabledBg:     '#CFD8DC',
  disabledText:   '#90A4AE',
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingHorizontal: 20,
  },
  header: {
    paddingTop: 24,
    paddingBottom: 16,
    alignItems: 'center',
  },
  appName: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  progressContainer: {
    marginBottom: 16,
    alignItems: 'center',
  },
  progressTrack: {
    width: '100%',
    height: 8,
    backgroundColor: COLORS.primaryLight,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.accent,
    borderRadius: 4,
  },
  progressFillReady: {
    backgroundColor: COLORS.primary,
  },
  progressLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 8,
    gap: 10,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
    // Soft shadow for card effect
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  itemRowChecked: {
    backgroundColor: COLORS.checkBgActive,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: COLORS.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginEnd: 14,
    backgroundColor: COLORS.white,
  },
  checkboxChecked: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary,
  },
  checkmark: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 18,
  },
  itemLabel: {
    flex: 1,
    fontSize: 16,
    color: COLORS.text,
    fontWeight: '500',
  },
  itemLabelChecked: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  statusText: {
    textAlign: 'center',
    color: COLORS.textSecondary,
    fontSize: 13,
    marginVertical: 12,
  },
  statusTextGood: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  startButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  startButtonDisabled: {
    backgroundColor: COLORS.disabledBg,
    shadowOpacity: 0,
    elevation: 0,
  },
  startButtonText: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  startButtonTextDisabled: {
    color: COLORS.disabledText,
  },
});
