/**
 * EmergencyBanner.tsx
 *
 * The highest-priority UI element in the app. Displayed as a full-width
 * absolute overlay at the top of MapScreen when isEmergencyMode is true.
 *
 * Design requirements:
 *  - MUST be impossible to miss: large fonts, high-contrast red background
 *  - Shows threat origin, countdown timer (live, ticking every second), ETA
 *  - Slides down from the top with a spring animation on appearance
 *  - Pulses (opacity) to draw the eye during the critical first 10 seconds
 *  - Dismiss button exists but is styled to discourage casual use
 *
 * Accessibility:
 *  - accessibilityLiveRegion="polite" announces changes to screen readers
 *  - accessibilityRole="alert" for VoiceOver / TalkBack priority
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
        Animated.timing(pulseAnim, {
          toValue: 0.75,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulseAnim]);

  return pulseAnim;
}

// ─── Component ─────────────────────────────────────────────────────────────
export default function EmergencyBanner() {
  const { t }                                           = useTranslation();
  const { activeAlert, nearestShelter, clearEmergency } = useAlertStore();

  // Countdown state – starts at alert's timeToImpact and ticks down
  const [secondsLeft, setSecondsLeft] = useState(activeAlert?.timeToImpact ?? 90);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Slide-down animation
  const slideAnim = useRef(new Animated.Value(-300)).current;

  // Pulse opacity (fast for first 10 s, then stop to reduce distraction)
  const [isPulsing, setIsPulsing] = useState(true);
  const pulseOpacity = usePulse(isPulsing);

  // ── On mount: slide in + start countdown ───────────────────────────────
  useEffect(() => {
    // Haptic vibration burst on alert appearance
    if (Platform.OS !== 'web') {
      Vibration.vibrate([0, 400, 200, 400, 200, 400]);
    }

    // Slide down from above the screen
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 6,
      speed: 14,
    }).start();

    // Reset countdown to the alert's stated time-to-impact
    setSecondsLeft(activeAlert?.timeToImpact ?? 90);

    // Tick every second
    countdownRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        const next = Math.max(0, prev - 1);
        if (next === 0 && countdownRef.current) {
          clearInterval(countdownRef.current);
        }
        return next;
      });
    }, 1000);

    // Stop pulsing after 10 seconds (pulse has done its job)
    const pulseTimer = setTimeout(() => setIsPulsing(false), 10_000);

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      clearTimeout(pulseTimer);
    };
  }, [activeAlert, slideAnim]);

  // ── Dismiss handler ─────────────────────────────────────────────────────
  const handleDismiss = useCallback(() => {
    // Vibrate once more as a warning that the user is dismissing an alert
    Vibration.vibrate(100);
    clearEmergency();
  }, [clearEmergency]);

  if (!activeAlert) return null;

  // ── Countdown colour: yellow → orange → red as time runs out ───────────
  const urgencyColor =
    secondsLeft > 60 ? '#FFEB3B' :   // yellow
    secondsLeft > 30 ? '#FF9800' :   // orange
    '#FF1744';                         // bright red

  return (
    <Animated.View
      style={[styles.banner, { transform: [{ translateY: slideAnim }] }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={
        `Emergency alert: Threat from ${activeAlert.threatOrigin}. ` +
        `${secondsLeft} seconds to impact. ` +
        `Nearest shelter: ${nearestShelter?.name ?? 'unknown'}.`
      }
    >
      {/* Pulsing background tint */}
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.pulseBg, { opacity: pulseOpacity }]}
        pointerEvents="none"
      />

      {/* ── Alert title ────────────────────────────────────────────── */}
      <Text style={styles.title}>{t('emergency.banner')}</Text>

      {/* ── Threat origin ──────────────────────────────────────────── */}
      <Text style={styles.threat}>
        {t('emergency.threat', { origin: activeAlert.threatOrigin })}
      </Text>

      {/* Affected regions */}
      {activeAlert.regions.length > 0 && (
        <Text style={styles.regions}>
          {activeAlert.regions.join(' · ')}
        </Text>
      )}

      {/* ── Countdown timer ─────────────────────────────────────────── */}
      <Text style={[styles.countdown, { color: urgencyColor }]}>
        {t('emergency.impact', { seconds: secondsLeft })}
      </Text>

      {/* ── Nearest shelter ETA ─────────────────────────────────────── */}
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

      {/* ── Dismiss (de-emphasised) ──────────────────────────────────── */}
      <TouchableOpacity
        style={styles.dismissButton}
        onPress={handleDismiss}
        accessibilityRole="button"
        accessibilityLabel={t('emergency.dismiss')}
      >
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
    backgroundColor: '#B71C1C',    // deep red
    paddingTop: 52,                 // clear the status bar
    paddingBottom: 18,
    paddingHorizontal: 20,
    alignItems: 'center',
    // Shadow so it floats above the map
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 20,
  },
  pulseBg: {
    backgroundColor: '#E53935',
    borderRadius: 0,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 1,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  threat: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFEB3B',
    marginTop: 4,
  },
  regions: {
    fontSize: 13,
    color: '#EF9A9A',
    marginTop: 2,
    textAlign: 'center',
  },
  countdown: {
    fontSize: 42,
    fontWeight: '900',
    marginTop: 10,
    marginBottom: 6,
    letterSpacing: -1,
    // color is set dynamically above
  },
  shelterBox: {
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginTop: 4,
    alignItems: 'center',
    width: '100%',
  },
  shelterLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  shelterEta: {
    color: '#FFCCBC',
    fontSize: 18,
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
