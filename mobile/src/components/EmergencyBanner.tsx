/**
 * EmergencyBanner.tsx
 *
 * Two-phase emergency overlay:
 *
 *  Phase 1 — התרעה מקדימה (Preliminary Warning)
 *    When alertType === 'preliminary' AND secondsLeft > timeToImpact.
 *    Background: amber/orange. Calm messaging. "You have time to reach shelter."
 *    Countdown shows total time remaining (warningTimeSeconds + timeToImpact).
 *
 *  Phase 2 — אזעקה פעילה (Active Alert)
 *    When alertType === 'active' OR secondsLeft <= timeToImpact.
 *    Background: deep red, pulsing. Urgent. "ENTER SHELTER NOW."
 *    Countdown shows seconds until impact.
 *
 * The banner never self-dismisses. User must press dismiss (strongly discouraged).
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Vibration,
  Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAlertStore } from '../store/alertStore';

// ─── Pulsing animation hook ────────────────────────────────────────────────
function usePulse(active: boolean) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.7, duration: 450, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,   duration: 450, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulseAnim]);

  return pulseAnim;
}

// ─── Component ─────────────────────────────────────────────────────────────
export default function EmergencyBanner() {
  const { t } = useTranslation();
  const { activeAlert, nearestShelter, clearEmergency } = useAlertStore();

  if (!activeAlert) return null;

  const warningTime  = activeAlert.warningTimeSeconds ?? 0;
  const impactTime   = activeAlert.timeToImpact;
  const totalSeconds = warningTime + impactTime;

  // Countdown starts at totalSeconds (preliminary + impact combined)
  const [secondsLeft, setSecondsLeft] = useState(totalSeconds);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Slide-down entrance
  const slideAnim = useRef(new Animated.Value(-350)).current;

  // Pulse only in active phase
  const isActivePhaseSoFar = activeAlert.alertType === 'active' || secondsLeft <= impactTime;
  const [isPulsing, setIsPulsing] = useState(isActivePhaseSoFar);
  const pulseOpacity = usePulse(isPulsing);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      Vibration.vibrate(
        activeAlert.alertType === 'active'
          ? [0, 500, 200, 500, 200, 500]
          : [0, 300, 400, 300]
      );
    }

    Animated.spring(slideAnim, {
      toValue: 0, useNativeDriver: true, bounciness: 5, speed: 14,
    }).start();

    setSecondsLeft(totalSeconds);

    countdownRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        const next = Math.max(0, prev - 1);
        if (next === 0 && countdownRef.current) clearInterval(countdownRef.current);
        return next;
      });
    }, 1000);

    // Start pulsing when entering active phase
    const pulseDelay = warningTime > 0 ? warningTime * 1000 : 0;
    const pulseTimer = setTimeout(() => setIsPulsing(true), pulseDelay);

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      clearTimeout(pulseTimer);
    };
  }, [activeAlert, slideAnim]);

  const handleDismiss = useCallback(() => {
    Vibration.vibrate(100);
    clearEmergency();
  }, [clearEmergency]);

  // ── Determine current display phase ────────────────────────────────────
  const isActive = activeAlert.alertType === 'active' || secondsLeft <= impactTime;

  // ── Take cover state ────────────────────────────────────────────────────
  if (secondsLeft === 0) {
    return (
      <Animated.View
        style={[styles.banner, styles.bannerTakeCover, { transform: [{ translateY: slideAnim }] }]}
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
      >
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.pulseBgBlack, { opacity: pulseOpacity }]}
          pointerEvents="none"
        />
        <Text style={styles.takeCoverText}>{t('emergency.takeCover')}</Text>
        <TouchableOpacity style={styles.dismissButton} onPress={handleDismiss}>
          <Text style={styles.dismissText}>{t('emergency.dismiss')}</Text>
        </TouchableOpacity>
      </Animated.View>
    );
  }

  // ── Preliminary phase ───────────────────────────────────────────────────
  if (!isActive) {
    const secsInWarning = secondsLeft - impactTime; // time remaining before siren
    return (
      <Animated.View
        style={[styles.banner, styles.bannerPreliminary, { transform: [{ translateY: slideAnim }] }]}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
      >
        <Text style={styles.titlePreliminary}>{t('emergency.preliminary')}</Text>
        <Text style={styles.subtitlePreliminary}>{t('emergency.preliminarySubtitle')}</Text>

        <Text style={styles.threatPreliminary}>
          {activeAlert.threatOrigin}
        </Text>

        {activeAlert.regions.length > 0 && (
          <Text style={styles.regionsPreliminary}>
            {activeAlert.regions.join(' · ')}
          </Text>
        )}

        <View style={styles.countdownBoxPreliminary}>
          <Text style={styles.countdownLabel}>{t('emergency.preparationTime', { seconds: secsInWarning })}</Text>
          <Text style={styles.countdownPreliminary}>{secsInWarning}</Text>
        </View>

        {nearestShelter && (
          <View style={styles.shelterBox}>
            <Text style={styles.shelterLabel}>
              {t('emergency.reroutingTo', { name: nearestShelter.name })}
            </Text>
            {nearestShelter.etaMinutes != null && (
              <Text style={styles.shelterEta}>
                {t('emergency.shelterEta', { minutes: nearestShelter.etaMinutes })}
              </Text>
            )}
          </View>
        )}

        <Text style={styles.instructionsPreliminary}>
          {t('emergency.instructions.ballistic')}
        </Text>

        <TouchableOpacity style={styles.dismissButtonPreliminary} onPress={handleDismiss}>
          <Text style={styles.dismissTextPreliminary}>{t('emergency.dismiss')}</Text>
        </TouchableOpacity>
      </Animated.View>
    );
  }

  // ── Active phase ────────────────────────────────────────────────────────
  const urgencyColor =
    secondsLeft > 60 ? '#FFEB3B' :
    secondsLeft > 30 ? '#FF9800' :
    '#FF1744';

  return (
    <Animated.View
      style={[styles.banner, styles.bannerActive, { transform: [{ translateY: slideAnim }] }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      accessibilityLabel={
        `${t('emergency.active')} ${activeAlert.threatOrigin}. ` +
        `${t('emergency.impactTime', { seconds: secondsLeft })}`
      }
    >
      {/* Pulsing background tint */}
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.pulseBgActive, { opacity: pulseOpacity }]}
        pointerEvents="none"
      />

      <Text style={styles.titleActive}>{t('emergency.active')}</Text>
      <Text style={styles.subtitleActive}>{t('emergency.activeSubtitle')}</Text>

      <Text style={styles.threatActive}>
        {activeAlert.threatOrigin}
      </Text>

      {activeAlert.regions.length > 0 && (
        <Text style={styles.regionsActive}>
          {activeAlert.regions.join(' · ')}
        </Text>
      )}

      <Text style={[styles.countdownActive, { color: urgencyColor }]}>
        {secondsLeft}
      </Text>
      <Text style={styles.countdownActiveLabel}>
        {t('emergency.impactTime', { seconds: '' }).replace('{{seconds}}', '').trim()}
      </Text>

      {nearestShelter && (
        <View style={styles.shelterBox}>
          <Text style={styles.shelterLabel}>
            {t('emergency.reroutingTo', { name: nearestShelter.name })}
          </Text>
          {nearestShelter.etaMinutes != null && (
            <Text style={styles.shelterEta}>
              {t('emergency.shelterEta', { minutes: nearestShelter.etaMinutes })}
            </Text>
          )}
        </View>
      )}

      <Text style={styles.instructionsActive}>
        {t('emergency.instructions.rockets')}
      </Text>

      <TouchableOpacity style={styles.dismissButton} onPress={handleDismiss}>
        <Text style={styles.dismissText}>{t('emergency.dismiss')}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 999,
    paddingTop: 52,
    paddingBottom: 18,
    paddingHorizontal: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 20,
  },

  // ── Preliminary ────────────────────────────────────────────────────
  bannerPreliminary: {
    backgroundColor: '#E65100',  // deep amber/orange
  },
  titlePreliminary: {
    fontSize: 24,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  subtitlePreliminary: {
    fontSize: 15,
    color: '#FFE0B2',
    marginTop: 2,
    fontWeight: '600',
  },
  threatPreliminary: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFF9C4',
    marginTop: 6,
    textAlign: 'center',
  },
  regionsPreliminary: {
    fontSize: 13,
    color: '#FFCC80',
    marginTop: 2,
    textAlign: 'center',
  },
  countdownBoxPreliminary: {
    alignItems: 'center',
    marginTop: 10,
  },
  countdownLabel: {
    color: '#FFE0B2',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  countdownPreliminary: {
    fontSize: 56,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -2,
    lineHeight: 60,
  },
  instructionsPreliminary: {
    fontSize: 13,
    color: '#FFE0B2',
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 18,
  },
  dismissButtonPreliminary: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  dismissTextPreliminary: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
  },

  // ── Active ─────────────────────────────────────────────────────────
  bannerActive: {
    backgroundColor: '#B71C1C',  // deep red
  },
  pulseBgActive: {
    backgroundColor: '#E53935',
  },
  titleActive: {
    fontSize: 28,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 1,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  subtitleActive: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFCDD2',
    marginTop: 2,
  },
  threatActive: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFEB3B',
    marginTop: 4,
    textAlign: 'center',
  },
  regionsActive: {
    fontSize: 13,
    color: '#EF9A9A',
    marginTop: 2,
    textAlign: 'center',
  },
  countdownActive: {
    fontSize: 64,
    fontWeight: '900',
    marginTop: 8,
    letterSpacing: -2,
    lineHeight: 68,
    // color is set dynamically
  },
  countdownActiveLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: -4,
    marginBottom: 6,
  },
  instructionsActive: {
    fontSize: 13,
    color: '#FFCDD2',
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 18,
  },

  // ── Take cover (t=0) ───────────────────────────────────────────────
  bannerTakeCover: {
    backgroundColor: '#000000',
    justifyContent: 'center',
    minHeight: 200,
  },
  pulseBgBlack: {
    backgroundColor: '#D32F2F',
  },
  takeCoverText: {
    fontSize: 36,
    fontWeight: '900',
    color: '#FF1744',
    textAlign: 'center',
    letterSpacing: 1,
    textShadowColor: 'rgba(255,23,68,0.4)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },

  // ── Shared ─────────────────────────────────────────────────────────
  shelterBox: {
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginTop: 6,
    alignItems: 'center',
    width: '100%',
  },
  shelterLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  shelterEta: {
    color: '#FFCCBC',
    fontSize: 17,
    fontWeight: '800',
    marginTop: 2,
  },
  dismissButton: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  dismissText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
  },
});
