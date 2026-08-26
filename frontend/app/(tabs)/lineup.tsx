import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/lib/api';
import { theme, roleColors } from '@/src/lib/theme';
import { useLeague } from '@/src/lib/league';

type P = { id: string; name: string; team: string; role: string; goals: number; assists: number; avg_vote: number };

// 4-3-3 slot layout as %
const SLOTS = [
  // GK
  { role: 'P', top: 82, left: 50 },
  // DEF (4)
  { role: 'D', top: 63, left: 15 },
  { role: 'D', top: 63, left: 38 },
  { role: 'D', top: 63, left: 62 },
  { role: 'D', top: 63, left: 85 },
  // MID (3)
  { role: 'C', top: 42, left: 25 },
  { role: 'C', top: 42, left: 50 },
  { role: 'C', top: 42, left: 75 },
  // ATT (3)
  { role: 'A', top: 20, left: 20 },
  { role: 'A', top: 15, left: 50 },
  { role: 'A', top: 20, left: 80 },
];

export default function Lineup() {
  const { league } = useLeague();
  const [players, setPlayers] = useState<Record<string, P[]>>({ P: [], D: [], C: [], A: [] });

  useEffect(() => {
    (async () => {
      const all = await api.players();
      const byRole: Record<string, P[]> = { P: [], D: [], C: [], A: [] };
      all.forEach((p: P) => byRole[p.role]?.push(p));
      setPlayers(byRole);
    })();
  }, []);

  // pick top players for each slot
  const chosen = SLOTS.map((slot, i) => {
    const rolePlayers = players[slot.role] || [];
    const idxInRole = SLOTS.slice(0, i).filter(s => s.role === slot.role).length;
    const p = rolePlayers[idxInRole];
    return { slot, player: p };
  });

  const totalGoals = chosen.reduce((s, c) => s + (c.player?.goals || 0), 0);
  const totalAssists = chosen.reduce((s, c) => s + (c.player?.assists || 0), 0);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="lineup-screen">
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Formazione</Text>
          <Text style={styles.subtitle}>4-3-3 · La tua schierabile</Text>
        </View>
        <Pressable style={styles.formationBtn} hitSlop={8} testID="formation-selector">
          <Ionicons name="grid" size={14} color={theme.colors.brandSecondary} />
          <Text style={styles.formationText}>4-3-3</Text>
        </Pressable>
      </View>

      {/* Pitch */}
      <View style={styles.pitchWrap}>
        <View style={styles.pitch}>
          {/* pitch lines */}
          <View style={styles.centerLine} />
          <View style={styles.centerCircle} />
          <View style={styles.goalBoxTop} />
          <View style={styles.goalBoxBottom} />

          {chosen.map(({ slot, player }, i) => {
            const tint = roleColors[slot.role];
            return (
              <View key={i}
                testID={`lineup-slot-${i}`}
                style={[styles.chip, {
                  top: `${slot.top}%`,
                  left: `${slot.left}%`,
                  borderColor: tint + '99',
                  transform: [{ translateX: -32 }],
                }]}>
                <View style={[styles.chipDot, { backgroundColor: tint }]}>
                  <Text style={styles.chipDotText}>{slot.role}</Text>
                </View>
                <Text style={styles.chipName} numberOfLines={1}>
                  {player ? player.name.split(' ').slice(-1)[0] : '—'}
                </Text>
              </View>
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
          <Text style={styles.statValue}>{chosen.filter(c => c.player).length}/11</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.md },
  title: { color: theme.colors.onSurface, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: theme.colors.onSurfaceSecondary, fontSize: 13, marginTop: 2 },
  formationBtn: { flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: 'rgba(212,175,55,0.12)',
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: 'rgba(212,175,55,0.35)' },
  formationText: { color: theme.colors.brandSecondary, fontSize: 12, fontWeight: '700' },

  pitchWrap: { paddingHorizontal: theme.spacing.md, marginTop: 8 },
  pitch: {
    aspectRatio: 0.7,
    backgroundColor: theme.colors.pitch,
    borderRadius: theme.radius.lg,
    borderWidth: 2, borderColor: theme.colors.pitchLine,
    overflow: 'hidden', position: 'relative',
  },
  centerLine: { position: 'absolute', top: '50%', left: 0, right: 0, height: 1.5, backgroundColor: theme.colors.pitchLine },
  centerCircle: { position: 'absolute', top: '50%', left: '50%', width: 90, height: 90, borderRadius: 45,
    borderWidth: 1.5, borderColor: theme.colors.pitchLine, transform: [{ translateX: -45 }, { translateY: -45 }] },
  goalBoxTop: { position: 'absolute', top: 0, left: '20%', right: '20%', height: '12%',
    borderLeftWidth: 1.5, borderRightWidth: 1.5, borderBottomWidth: 1.5, borderColor: theme.colors.pitchLine,
    borderBottomLeftRadius: 4, borderBottomRightRadius: 4 },
  goalBoxBottom: { position: 'absolute', bottom: 0, left: '20%', right: '20%', height: '12%',
    borderLeftWidth: 1.5, borderRightWidth: 1.5, borderTopWidth: 1.5, borderColor: theme.colors.pitchLine,
    borderTopLeftRadius: 4, borderTopRightRadius: 4 },

  chip: {
    position: 'absolute', width: 64, alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(13,15,18,0.72)', paddingVertical: 6, paddingHorizontal: 4,
    borderRadius: theme.radius.md, borderWidth: 1.5,
  },
  chipDot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  chipDotText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  chipName: { color: theme.colors.onSurface, fontSize: 10, fontWeight: '700' },

  stats: { flexDirection: 'row', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.lg },
  statCard: { flex: 1, backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.md,
    padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border },
  statLabel: { color: theme.colors.onSurfaceSecondary, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 },
  statValue: { color: theme.colors.onSurface, fontSize: 22, fontWeight: '800', marginTop: 6 },
});
