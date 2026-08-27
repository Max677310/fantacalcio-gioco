import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/lib/api';
import { useLeague } from '@/src/lib/league';
import { theme, roleColors, roleLabels } from '@/src/lib/theme';

type MDRow = {
  matchday: number;
  played: boolean;
  sv: boolean;
  base_vote: number | null;
  fantavoto: number | null;
  goals: number;
  assists: number;
  yellow: number;
  red: number;
};
type Stats = {
  player_id: string;
  player_name: string;
  role: 'P' | 'D' | 'C' | 'A';
  team: string;
  price: number;
  listino_avg_vote: number;
  listino_fantavoto: number | null;
  matches_played: number;
  matches_sv: number;
  total_goals: number;
  total_assists: number;
  total_yellows: number;
  total_reds: number;
  total_own_goals: number;
  total_penalties_saved: number;
  total_penalties_missed: number;
  avg_vote: number | null;
  fantamedia: number | null;
  per_matchday: MDRow[];
};

export default function PlayerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { league } = useLeague();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const s = await api.playerStats(id as string, league?.id);
      setStats(s);
    } catch (e) {
      console.log('player stats err', e);
    } finally { setLoading(false); }
  }, [id, league?.id]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}><ActivityIndicator color={theme.colors.brandSecondary} /></View>
      </SafeAreaView>
    );
  }
  if (!stats) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}><Text style={styles.errText}>Giocatore non trovato</Text></View>
      </SafeAreaView>
    );
  }

  const roleTint = roleColors[stats.role] || theme.colors.brandPrimary;
  const hasLeagueData = stats.matches_played > 0;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="player-detail-screen">
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn} testID="pd-back">
          <Ionicons name="chevron-back" size={22} color={theme.colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{stats.player_name}</Text>
          <Text style={styles.subtitle}>{stats.team} · {roleLabels[stats.role]}</Text>
        </View>
        <View style={[styles.roleBadge, { backgroundColor: roleTint + '22', borderColor: roleTint + '55' }]}>
          <Text style={[styles.roleBadgeText, { color: roleTint }]}>{stats.role}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 40 }}>
        {/* Big price + role card */}
        <View style={styles.heroCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroLabel}>Quotazione</Text>
            <Text style={styles.heroValue}>{stats.price} <Text style={styles.heroUnit}>FM</Text></Text>
            <Text style={styles.heroSub}>Prezzo di listino</Text>
          </View>
          <View style={styles.heroSep} />
          <View style={{ flex: 1 }}>
            <Text style={styles.heroLabel}>Media Voto</Text>
            <Text style={styles.heroValue}>{(stats.avg_vote ?? stats.listino_avg_vote).toFixed(2)}</Text>
            <Text style={styles.heroSub}>{hasLeagueData ? 'Lega attuale' : 'Storico listino'}</Text>
          </View>
        </View>

        {/* Fantamedia */}
        <View style={styles.metricRow}>
          <View style={styles.metricCard}>
            <Ionicons name="calculator" size={18} color={theme.colors.brandSecondary} />
            <Text style={styles.metricValue}>
              {stats.fantamedia != null ? stats.fantamedia.toFixed(2) : '—'}
            </Text>
            <Text style={styles.metricLabel}>Fantamedia</Text>
          </View>
          <View style={styles.metricCard}>
            <Ionicons name="football" size={18} color={theme.colors.success} />
            <Text style={styles.metricValue}>{stats.total_goals}</Text>
            <Text style={styles.metricLabel}>Gol</Text>
          </View>
          <View style={styles.metricCard}>
            <Ionicons name="hand-right" size={18} color={theme.colors.info || theme.colors.brandPrimary} />
            <Text style={styles.metricValue}>{stats.total_assists}</Text>
            <Text style={styles.metricLabel}>Assist</Text>
          </View>
        </View>

        <View style={styles.metricRow}>
          <View style={styles.metricCard}>
            <Ionicons name="square" size={18} color="#F59E0B" />
            <Text style={styles.metricValue}>{stats.total_yellows}</Text>
            <Text style={styles.metricLabel}>Ammoniz.</Text>
          </View>
          <View style={styles.metricCard}>
            <Ionicons name="square" size={18} color={theme.colors.error} />
            <Text style={styles.metricValue}>{stats.total_reds}</Text>
            <Text style={styles.metricLabel}>Espulsioni</Text>
          </View>
          <View style={styles.metricCard}>
            <Ionicons name="help-circle-outline" size={18} color={theme.colors.onSurfaceSecondary} />
            <Text style={styles.metricValue}>{stats.matches_sv}</Text>
            <Text style={styles.metricLabel}>S.V.</Text>
          </View>
        </View>

        {stats.total_own_goals + stats.total_penalties_saved + stats.total_penalties_missed > 0 && (
          <View style={styles.extraCard}>
            {stats.total_own_goals > 0 && (
              <View style={styles.extraRow}>
                <Ionicons name="alert-circle" size={14} color={theme.colors.error} />
                <Text style={styles.extraText}>Autogol: <Text style={styles.extraNum}>{stats.total_own_goals}</Text></Text>
              </View>
            )}
            {stats.total_penalties_saved > 0 && (
              <View style={styles.extraRow}>
                <Ionicons name="shield-checkmark" size={14} color={theme.colors.success} />
                <Text style={styles.extraText}>Rigori parati: <Text style={styles.extraNum}>{stats.total_penalties_saved}</Text></Text>
              </View>
            )}
            {stats.total_penalties_missed > 0 && (
              <View style={styles.extraRow}>
                <Ionicons name="close-circle" size={14} color={theme.colors.error} />
                <Text style={styles.extraText}>Rigori sbagliati: <Text style={styles.extraNum}>{stats.total_penalties_missed}</Text></Text>
              </View>
            )}
          </View>
        )}

        {/* Per matchday history */}
        <Text style={styles.sectionHead}>Storico giornate</Text>
        {!hasLeagueData ? (
          <View style={styles.emptyCard}>
            <Ionicons name="information-circle-outline" size={20} color={theme.colors.onSurfaceSecondary} />
            <Text style={styles.emptyText}>
              Nessuna giornata calcolata ancora in questa lega.
            </Text>
          </View>
        ) : (
          <View style={styles.mdList}>
            {stats.per_matchday.map((row, i) => (
              <View key={i} style={styles.mdRow}>
                <View style={styles.mdCol}>
                  <Text style={styles.mdNum}>{row.matchday}ª</Text>
                  <Text style={styles.mdCaption}>Giornata</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  {!row.played ? (
                    <Text style={styles.mdMissText}>Non convocato</Text>
                  ) : (
                    <View style={styles.mdEvents}>
                      {row.sv && (
                        <View style={styles.evtSv}><Text style={styles.evtSvText}>S.V.</Text></View>
                      )}
                      {row.goals > 0 && (
                        <View style={styles.evtGoal}>
                          <Ionicons name="football" size={10} color={theme.colors.onBrandSecondary} />
                          <Text style={styles.evtText}>{row.goals}</Text>
                        </View>
                      )}
                      {row.assists > 0 && (
                        <View style={styles.evtAssist}>
                          <Ionicons name="hand-right" size={10} color="#fff" />
                          <Text style={[styles.evtText, { color: '#fff' }]}>A{row.assists}</Text>
                        </View>
                      )}
                      {row.yellow > 0 && <View style={[styles.evtCard, { backgroundColor: '#F59E0B' }]} />}
                      {row.red > 0 && <View style={[styles.evtCard, { backgroundColor: theme.colors.error }]} />}
                    </View>
                  )}
                </View>
                <View style={styles.mdScoreCol}>
                  <Text style={styles.mdVote}>
                    {row.base_vote != null ? row.base_vote.toFixed(1) : '—'}
                  </Text>
                  <Text style={styles.mdFv}>
                    {row.fantavoto != null ? `fv ${row.fantavoto.toFixed(1)}` : '—'}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errText: { color: theme.colors.onSurfaceSecondary, fontSize: 14 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md,
    borderBottomWidth: 1, borderBottomColor: theme.colors.divider,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: theme.colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  subtitle: { color: theme.colors.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  roleBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: theme.radius.pill, borderWidth: 1 },
  roleBadgeText: { fontWeight: '800', fontSize: 13 },

  heroCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    borderWidth: 1, borderColor: theme.colors.border,
    marginBottom: theme.spacing.md,
  },
  heroLabel: { color: theme.colors.onSurfaceSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  heroValue: { color: theme.colors.brandSecondary, fontSize: 34, fontWeight: '800', letterSpacing: -1, marginTop: 4 },
  heroUnit: { color: theme.colors.onSurfaceSecondary, fontSize: 14, fontWeight: '600' },
  heroSub: { color: theme.colors.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  heroSep: { width: 1, backgroundColor: theme.colors.border, marginHorizontal: theme.spacing.md, alignSelf: 'stretch' },

  metricRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  metricCard: {
    flex: 1,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    borderWidth: 1, borderColor: theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
    gap: 4,
  },
  metricValue: { color: theme.colors.onSurface, fontSize: 20, fontWeight: '800' },
  metricLabel: { color: theme.colors.onSurfaceSecondary, fontSize: 10, fontWeight: '600', letterSpacing: 0.5 },

  extraCard: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md, padding: theme.spacing.md,
    borderWidth: 1, borderColor: theme.colors.border,
    marginTop: theme.spacing.sm,
    gap: 6,
  },
  extraRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  extraText: { color: theme.colors.onSurfaceSecondary, fontSize: 13 },
  extraNum: { color: theme.colors.onSurface, fontWeight: '700' },

  sectionHead: {
    color: theme.colors.onSurface, fontSize: 15, fontWeight: '800',
    marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm,
  },
  emptyCard: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md, padding: theme.spacing.md,
    borderWidth: 1, borderColor: theme.colors.border,
    flexDirection: 'row', gap: 10, alignItems: 'center',
  },
  emptyText: { color: theme.colors.onSurfaceSecondary, fontSize: 12, flex: 1, lineHeight: 17 },

  mdList: { gap: 6 },
  mdRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md, padding: theme.spacing.sm,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  mdCol: { width: 50, alignItems: 'center' },
  mdNum: { color: theme.colors.brandSecondary, fontSize: 16, fontWeight: '800' },
  mdCaption: { color: theme.colors.onSurfaceSecondary, fontSize: 9, marginTop: -2 },
  mdMissText: { color: theme.colors.onSurfaceSecondary, fontSize: 12, fontStyle: 'italic' },
  mdEvents: { flexDirection: 'row', gap: 4, flexWrap: 'wrap', alignItems: 'center' },
  evtGoal: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: theme.colors.brandSecondary,
    borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2,
  },
  evtAssist: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: theme.colors.brandPrimary,
    borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2,
  },
  evtText: { fontSize: 10, fontWeight: '800', color: theme.colors.onBrandSecondary },
  evtSv: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  evtSvText: { fontSize: 10, fontWeight: '700', color: theme.colors.onSurfaceSecondary },
  evtCard: { width: 8, height: 12, borderRadius: 2 },
  mdScoreCol: { alignItems: 'flex-end', minWidth: 60 },
  mdVote: { color: theme.colors.onSurface, fontSize: 16, fontWeight: '800' },
  mdFv: { color: theme.colors.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
});
