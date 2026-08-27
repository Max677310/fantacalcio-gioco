import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Modal,
  ActivityIndicator, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/lib/api';
import { useAuth } from '@/src/lib/auth';
import { useLeague } from '@/src/lib/league';
import { theme, roleColors, roleLabels } from '@/src/lib/theme';

type P = {
  id: string; name: string; team: string; role: string;
  goals: number; assists: number; avg_vote: number; price: number;
};
type SlotRole = 'P' | 'D' | 'C' | 'A';
type Slot = { role: SlotRole; top: number; left: number };

// All standard 11-a-side football formations
const FORMATIONS: Record<string, Slot[]> = {
  '4-3-3': [
    { role: 'P', top: 84, left: 50 },
    { role: 'D', top: 65, left: 12 }, { role: 'D', top: 65, left: 38 },
    { role: 'D', top: 65, left: 62 }, { role: 'D', top: 65, left: 88 },
    { role: 'C', top: 44, left: 25 }, { role: 'C', top: 44, left: 50 }, { role: 'C', top: 44, left: 75 },
    { role: 'A', top: 20, left: 18 }, { role: 'A', top: 15, left: 50 }, { role: 'A', top: 20, left: 82 },
  ],
  '3-4-3': [
    { role: 'P', top: 84, left: 50 },
    { role: 'D', top: 65, left: 25 }, { role: 'D', top: 65, left: 50 }, { role: 'D', top: 65, left: 75 },
    { role: 'C', top: 44, left: 12 }, { role: 'C', top: 44, left: 38 }, { role: 'C', top: 44, left: 62 }, { role: 'C', top: 44, left: 88 },
    { role: 'A', top: 20, left: 18 }, { role: 'A', top: 15, left: 50 }, { role: 'A', top: 20, left: 82 },
  ],
  '3-5-2': [
    { role: 'P', top: 84, left: 50 },
    { role: 'D', top: 65, left: 25 }, { role: 'D', top: 65, left: 50 }, { role: 'D', top: 65, left: 75 },
    { role: 'C', top: 44, left: 10 }, { role: 'C', top: 44, left: 30 }, { role: 'C', top: 44, left: 50 }, { role: 'C', top: 44, left: 70 }, { role: 'C', top: 44, left: 90 },
    { role: 'A', top: 18, left: 35 }, { role: 'A', top: 18, left: 65 },
  ],
  '4-4-2': [
    { role: 'P', top: 84, left: 50 },
    { role: 'D', top: 65, left: 12 }, { role: 'D', top: 65, left: 38 }, { role: 'D', top: 65, left: 62 }, { role: 'D', top: 65, left: 88 },
    { role: 'C', top: 44, left: 12 }, { role: 'C', top: 44, left: 38 }, { role: 'C', top: 44, left: 62 }, { role: 'C', top: 44, left: 88 },
    { role: 'A', top: 18, left: 35 }, { role: 'A', top: 18, left: 65 },
  ],
  '4-5-1': [
    { role: 'P', top: 84, left: 50 },
    { role: 'D', top: 65, left: 12 }, { role: 'D', top: 65, left: 38 }, { role: 'D', top: 65, left: 62 }, { role: 'D', top: 65, left: 88 },
    { role: 'C', top: 44, left: 10 }, { role: 'C', top: 44, left: 30 }, { role: 'C', top: 44, left: 50 }, { role: 'C', top: 44, left: 70 }, { role: 'C', top: 44, left: 90 },
    { role: 'A', top: 15, left: 50 },
  ],
  '5-3-2': [
    { role: 'P', top: 84, left: 50 },
    { role: 'D', top: 65, left: 10 }, { role: 'D', top: 65, left: 30 }, { role: 'D', top: 65, left: 50 },
    { role: 'D', top: 65, left: 70 }, { role: 'D', top: 65, left: 90 },
    { role: 'C', top: 44, left: 25 }, { role: 'C', top: 44, left: 50 }, { role: 'C', top: 44, left: 75 },
    { role: 'A', top: 18, left: 35 }, { role: 'A', top: 18, left: 65 },
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
  const { user } = useAuth();
  const { league } = useLeague();
  const { height: WH } = useWindowDimensions();

  const [formation, setFormation] = useState<string>('4-3-3');
  const [roster, setRoster] = useState<P[]>([]);
  // starterIds[i] = player_id assigned to slot i (11 entries)
  const [starterIds, setStarterIds] = useState<(string | null)[]>([]);
  const [loading, setLoading] = useState(true);
  // Bottom sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetSlot, setSheetSlot] = useState<number | null>(null); // index of slot being replaced
  const [sheetMode, setSheetMode] = useState<'sub' | 'browse'>('sub'); // 'browse' = show full bench

  const slots = FORMATIONS[formation];

  // Load user's roster
  const loadRoster = useCallback(async () => {
    if (!league || !user) return;
    setLoading(true);
    try {
      const r = await api.roster(league.id, user.id);
      const entries: { player_id: string; price_paid: number }[] = r?.entries || [];
      if (entries.length === 0) { setRoster([]); return; }
      const details: P[] = await Promise.all(
        entries.map((e) => api.player(e.player_id).catch(() => null))
      ).then((arr) => arr.filter(Boolean) as P[]);
      setRoster(details);
    } catch (e) { console.log('roster err', e); }
    finally { setLoading(false); }
  }, [league, user]);

  useEffect(() => { loadRoster(); }, [loadRoster]);

  // Group roster by role
  const rosterByRole: Record<SlotRole, P[]> = useMemo(() => {
    const out: Record<SlotRole, P[]> = { P: [], D: [], C: [], A: [] };
    roster.forEach((p) => out[p.role as SlotRole]?.push(p));
    // sort by avg_vote desc within role
    (Object.keys(out) as SlotRole[]).forEach((r) => {
      out[r].sort((a, b) => (b.avg_vote || 0) - (a.avg_vote || 0));
    });
    return out;
  }, [roster]);

  // Auto-generate starters when formation or roster changes
  useEffect(() => {
    if (roster.length === 0) { setStarterIds(slots.map(() => null)); return; }
    const auto: (string | null)[] = [];
    const used = new Set<string>();
    slots.forEach((slot) => {
      const pool = rosterByRole[slot.role].filter((p) => !used.has(p.id));
      if (pool.length > 0) {
        auto.push(pool[0].id);
        used.add(pool[0].id);
      } else auto.push(null);
    });
    setStarterIds(auto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formation, roster.length]);

  const playerById = useMemo(() => {
    const m: Record<string, P> = {};
    roster.forEach((p) => (m[p.id] = p));
    return m;
  }, [roster]);

  const chosen = useMemo(
    () => slots.map((slot, i) => ({ slot, player: starterIds[i] ? playerById[starterIds[i]!] : undefined })),
    [slots, starterIds, playerById],
  );

  // Bench = roster - starters, grouped by role
  const benchByRole: Record<SlotRole, P[]> = useMemo(() => {
    const usedSet = new Set(starterIds.filter(Boolean) as string[]);
    const out: Record<SlotRole, P[]> = { P: [], D: [], C: [], A: [] };
    roster.forEach((p) => {
      if (!usedSet.has(p.id)) out[p.role as SlotRole]?.push(p);
    });
    (Object.keys(out) as SlotRole[]).forEach((r) => {
      out[r].sort((a, b) => (b.avg_vote || 0) - (a.avg_vote || 0));
    });
    return out;
  }, [roster, starterIds]);

  const totalBench = Object.values(benchByRole).reduce((s, arr) => s + arr.length, 0);
  const chosenCount = chosen.filter((c) => c.player).length;
  const totalGoals = chosen.reduce((s, c) => s + (c.player?.goals || 0), 0);
  const totalAssists = chosen.reduce((s, c) => s + (c.player?.assists || 0), 0);
  const parts = formation.split('-');

  const openSubSheet = (slotIndex: number) => {
    setSheetSlot(slotIndex);
    setSheetMode('sub');
    setSheetOpen(true);
  };
  const openBrowseSheet = () => {
    setSheetSlot(null);
    setSheetMode('browse');
    setSheetOpen(true);
  };

  const performSwap = (newPlayerId: string, slotIndex: number) => {
    // If newPlayer is already a starter elsewhere → swap positions
    const next = [...starterIds];
    const currentInSlot = next[slotIndex];
    const otherIdx = next.findIndex((id) => id === newPlayerId);
    if (otherIdx >= 0) {
      // Swap the two starters
      next[otherIdx] = currentInSlot;
    }
    next[slotIndex] = newPlayerId;
    setStarterIds(next);
    setSheetOpen(false);
  };

  const chipTapAction = (slotIndex: number) => {
    // Long-press → open player detail; short-press → substitute
    openSubSheet(slotIndex);
  };

  // Candidates for the "sub" sheet: same-role bench + can also show other-role
  const subCandidates: P[] = useMemo(() => {
    if (sheetSlot == null) return [];
    const targetRole = slots[sheetSlot].role;
    return benchByRole[targetRole];
  }, [sheetSlot, benchByRole, slots]);

  if (loading) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}><ActivityIndicator color={theme.colors.brandSecondary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="lineup-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Formazione</Text>
        <View style={styles.formationSummary}>
          <Text style={styles.formationText}>{parts[0]}-{parts[1]}-{parts[2]}</Text>
        </View>
      </View>

      {/* Formation picker */}
      <View style={styles.formPicker}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.formPickerContent}>
          {FORMATION_KEYS.map((f) => {
            const active = formation === f;
            return (
              <Pressable
                key={f}
                testID={`formation-chip-${f}`}
                onPress={() => setFormation(f)}
                style={[styles.formChip, active && styles.formChipActive]}
              >
                <Text style={[styles.formChipText, active && styles.formChipTextActive]}>{f}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Pitch */}
      <View style={styles.pitchWrap}>
        <View style={styles.pitch} testID={`pitch-${formation}`}>
          <View style={styles.pitchHalf} />
          <View style={styles.pitchCircle} />
          <View style={styles.pitchTopBox} />
          <View style={styles.pitchBottomBox} />

          {chosen.map(({ slot, player }, i) => {
            const tint = roleColors[slot.role];
            return (
              <Pressable
                key={`${formation}-${i}`}
                testID={`lineup-slot-${i}`}
                onPress={() => chipTapAction(i)}
                onLongPress={() => player && router.push(`/player/${player.id}`)}
                delayLongPress={350}
                style={({ pressed }) => [
                  styles.chipPlayer,
                  {
                    top: `${slot.top}%`,
                    left: `${slot.left}%`,
                    borderColor: tint + '99',
                    transform: [{ translateX: -32 }],
                  },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <View style={[styles.chipDot, { backgroundColor: tint }]}>
                  <Text style={styles.chipDotText}>{slot.role}</Text>
                </View>
                <Text style={styles.chipName} numberOfLines={1}>
                  {player ? player.name.split(' ').slice(-1)[0] : '—'}
                </Text>
                <View style={styles.chipSwapIcon}>
                  <Ionicons name="swap-vertical" size={9} color={theme.colors.onSurface} />
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Bench summary bar (tap to open bottom sheet) */}
      <Pressable
        testID="bench-open-btn"
        onPress={openBrowseSheet}
        style={({ pressed }) => [styles.benchBar, pressed && { opacity: 0.85 }]}
      >
        <View style={styles.benchGrab} />
        <View style={styles.benchBarInner}>
          <Ionicons name="people" size={18} color={theme.colors.brandSecondary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.benchTitle}>Panchina</Text>
            <Text style={styles.benchSub}>{totalBench} riserv{totalBench === 1 ? 'a' : 'e'} disponibili</Text>
          </View>
          <View style={styles.benchRoleDots}>
            {(['P', 'D', 'C', 'A'] as SlotRole[]).map((r) => (
              <View key={r} style={[styles.benchRoleDot, { backgroundColor: roleColors[r] }]}>
                <Text style={styles.benchRoleCount}>{benchByRole[r].length}</Text>
              </View>
            ))}
          </View>
          <Ionicons name="chevron-up" size={20} color={theme.colors.onSurfaceSecondary} />
        </View>
      </Pressable>

      {/* Quick stats */}
      <ScrollView contentContainerStyle={styles.stats} horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Titolari</Text>
          <Text style={[styles.statValue, chosenCount < 11 && { color: theme.colors.error }]}>
            {chosenCount}/11
          </Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Gol totali</Text>
          <Text style={styles.statValue}>{totalGoals}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Assist</Text>
          <Text style={styles.statValue}>{totalAssists}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Panchina</Text>
          <Text style={styles.statValue}>{totalBench}</Text>
        </View>
      </ScrollView>

      {/* Bottom Sheet — bench modal */}
      <Modal
        visible={sheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetOpen(false)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setSheetOpen(false)}>
          <Pressable
            onPress={() => {}}
            style={[styles.sheet, { maxHeight: WH * 0.75 }]}
            testID="bench-sheet"
          >
            <View style={styles.sheetGrab} />
            <View style={styles.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>
                  {sheetMode === 'sub' && sheetSlot != null
                    ? `Sostituisci ${roleLabels[slots[sheetSlot].role]}`
                    : 'Panchina completa'}
                </Text>
                <Text style={styles.sheetSub}>
                  {sheetMode === 'sub' && sheetSlot != null
                    ? `Riserve ${slots[sheetSlot].role} disponibili`
                    : `${totalBench} giocatori · tocca per cambiare ruolo`}
                </Text>
              </View>
              <Pressable onPress={() => setSheetOpen(false)} hitSlop={10} testID="bench-sheet-close">
                <Ionicons name="close" size={26} color={theme.colors.onSurface} />
              </Pressable>
            </View>

            {sheetMode === 'sub' && sheetSlot != null ? (
              <ScrollView
                contentContainerStyle={styles.sheetList}
                showsVerticalScrollIndicator={false}
              >
                {/* Current starter row on top for context */}
                {chosen[sheetSlot]?.player && (
                  <View style={styles.currentStarterRow}>
                    <View style={[styles.roleTag, { backgroundColor: roleColors[slots[sheetSlot].role] + '22', borderColor: roleColors[slots[sheetSlot].role] + '55' }]}>
                      <Text style={[styles.roleTagText, { color: roleColors[slots[sheetSlot].role] }]}>
                        {slots[sheetSlot].role}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.currentStarterName}>{chosen[sheetSlot]!.player!.name}</Text>
                      <Text style={styles.currentStarterMeta}>
                        Titolare attuale · MV {chosen[sheetSlot]!.player!.avg_vote?.toFixed(2)}
                      </Text>
                    </View>
                    <View style={styles.currentBadge}>
                      <Text style={styles.currentBadgeText}>IN CAMPO</Text>
                    </View>
                  </View>
                )}
                <Text style={styles.sectionLabel}>Riserve stesso ruolo ({subCandidates.length})</Text>
                {subCandidates.length === 0 ? (
                  <View style={styles.emptyBox}>
                    <Ionicons name="information-circle-outline" size={20} color={theme.colors.onSurfaceSecondary} />
                    <Text style={styles.emptyText}>
                      Nessuna riserva {roleLabels[slots[sheetSlot].role]} in rosa. Compra dal Mercato.
                    </Text>
                  </View>
                ) : subCandidates.map((p) => (
                  <BenchRow
                    key={p.id}
                    player={p}
                    onPick={() => performSwap(p.id, sheetSlot)}
                    onDetail={() => { setSheetOpen(false); router.push(`/player/${p.id}`); }}
                  />
                ))}
              </ScrollView>
            ) : (
              <ScrollView
                contentContainerStyle={styles.sheetList}
                showsVerticalScrollIndicator={false}
              >
                {(['P', 'D', 'C', 'A'] as SlotRole[]).map((r) => {
                  const arr = benchByRole[r];
                  if (arr.length === 0) return null;
                  return (
                    <View key={r} style={{ marginBottom: 12 }}>
                      <View style={styles.roleGroupHead}>
                        <View style={[styles.roleTag, { backgroundColor: roleColors[r] + '22', borderColor: roleColors[r] + '55' }]}>
                          <Text style={[styles.roleTagText, { color: roleColors[r] }]}>{r}</Text>
                        </View>
                        <Text style={styles.roleGroupTitle}>{roleLabels[r]} ({arr.length})</Text>
                      </View>
                      {arr.map((p) => (
                        <BenchRow
                          key={p.id}
                          player={p}
                          onPick={() => {
                            // In browse mode: swap with first same-role starter
                            const firstSlot = slots.findIndex((s) => s.role === r);
                            if (firstSlot >= 0) performSwap(p.id, firstSlot);
                          }}
                          onDetail={() => { setSheetOpen(false); router.push(`/player/${p.id}`); }}
                        />
                      ))}
                    </View>
                  );
                })}
                {totalBench === 0 && (
                  <View style={styles.emptyBox}>
                    <Ionicons name="cart-outline" size={20} color={theme.colors.onSurfaceSecondary} />
                    <Text style={styles.emptyText}>La tua panchina è vuota. Compra giocatori dal Mercato.</Text>
                  </View>
                )}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function BenchRow({ player, onPick, onDetail }: { player: P; onPick: () => void; onDetail: () => void }) {
  return (
    <View style={styles.benchRow} testID={`bench-row-${player.id}`}>
      <Pressable onPress={onDetail} hitSlop={4} style={{ flex: 1 }}>
        <Text style={styles.benchRowName} numberOfLines={1}>{player.name}</Text>
        <Text style={styles.benchRowMeta} numberOfLines={1}>
          {player.team} · MV {player.avg_vote?.toFixed(2) ?? '—'} · {player.goals}G {player.assists}A
        </Text>
      </Pressable>
      <Pressable
        testID={`bench-pick-${player.id}`}
        onPress={onPick}
        style={({ pressed }) => [styles.pickBtn, pressed && { opacity: 0.8 }]}
        hitSlop={4}
      >
        <Ionicons name="swap-vertical" size={14} color={theme.colors.onBrandSecondary} />
        <Text style={styles.pickBtnText}>Schiera</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md,
    borderBottomWidth: 1, borderBottomColor: theme.colors.divider,
  },
  title: { color: theme.colors.onSurface, fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  formationSummary: {
    paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: theme.colors.brandSecondary,
    borderRadius: theme.radius.pill,
  },
  formationText: { color: theme.colors.onBrandSecondary, fontSize: 13, fontWeight: '800', letterSpacing: 1 },

  formPicker: {
    borderBottomWidth: 1, borderBottomColor: theme.colors.divider,
  },
  formPickerContent: {
    paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, gap: 6,
  },
  formChip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  formChipActive: {
    backgroundColor: theme.colors.brandSecondary,
    borderColor: theme.colors.brandSecondary,
  },
  formChipText: { color: theme.colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  formChipTextActive: { color: theme.colors.onBrandSecondary, fontWeight: '800' },

  pitchWrap: {
    flex: 1, padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
  },
  pitch: {
    flex: 1, position: 'relative',
    backgroundColor: '#1B5E20',
    borderRadius: theme.radius.lg,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)',
    overflow: 'hidden',
  },
  pitchHalf: {
    position: 'absolute', top: '50%', left: 0, right: 0,
    borderTopWidth: 2, borderTopColor: 'rgba(255,255,255,0.35)',
  },
  pitchCircle: {
    position: 'absolute', top: '50%', left: '50%',
    width: 80, height: 80, marginLeft: -40, marginTop: -40,
    borderRadius: 40, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)',
  },
  pitchTopBox: {
    position: 'absolute', top: 0, left: '25%', right: '25%',
    height: '12%',
    borderWidth: 2, borderTopWidth: 0,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  pitchBottomBox: {
    position: 'absolute', bottom: 0, left: '25%', right: '25%',
    height: '12%',
    borderWidth: 2, borderBottomWidth: 0,
    borderColor: 'rgba(255,255,255,0.35)',
  },

  chipPlayer: {
    position: 'absolute',
    width: 64, alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 4, paddingVertical: 5,
  },
  chipDot: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  chipDotText: { color: theme.colors.onBrandSecondary, fontSize: 10, fontWeight: '800' },
  chipName: { color: theme.colors.onSurface, fontSize: 11, fontWeight: '700', maxWidth: 60, textAlign: 'center' },
  chipSwapIcon: {
    position: 'absolute', bottom: -4, right: -4,
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: theme.colors.brandSecondary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: theme.colors.surface,
  },

  benchBar: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderTopWidth: 1, borderTopColor: theme.colors.border,
    paddingTop: 4, paddingBottom: 10, paddingHorizontal: theme.spacing.md,
  },
  benchGrab: {
    alignSelf: 'center', width: 40, height: 4,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 2, marginBottom: 8,
  },
  benchBarInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  benchTitle: { color: theme.colors.onSurface, fontSize: 14, fontWeight: '800' },
  benchSub: { color: theme.colors.onSurfaceSecondary, fontSize: 11, marginTop: 1 },
  benchRoleDots: { flexDirection: 'row', gap: 4 },
  benchRoleDot: {
    minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  benchRoleCount: { color: '#fff', fontSize: 10, fontWeight: '800' },

  stats: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm,
    borderTopWidth: 1, borderTopColor: theme.colors.divider,
  },
  statCard: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm,
    borderWidth: 1, borderColor: theme.colors.border,
    alignItems: 'center', minWidth: 90,
  },
  statLabel: { color: theme.colors.onSurfaceSecondary, fontSize: 10, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
  statValue: { color: theme.colors.brandSecondary, fontSize: 18, fontWeight: '800', marginTop: 2 },

  // Bottom sheet
  sheetBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 6, paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  sheetGrab: {
    alignSelf: 'center', width: 40, height: 4,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 2, marginBottom: 12,
  },
  sheetHead: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: theme.spacing.md,
  },
  sheetTitle: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '800' },
  sheetSub: { color: theme.colors.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  sheetList: { paddingBottom: 20 },
  sectionLabel: {
    color: theme.colors.onSurfaceSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1,
    textTransform: 'uppercase', marginTop: 8, marginBottom: 6,
  },
  roleGroupHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  roleGroupTitle: { color: theme.colors.onSurface, fontSize: 13, fontWeight: '700' },

  currentStarterRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(212,175,55,0.1)',
    borderRadius: theme.radius.md,
    padding: theme.spacing.sm,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.3)',
    marginBottom: theme.spacing.sm,
  },
  currentStarterName: { color: theme.colors.onSurface, fontSize: 14, fontWeight: '700' },
  currentStarterMeta: { color: theme.colors.brandSecondary, fontSize: 11, marginTop: 2 },
  currentBadge: {
    paddingHorizontal: 8, paddingVertical: 3,
    backgroundColor: theme.colors.brandSecondary, borderRadius: theme.radius.pill,
  },
  currentBadgeText: { color: theme.colors.onBrandSecondary, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },

  roleTag: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  roleTagText: { fontSize: 12, fontWeight: '800' },

  benchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, paddingHorizontal: 10,
    borderRadius: theme.radius.md,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
    marginBottom: 6,
  },
  benchRowName: { color: theme.colors.onSurface, fontSize: 14, fontWeight: '700' },
  benchRowMeta: { color: theme.colors.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  pickBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 7,
    backgroundColor: theme.colors.brandSecondary, borderRadius: theme.radius.pill,
  },
  pickBtnText: { color: theme.colors.onBrandSecondary, fontSize: 12, fontWeight: '800' },

  emptyBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border,
    marginTop: 8,
  },
  emptyText: { color: theme.colors.onSurfaceSecondary, fontSize: 12, flex: 1, lineHeight: 17 },
});
