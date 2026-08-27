import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/lib/api';
import { theme, roleColors } from '@/src/lib/theme';

type P = { id: string; name: string; team: string; role: string; goals: number; assists: number; avg_vote: number };
type SlotRole = 'P' | 'D' | 'C' | 'A';
type Slot = { role: SlotRole; top: number; left: number };

// All standard 11-a-side football formations
const FORMATIONS: Record<string, Slot[]> = {
  '4-3-3': [
    { role: 'P', top: 84, left: 50 },
    { role: 'D', top: 65, left: 15 }, { role: 'D', top: 65, left: 38 },
    { role: 'D', top: 65, left: 62 }, { role: 'D', top: 65, left: 85 },
    { role: 'C', top: 44, left: 25 }, { role: 'C', top: 44, left: 50 }, { role: 'C', top: 44, left: 75 },
    { role: 'A', top: 21, left: 20 }, { role: 'A', top: 14, left: 50 }, { role: 'A', top: 21, left: 80 },
  ],
  '3-4-3': [
    { role: 'P', top: 84, left: 50 },
    { role: 'D', top: 65, left: 25 }, { role: 'D', top: 65, left: 50 }, { role: 'D', top: 65, left: 75 },
    { role: 'C', top: 44, left: 15 }, { role: 'C', top: 44, left: 38 },
    { role: 'C', top: 44, left: 62 }, { role: 'C', top: 44, left: 85 },
    { role: 'A', top: 21, left: 20 }, { role: 'A', top: 14, left: 50 }, { role: 'A', top: 21, left: 80 },
  ],
  '3-5-2': [
    { role: 'P', top: 84, left: 50 },
    { role: 'D', top: 65, left: 25 }, { role: 'D', top: 65, left: 50 }, { role: 'D', top: 65, left: 75 },
    { role: 'C', top: 44, left: 10 }, { role: 'C', top: 44, left: 30 }, { role: 'C', top: 44, left: 50 },
    { role: 'C', top: 44, left: 70 }, { role: 'C', top: 44, left: 90 },
    { role: 'A', top: 17, left: 36 }, { role: 'A', top: 17, left: 64 },
  ],
  '4-4-2': [
    { role: 'P', top: 84, left: 50 },
    { role: 'D', top: 65, left: 15 }, { role: 'D', top: 65, left: 38 },
    { role: 'D', top: 65, left: 62 }, { role: 'D', top: 65, left: 85 },
    { role: 'C', top: 44, left: 15 }, { role: 'C', top: 44, left: 38 },
    { role: 'C', top: 44, left: 62 }, { role: 'C', top: 44, left: 85 },
    { role: 'A', top: 17, left: 36 }, { role: 'A', top: 17, left: 64 },
  ],
  '4-5-1': [
    { role: 'P', top: 84, left: 50 },
    { role: 'D', top: 65, left: 15 }, { role: 'D', top: 65, left: 38 },
    { role: 'D', top: 65, left: 62 }, { role: 'D', top: 65, left: 85 },
    { role: 'C', top: 44, left: 10 }, { role: 'C', top: 44, left: 30 }, { role: 'C', top: 44, left: 50 },
    { role: 'C', top: 44, left: 70 }, { role: 'C', top: 44, left: 90 },
    { role: 'A', top: 15, left: 50 },
  ],
  '5-3-2': [
    { role: 'P', top: 84, left: 50 },
    { role: 'D', top: 65, left: 10 }, { role: 'D', top: 65, left: 30 }, { role: 'D', top: 65, left: 50 },
    { role: 'D', top: 65, left: 70 }, { role: 'D', top: 65, left: 90 },
    { role: 'C', top: 44, left: 25 }, { role: 'C', top: 44, left: 50 }, { role: 'C', top: 44, left: 75 },
    { role: 'A', top: 17, left: 36 }, { role: 'A', top: 17, left: 64 },
  ],
  '5-4-1': [
    { role: 'P', top: 84, left: 50 },
    { role: 'D', top: 65, left: 10 }, { role: 'D', top: 65, left: 30 }, { role: 'D', top: 65, left: 50 },
    { role: 'D', top: 65, left: 70 }, { role: 'D', top: 65, left: 90 },
    { role: 'C', top: 44, left: 15 }, { role: 'C', top: 44, left: 38 },
    { role: 'C', top: 44, left: 62 }, { role: 'C', top: 44, left: 85 },
    { role: 'A', top: 15, left: 50 },
  ],
};

const FORMATION_KEYS = ['4-3-3', '3-4-3', '3-5-2', '4-4-2', '4-5-1', '5-3-2', '5-4-1'] as const;

export default function Lineup() {
  const router = useRouter();
  const [formation, setFormation] = useState<string>('4-3-3');
  const [players, setPlayers] = useState<Record<SlotRole, P[]>>({ P: [], D: [], C: [], A: [] });

  useEffect(() => {
    (async () => {
      const all = await api.players();
      const byRole: Record<SlotRole, P[]> = { P: [], D: [], C: [], A: [] };
      all.forEach((p: P) => byRole[p.role as SlotRole]?.push(p));
      setPlayers(byRole);
    })();
  }, []);

  const slots = FORMATIONS[formation];

  // Pick top players for each slot based on their order within the formation
  const chosen = useMemo(() => {
    return slots.map((slot, i) => {
      const rolePlayers = players[slot.role] || [];
      const idxInRole = slots.slice(0, i).filter((s) => s.role === slot.role).length;
      return { slot, player: rolePlayers[idxInRole] };
    });
  }, [slots, players]);

  const totalGoals = chosen.reduce((s, c) => s + (c.player?.goals || 0), 0);
  const totalAssists = chosen.reduce((s, c) => s + (c.player?.assists || 0), 0);
  const parts = formation.split('-'); // e.g. ['4','3','3']

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="lineup-screen">
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Formazione</Text>
          <Text style={styles.subtitle}>Modulo {formation} · {parts[0]} DIF · {parts[1]} CEN · {parts[2]} ATT</Text>
        </View>
      </View>

      {/* Formation chip row */}
      <View style={styles.chipRowWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRowContent}
        >
          {FORMATION_KEYS.map((f) => {
            const active = formation === f;
            return (
              <Pressable
                key={f}
                testID={`formation-chip-${f}`}
                onPress={() => setFormation(f)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Ionicons
                  name="grid"
                  size={12}
                  color={active ? theme.colors.onBrandSecondary : theme.colors.brandSecondary}
                />
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{f}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Pitch */}
      <View style={styles.pitchWrap}>
        <View style={styles.pitch} testID={`pitch-${formation}`}>
          {/* pitch lines */}
          <View style={styles.centerLine} />
          <View style={styles.centerCircle} />
          <View style={styles.goalBoxTop} />
          <View style={styles.goalBoxBottom} />

          {chosen.map(({ slot, player }, i) => {
            const tint = roleColors[slot.role];
            return (
              <Pressable
                key={`${formation}-${i}`}
                testID={`lineup-slot-${i}`}
                onPress={() => player && router.push(`/player/${player.id}`)}
                style={({ pressed }) => [
                  styles.chipPlayer,
                  {
                    top: `${slot.top}%`,
                    left: `${slot.left}%`,
                    borderColor: tint + '99',
                    transform: [{ translateX: -32 }],
                  },
                  pressed && player && { opacity: 0.7 },
                ]}
                disabled={!player}
              >
                <View style={[styles.chipDot, { backgroundColor: tint }]}>
                  <Text style={styles.chipDotText}>{slot.role}</Text>
                </View>
                <Text style={styles.chipName} numberOfLines={1}>
                  {player ? player.name.split(' ').slice(-1)[0] : '—'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Stats footer */}
      <ScrollView contentContainerStyle={styles.stats}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Gol totali</Text>
          <Text style={styles.statValue}>{totalGoals}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Assist</Text>
          <Text style={styles.statValue}>{totalAssists}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Titolari</Text>
          <Text style={styles.statValue}>{chosen.filter((c) => c.player).length}/11</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.sm,
  },
  title: { color: theme.colors.onSurface, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: theme.colors.onSurfaceSecondary, fontSize: 12, marginTop: 2 },

  chipRowWrap: { height: 56, justifyContent: 'center' },
  chipRowContent: { paddingHorizontal: theme.spacing.lg, gap: 8, alignItems: 'center' },
  chip: {
    height: 36, paddingHorizontal: 14,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.35)',
    flexShrink: 0,
  },
  chipActive: {
    backgroundColor: theme.colors.brandSecondary,
    borderColor: theme.colors.brandSecondary,
  },
  chipText: { color: theme.colors.brandSecondary, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 },
  chipTextActive: { color: theme.colors.onBrandSecondary, fontWeight: '800' },

  pitchWrap: { paddingHorizontal: theme.spacing.md, marginTop: 4 },
  pitch: {
    aspectRatio: 0.7,
    backgroundColor: theme.colors.pitch,
    borderRadius: theme.radius.lg,
    borderWidth: 2, borderColor: theme.colors.pitchLine,
    overflow: 'hidden', position: 'relative',
  },
  centerLine: { position: 'absolute', top: '50%', left: 0, right: 0, height: 1.5, backgroundColor: theme.colors.pitchLine },
  centerCircle: {
    position: 'absolute', top: '50%', left: '50%', width: 90, height: 90, borderRadius: 45,
    borderWidth: 1.5, borderColor: theme.colors.pitchLine,
    transform: [{ translateX: -45 }, { translateY: -45 }],
  },
  goalBoxTop: {
    position: 'absolute', top: 0, left: '20%', right: '20%', height: '12%',
    borderLeftWidth: 1.5, borderRightWidth: 1.5, borderBottomWidth: 1.5, borderColor: theme.colors.pitchLine,
    borderBottomLeftRadius: 4, borderBottomRightRadius: 4,
  },
  goalBoxBottom: {
    position: 'absolute', bottom: 0, left: '20%', right: '20%', height: '12%',
    borderLeftWidth: 1.5, borderRightWidth: 1.5, borderTopWidth: 1.5, borderColor: theme.colors.pitchLine,
    borderTopLeftRadius: 4, borderTopRightRadius: 4,
  },

  chipPlayer: {
    position: 'absolute', width: 64, alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(13,15,18,0.72)', paddingVertical: 6, paddingHorizontal: 4,
    borderRadius: theme.radius.md, borderWidth: 1.5,
  },
  chipDot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  chipDotText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  chipName: { color: theme.colors.onSurface, fontSize: 10, fontWeight: '700' },

  stats: { flexDirection: 'row', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.lg },
  statCard: {
    flex: 1, backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.md,
    padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border,
  },
  statLabel: { color: theme.colors.onSurfaceSecondary, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 },
  statValue: { color: theme.colors.onSurface, fontSize: 22, fontWeight: '800', marginTop: 6 },
});
