import { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/lib/api';
import { theme } from '@/src/lib/theme';

type Ev = {
  id: string; matchday: number; player_name: string; team: string;
  kind: string; minute: number; description: string; created_at: string;
};

const KIND_META: Record<string, { icon: any; color: string; label: string }> = {
  goal: { icon: 'football', color: '#10B981', label: 'GOL' },
  assist: { icon: 'sparkles', color: '#D4AF37', label: 'ASSIST' },
  yellow: { icon: 'square', color: '#F59E0B', label: 'AMMONIZIONE' },
  red: { icon: 'square', color: '#EF4444', label: 'ESPULSIONE' },
  own_goal: { icon: 'close-circle', color: '#EF4444', label: 'AUTOGOL' },
  penalty_saved: { icon: 'hand-left', color: '#3B82F6', label: 'RIGORE PARATO' },
  penalty_missed: { icon: 'close', color: '#F59E0B', label: 'RIGORE SBAGLIATO' },
  sub: { icon: 'swap-horizontal', color: '#9CA3AF', label: 'CAMBIO' },
  kick_off: { icon: 'flag', color: '#9CA3AF', label: 'INIZIO' },
  half_time: { icon: 'time', color: '#9CA3AF', label: 'PRIMO TEMPO' },
  full_time: { icon: 'flag-outline', color: '#9CA3AF', label: 'FINE' },
};

export default function LiveFeed() {
  const router = useRouter();
  const [events, setEvents] = useState<Ev[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [matchday, setMatchday] = useState(6);
  const pollRef = useRef<any>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.liveEvents(matchday);
      setEvents(data);
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [matchday]);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 8000);
    return () => clearInterval(pollRef.current);
  }, [load]);

  const goals = events.filter(e => e.kind === 'goal').length;
  const assists = events.filter(e => e.kind === 'assist').length;
  const cards = events.filter(e => e.kind === 'yellow' || e.kind === 'red').length;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="live-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="live-back" hitSlop={8}>
          <Ionicons name="arrow-back" size={20} color={theme.colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Live</Text>
          <Text style={styles.subtitle}>{matchday}ª Giornata · in diretta</Text>
        </View>
        <View style={styles.livePill}>
          <View style={styles.liveDot} />
          <Text style={styles.livePillText}>IN DIRETTA</Text>
        </View>
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Ionicons name="football" size={16} color={theme.colors.success} />
          <Text style={styles.statVal}>{goals}</Text>
          <Text style={styles.statLbl}>Gol</Text>
        </View>
        <View style={styles.statCard}>
          <Ionicons name="sparkles" size={16} color={theme.colors.brandSecondary} />
          <Text style={styles.statVal}>{assists}</Text>
          <Text style={styles.statLbl}>Assist</Text>
        </View>
        <View style={styles.statCard}>
          <Ionicons name="square" size={16} color={theme.colors.warning} />
          <Text style={styles.statVal}>{cards}</Text>
          <Text style={styles.statLbl}>Cartellini</Text>
        </View>
      </View>

      {/* Matchday selector */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}>
        {[3, 4, 5, 6, 7, 8].map((md) => {
          const active = md === matchday;
          return (
            <Pressable key={md} onPress={() => setMatchday(md)}
              testID={`md-chip-${md}`}
              style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{md}ª Giornata</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.colors.brandSecondary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.colors.brandSecondary} />}
        >
          {events.map((e, i) => {
            const meta = KIND_META[e.kind] || KIND_META.sub;
            const bonus = e.kind === 'goal' ? '+3' : e.kind === 'assist' ? '+1' :
                          e.kind === 'yellow' ? '-0.5' : e.kind === 'red' ? '-1' :
                          e.kind === 'own_goal' ? '-2' : e.kind === 'penalty_saved' ? '+3' :
                          e.kind === 'penalty_missed' ? '-3' : null;
            return (
              <View key={e.id} style={styles.eventCard} testID={`live-event-${i}`}>
                <View style={[styles.eventIcon, { backgroundColor: meta.color + '22' }]}>
                  <Ionicons name={meta.icon} size={18} color={meta.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.eventTop}>
                    <Text style={styles.eventPlayer} numberOfLines={1}>{e.player_name}</Text>
                    <Text style={styles.minuteLbl}>{e.minute}'</Text>
                  </View>
                  <Text style={styles.eventDesc} numberOfLines={2}>{e.description}</Text>
                  <View style={styles.eventBottom}>
                    <View style={[styles.tag, { backgroundColor: meta.color + '18', borderColor: meta.color + '55' }]}>
                      <Text style={[styles.tagText, { color: meta.color }]}>{meta.label}</Text>
                    </View>
                    <Text style={styles.teamText}>{e.team}</Text>
                    {bonus && (
                      <View style={[styles.bonus, { borderColor: meta.color, backgroundColor: meta.color + '18' }]}>
                        <Text style={[styles.bonusText, { color: meta.color }]}>{bonus}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>
            );
          })}
          {events.length === 0 && (
            <Text style={styles.empty}>Nessun evento per la giornata selezionata</Text>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm,
  },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.surfaceSecondary, borderWidth: 1, borderColor: theme.colors.border },
  title: { color: theme.colors.onSurface, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: theme.colors.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(239,68,68,0.15)', paddingHorizontal: 8, paddingVertical: 5,
    borderRadius: theme.radius.pill, borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)' },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.error },
  livePillText: { color: theme.colors.error, fontSize: 10, fontWeight: '800', letterSpacing: 1 },

  statsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: theme.spacing.lg, marginTop: theme.spacing.sm },
  statCard: { flex: 1, backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: theme.colors.border,
    alignItems: 'center', gap: 4 },
  statVal: { color: theme.colors.onSurface, fontSize: 20, fontWeight: '800' },
  statLbl: { color: theme.colors.onSurfaceSecondary, fontSize: 10, fontWeight: '600', letterSpacing: 0.6 },

  chipRow: { height: 56, paddingHorizontal: theme.spacing.lg, gap: 8, alignItems: 'center' },
  chip: { height: 36, paddingHorizontal: 14, borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceSecondary, borderWidth: 1, borderColor: theme.colors.border,
    justifyContent: 'center', flexShrink: 0 },
  chipActive: { backgroundColor: theme.colors.brandSecondary, borderColor: theme.colors.brandSecondary },
  chipText: { color: theme.colors.onSurface, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: theme.colors.onBrandSecondary, fontWeight: '800' },

  eventCard: {
    flexDirection: 'row', gap: 12, padding: 12,
    backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border, marginBottom: 8,
  },
  eventIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  eventTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eventPlayer: { color: theme.colors.onSurface, fontSize: 15, fontWeight: '800', flex: 1 },
  minuteLbl: { color: theme.colors.brandSecondary, fontSize: 15, fontWeight: '800' },
  eventDesc: { color: theme.colors.onSurfaceSecondary, fontSize: 12, marginTop: 3, marginBottom: 6 },
  eventBottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.pill, borderWidth: 1 },
  tagText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  teamText: { color: theme.colors.onSurfaceSecondary, fontSize: 11, fontWeight: '600', flex: 1 },
  bonus: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  bonusText: { fontSize: 12, fontWeight: '800' },

  empty: { color: theme.colors.onSurfaceSecondary, textAlign: 'center', paddingVertical: 40 },
});
