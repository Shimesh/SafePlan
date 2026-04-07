/**
 * ChecklistScreen.tsx – "Departure Readiness" pre-drive checklist
 *
 * Additions over previous version:
 *  - App description at the top (translatable)
 *  - Language switcher (4 languages; RTL changes require app restart)
 *  - Live radio player (RadioPlayer component with expo-av)
 *  - Responsive layout using useWindowDimensions
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
  Alert,
  I18nManager,
  useWindowDimensions,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import i18n, { SUPPORTED_LANGUAGES, RTL_LANGUAGES, type SupportedLang } from '../i18n';
import RadioPlayer from '../components/RadioPlayer';

type ChecklistNavigationProp = StackNavigationProp<RootStackParamList, 'Checklist'>;

interface Props {
  navigation: ChecklistNavigationProp;
}

const ITEM_KEYS = ['phone', 'shoes', 'kids', 'water', 'meds', 'docs'] as const;
type ItemKey = typeof ITEM_KEYS[number];
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

// ─── Language switcher ─────────────────────────────────────────────────────
function LanguageSwitcher() {
  const { t }                      = useTranslation();
  const [, forceUpdate]            = useState(0); // force re-render after lang change
  const currentLang                = i18n.language as SupportedLang;

  const handleLangChange = useCallback((code: SupportedLang) => {
    if (code === i18n.language) return;

    const wasRTL  = RTL_LANGUAGES.includes(currentLang);
    const willRTL = RTL_LANGUAGES.includes(code);

    i18n.changeLanguage(code);
    forceUpdate((n) => n + 1);

    // RTL ↔ LTR direction change requires app restart in React Native
    if (wasRTL !== willRTL) {
      I18nManager.forceRTL(willRTL);
      Alert.alert(
        t('language.title'),
        t('language.restartNote'),
        [{ text: t('common.ok') }]
      );
    }
  }, [currentLang, t]);

  return (
    <View style={styles.langContainer}>
      <Text style={styles.langLabel}>{t('language.title')}</Text>
      <View style={styles.langButtons}>
        {SUPPORTED_LANGUAGES.map((lang) => (
          <TouchableOpacity
            key={lang.code}
            style={[
              styles.langBtn,
              currentLang === lang.code && styles.langBtnActive,
            ]}
            onPress={() => handleLangChange(lang.code)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityState={{ selected: currentLang === lang.code }}
            accessibilityLabel={lang.name}
          >
            <Text
              style={[
                styles.langBtnText,
                currentLang === lang.code && styles.langBtnTextActive,
              ]}
            >
              {lang.name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ─── Main screen ───────────────────────────────────────────────────────────
export default function ChecklistScreen({ navigation }: Props) {
  const { t }    = useTranslation();
  const { width } = useWindowDimensions();
  const [checked, setChecked] = useState<Set<ItemKey>>(new Set());

  const animations = useRef(
    ITEM_KEYS.reduce((acc, key) => {
      acc[key] = new Animated.Value(1);
      return acc;
    }, {} as Record<ItemKey, Animated.Value>)
  ).current;

  const canStart = checked.size >= MIN_REQUIRED;
  const allDone  = checked.size === ITEM_KEYS.length;

  const toggleItem = useCallback((key: ItemKey) => {
    Animated.sequence([
      Animated.spring(animations[key], {
        toValue: 0.92, useNativeDriver: true, speed: 50, bounciness: 0,
      }),
      Animated.spring(animations[key], {
        toValue: 1, useNativeDriver: true, speed: 20, bounciness: 10,
      }),
    ]).start();

    if (Platform.OS !== 'web') Vibration.vibrate(30);

    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, [animations]);

  const handleStart = useCallback(() => {
    if (!canStart) return;
    navigation.navigate('Map');
  }, [canStart, navigation]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── App name + description ──────────────────────────────── */}
        <View style={styles.header}>
          <Text style={styles.appName}>SafeRoute 🇮🇱</Text>
          <Text style={styles.appDescription}>{t('app.description')}</Text>
          <Text style={styles.appTagline}>{t('app.tagline')}</Text>
        </View>

        {/* ── Language switcher ────────────────────────────────────── */}
        <LanguageSwitcher />

        {/* ── Live radio player ────────────────────────────────────── */}
        <RadioPlayer />

        {/* ── Checklist header ─────────────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.title}>{t('checklist.title')}</Text>
          <Text style={styles.subtitle}>{t('checklist.subtitle')}</Text>
        </View>

        {/* ── Progress bar ─────────────────────────────────────────── */}
        <View style={styles.progressContainer}>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${(checked.size / ITEM_KEYS.length) * 100}%` as any },
                canStart && styles.progressFillReady,
              ]}
            />
          </View>
          <Text style={styles.progressLabel}>
            {t('checklist.progress', { done: checked.size, total: ITEM_KEYS.length })}
          </Text>
        </View>

        {/* ── Checklist items ───────────────────────────────────────── */}
        <View style={styles.list}>
          {ITEM_KEYS.map((key) => (
            <ChecklistItem
              key={key}
              label={t(`checklist.items.${key}`)}
              checked={checked.has(key)}
              onPress={() => toggleItem(key)}
              scaleAnim={animations[key]}
            />
          ))}
        </View>

        {/* ── Status message ────────────────────────────────────────── */}
        <Text style={[styles.statusText, canStart && styles.statusTextGood]}>
          {allDone
            ? t('checklist.allGood')
            : canStart
            ? t('checklist.readyMinimum')
            : t('checklist.notReady')}
        </Text>
      </ScrollView>

      {/* ── Start Drive button (sticky at bottom) ─────────────────── */}
      <View style={styles.startWrapper}>
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
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────
const COLORS = {
  background:     '#E8F5E9',
  primary:        '#2E7D32',
  primaryLight:   '#A5D6A7',
  accent:         '#1565C0',
  text:           '#1B2631',
  textSecondary:  '#546E7A',
  white:          '#FFFFFF',
  checkBgActive:  '#C8E6C9',
  disabledBg:     '#CFD8DC',
  disabledText:   '#90A4AE',
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  // ── Header ────────────────────────────────────────────────────────
  header: {
    paddingTop: 24,
    paddingBottom: 16,
    alignItems: 'center',
  },
  appName: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.primary,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  appDescription: {
    fontSize: 14,
    color: COLORS.text,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 6,
    paddingHorizontal: 8,
  },
  appTagline: {
    fontSize: 12,
    color: COLORS.accent,
    textAlign: 'center',
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  // ── Language switcher ─────────────────────────────────────────────
  langContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 12,
    marginTop: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  langLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  langButtons: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  langBtn: {
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: '#ECEFF1',
    borderWidth: 1,
    borderColor: '#CFD8DC',
  },
  langBtnActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  langBtnText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  langBtnTextActive: {
    color: COLORS.white,
  },
  // ── Section header ────────────────────────────────────────────────
  sectionHeader: {
    paddingTop: 20,
    paddingBottom: 8,
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  // ── Progress ──────────────────────────────────────────────────────
  progressContainer: {
    marginBottom: 12,
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
  // ── Checklist items ───────────────────────────────────────────────
  list: {
    gap: 8,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
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
    fontSize: 15,
    color: COLORS.text,
    fontWeight: '500',
  },
  itemLabelChecked: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  // ── Status + start button ─────────────────────────────────────────
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
  startWrapper: {
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 8 : 16,
    backgroundColor: COLORS.background,
  },
  startButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
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
