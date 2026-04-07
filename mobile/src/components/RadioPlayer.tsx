/**
 * RadioPlayer.tsx
 *
 * Embedded live radio player for Israeli broadcast stations.
 * Uses expo-av Audio for HLS/stream playback.
 *
 * Stations list uses official / well-known streaming endpoints.
 * If a stream URL changes, update the STATIONS array below.
 *
 * NOTE: Run `npm install` after adding expo-av to package.json.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Audio } from 'expo-av';

// ─── Station definitions ───────────────────────────────────────────────────
export interface RadioStation {
  id: string;
  name: string;
  description: string;
  url: string;
  freq: string;
}

export const STATIONS: RadioStation[] = [
  {
    id: 'kan88',
    name: 'כאן 88',
    description: 'חדשות, תרבות וספורט',
    url: 'https://radio.kan.org.il/Kan88.m3u8',
    freq: '88 FM',
  },
  {
    id: 'kanbet',
    name: "כאן ב'",
    description: 'ידע ומידע — תוכניות עומק',
    url: 'https://radio.kan.org.il/KanBet.m3u8',
    freq: "כאן ב'",
  },
  {
    id: 'kangimel',
    name: 'כאן גימל',
    description: 'מוזיקה ישראלית קלאסית',
    url: 'https://radio.kan.org.il/KanGimel.m3u8',
    freq: "כאן ג'",
  },
  {
    id: 'galgalatz',
    name: 'גלגלץ',
    description: 'להיטים ישראלים ובינלאומיים — רדיו צבאי',
    url: 'https://glzwizzweb.rcs.revma.com/an1ugyygzk8uv',
    freq: '91.8 FM',
  },
  {
    id: 'galei',
    name: 'גלי צה"ל',
    description: 'חדשות, מוזיקה ואקטואליה',
    url: 'https://galey-zahal.rcs.revma.com/anysj3pw8k8uv',
    freq: '95.5 FM',
  },
  {
    id: '103fm',
    name: 'רדיו 103 FM',
    description: 'חדשות ותוכניות בידור',
    url: 'https://103fm.rcs.revma.com/yu4nnxtxkk8uv',
    freq: '103 FM',
  },
];

// ─── Component ─────────────────────────────────────────────────────────────
export default function RadioPlayer() {
  const { t } = useTranslation();

  const [playing, setPlaying]           = useState<RadioStation | null>(null);
  const [loading, setLoading]           = useState(false);
  const [showPicker, setShowPicker]     = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);

  // ── Clean up audio on unmount ──────────────────────────────────────────
  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => null);
    };
  }, []);

  // ── Stop any current playback ──────────────────────────────────────────
  const stopAudio = useCallback(async () => {
    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
      } catch {
        // ignore if already unloaded
      }
      soundRef.current = null;
    }
    setPlaying(null);
  }, []);

  // ── Play a station ──────────────────────────────────────────────────────
  const playStation = useCallback(async (station: RadioStation) => {
    setShowPicker(false);
    setLoading(true);

    // Stop current track first
    await stopAudio();

    try {
      // Configure audio session for live streaming
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      const { sound } = await Audio.Sound.createAsync(
        { uri: station.url },
        { shouldPlay: true, isLooping: false, volume: 1.0 }
      );

      soundRef.current = sound;
      setPlaying(station);
    } catch (err) {
      console.error('[RadioPlayer] Playback error:', err);
      Alert.alert(
        t('radio.errorTitle'),
        t('radio.errorBody'),
        [{ text: t('common.ok') }]
      );
    } finally {
      setLoading(false);
    }
  }, [stopAudio, t]);

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {/* Radio icon + label */}
        <Text style={styles.label}>📻 {t('radio.title')}</Text>

        {/* Stop button (only when playing) */}
        {playing && !loading && (
          <TouchableOpacity style={styles.stopBtn} onPress={stopAudio}>
            <Text style={styles.stopBtnText}>■ {t('radio.stop')}</Text>
          </TouchableOpacity>
        )}

        {/* Spinner when loading */}
        {loading && <ActivityIndicator size="small" color="#1565C0" />}

        {/* Open picker */}
        {!loading && (
          <TouchableOpacity
            style={styles.pickBtn}
            onPress={() => setShowPicker(true)}
          >
            <Text style={styles.pickBtnText}>{t('radio.select')} ▾</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Now playing */}
      {playing && (
        <Text style={styles.nowPlaying} numberOfLines={1}>
          🎵 {playing.name} — {playing.description}
        </Text>
      )}

      {/* Station picker modal */}
      <Modal
        visible={showPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPicker(false)}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setShowPicker(false)}
        />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{t('radio.selectTitle')}</Text>
          <FlatList
            data={STATIONS}
            keyExtractor={(s) => s.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.stationRow,
                  playing?.id === item.id && styles.stationRowActive,
                ]}
                onPress={() => playStation(item)}
                activeOpacity={0.75}
              >
                <View style={styles.stationInfo}>
                  <Text style={styles.stationName}>{item.name}</Text>
                  <Text style={styles.stationDesc}>{item.description}</Text>
                </View>
                <Text style={styles.stationFreq}>{item.freq}</Text>
                {playing?.id === item.id && (
                  <Text style={styles.playingDot}>▶</Text>
                )}
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    backgroundColor: '#EEF4FF',
    borderRadius: 14,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#C5D9F1',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#1B2631',
  },
  stopBtn: {
    backgroundColor: '#E53935',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  stopBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  pickBtn: {
    backgroundColor: '#1565C0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pickBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  nowPlaying: {
    marginTop: 6,
    fontSize: 12,
    color: '#1565C0',
    fontWeight: '600',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingBottom: 32,
    maxHeight: '60%',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CFD8DC',
    marginBottom: 12,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1B2631',
    textAlign: 'center',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  stationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#ECEFF1',
    gap: 10,
  },
  stationRowActive: {
    backgroundColor: '#E3F2FD',
  },
  stationInfo: {
    flex: 1,
  },
  stationName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1B2631',
  },
  stationDesc: {
    fontSize: 12,
    color: '#546E7A',
    marginTop: 2,
  },
  stationFreq: {
    fontSize: 12,
    color: '#90A4AE',
    fontWeight: '600',
  },
  playingDot: {
    color: '#1565C0',
    fontSize: 14,
    marginLeft: 4,
  },
});
