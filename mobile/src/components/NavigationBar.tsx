/**
 * NavigationBar.tsx
 *
 * Turn-by-turn navigation overlay displayed at the top of MapScreen during
 * active navigation (non-emergency mode).
 *
 * Key behaviour:
 *  - Reads steps and currentStepIndex from the navigationStore
 *  - Watches currentLocation (GPS); when the user is within ADVANCE_RADIUS_M
 *    of the current step's endLocation, it advances to the next step
 *  - Steps advance based on REAL GPS position — never on a timer
 *  - Shows maneuver icon + Hebrew instruction + distance to next turn
 */

import React, { useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigationStore } from '../store/navigationStore';
import { haversineMeters } from '../utils/haversine';

/** Advance to the next step when user is within this many metres of step end. */
const ADVANCE_RADIUS_M = 50;

// ─── Maneuver → display icon ─────────────────────────────────────────────
const MANEUVER_ICONS: Record<string, string> = {
  'turn-right':        '↱',
  'turn-left':         '↰',
  'turn-sharp-right':  '↱',
  'turn-sharp-left':   '↰',
  'turn-slight-right': '↗',
  'turn-slight-left':  '↖',
  'keep-right':        '↗',
  'keep-left':         '↖',
  'roundabout-right':  '↻',
  'roundabout-left':   '↺',
  'uturn-right':       '↩',
  'uturn-left':        '↩',
  'merge':             '⬆',
  'ramp-right':        '↗',
  'ramp-left':         '↖',
  'ferry':             '⛴',
  'straight':          '⬆',
  'arrive':            '🏁',
};

/** Hebrew fallback label for maneuvers (used when Google API has no instruction text). */
const MANEUVER_HEBREW: Record<string, string> = {
  'turn-right':        'פנה ימינה',
  'turn-left':         'פנה שמאלה',
  'turn-sharp-right':  'פנה חד ימינה',
  'turn-sharp-left':   'פנה חד שמאלה',
  'turn-slight-right': 'פנה מעט ימינה',
  'turn-slight-left':  'פנה מעט שמאלה',
  'keep-right':        'שמור על נתיב ימני',
  'keep-left':         'שמור על נתיב שמאלי',
  'roundabout-right':  'בכיכר פנה ימינה',
  'roundabout-left':   'בכיכר פנה שמאלה',
  'uturn-right':       'בצע פניית פרסה',
  'uturn-left':        'בצע פניית פרסה',
  'merge':             'התמזג לנתיב',
  'ramp-right':        'עלה על הרמפה ימינה',
  'ramp-left':         'עלה על הרמפה שמאלה',
  'ferry':             'קח מעבורת',
  'straight':          'המשך ישר',
};

// ─── Component ─────────────────────────────────────────────────────────────
export default function NavigationBar() {
  const { t } = useTranslation();

  const {
    currentLocation,
    steps,
    currentStepIndex,
    setCurrentStepIndex,
    isNavigating,
  } = useNavigationStore();

  // ── GPS-based step advancement ─────────────────────────────────────────
  // This runs every time the user's GPS position is updated.
  // It does NOT use a timer — the step only advances when the user physically
  // reaches the end of the current step.
  useEffect(() => {
    if (!isNavigating || !currentLocation || steps.length === 0) return;
    if (currentStepIndex >= steps.length) return;

    const step = steps[currentStepIndex];
    const distToStepEnd = haversineMeters(currentLocation, step.endLocation);

    if (distToStepEnd <= ADVANCE_RADIUS_M && currentStepIndex < steps.length - 1) {
      setCurrentStepIndex(currentStepIndex + 1);
    }
  }, [currentLocation, currentStepIndex, isNavigating, steps, setCurrentStepIndex]);

  if (!isNavigating || steps.length === 0) return null;

  const safeIndex = Math.min(currentStepIndex, steps.length - 1);
  const step      = steps[safeIndex];
  const isLast    = safeIndex >= steps.length - 1;
  const icon      = isLast ? '🏁' : (MANEUVER_ICONS[step.maneuver] ?? '⬆');

  // Use the API instruction if it has content; otherwise fall back to Hebrew
  const instruction = step.instruction.length > 0
    ? step.instruction
    : (MANEUVER_HEBREW[step.maneuver] ?? t('nav.straight'));

  // Distance label for the NEXT step after this one (look-ahead)
  const nextStep = !isLast ? steps[safeIndex + 1] : null;

  return (
    <View style={styles.container}>
      {/* Maneuver icon */}
      <View style={styles.iconBox}>
        <Text style={styles.icon}>{icon}</Text>
      </View>

      {/* Instruction + distance */}
      <View style={styles.textBox}>
        <Text style={styles.instruction} numberOfLines={2}>
          {isLast ? t('nav.arrive') : instruction}
        </Text>
        {!isLast && (
          <Text style={styles.distance}>
            {t('nav.in')} {step.distanceText}
          </Text>
        )}
      </View>

      {/* Next step preview */}
      {nextStep && (
        <View style={styles.nextBox}>
          <Text style={styles.nextIcon}>
            {MANEUVER_ICONS[nextStep.maneuver] ?? '⬆'}
          </Text>
          <Text style={styles.nextDistance} numberOfLines={1}>
            {nextStep.distanceText}
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 54 : 36,
    left: 0,
    right: 0,
    zIndex: 50,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1565C0',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 10,
  },
  iconBox: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 28,
    color: '#FFFFFF',
  },
  textBox: {
    flex: 1,
  },
  instruction: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 22,
  },
  distance: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    marginTop: 2,
  },
  nextBox: {
    alignItems: 'center',
    paddingLeft: 8,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.3)',
  },
  nextIcon: {
    fontSize: 20,
    color: 'rgba(255,255,255,0.7)',
  },
  nextDistance: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    marginTop: 2,
  },
});
