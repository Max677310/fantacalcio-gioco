import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/lib/auth';
import { useLeague } from '@/src/lib/league';
import { api } from '@/src/lib/api';
import { theme } from '@/src/lib/theme';

type Activity = { id: string; kind: string; title: string; subtitle: string; created_at: string };
type Summary = {
  league: { id: string; name: string; code: string; member_ids: string[] };
  my_team_name: string;
  rank: number; points: number; next_matchday: number; next_kickoff: string; members: number;
};
type Fixture = {
  matchday: number; home_user_id: string | null; away_user_id: string | null;
  home_team: string | null; away_team: string | null; is_bye: boolean; bye_team: string | null;
};

const kindIcon = (k: string): { name: any; color: string } => {
  switch (k) {
    case 'goal':   return { name: 'football',        color: theme.colors.success };
    case 'assist': return { name: 'sparkles',        color: theme.colors.brandSecondary };
    case 'bid':    return { name: 'flame',           color: theme.colors.error };
    case 'lineup': return { name: 'time',            color: theme.colors.warning };
    default:       return { name: 'information-circle', color: theme.colors.info };
  }
};

const relTime = (iso: string) => {
  const diff = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'ora';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}g`;
};

const countdown = (iso: string) => {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'LIVE';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}g ${h % 24}h`;
  return `${h}h ${m}m`;
};

export default function Dashboard() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { league } = useLeague();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [myFixture, setMyFixture] = useState<Fixture | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!league || !user) return;
    try {
      const [s, a, fx] = await Promise.all([
        api.dashboard(league.id),
        api.activity(league.id),
        api.fixtures(league.id, 1).catch(() => []),
      ]);
      setSummary(s);
      setActivity(a);
      const mine = fx.find((f: Fixture) =>
        (f.is_bye && f.bye_team === s.my_team_name) ||
        f.home_user_id === user.id || f.away_user_id === user.id
      );
      setMyFixture(mine || null);
    } catch (e) {
      console.log('dashboard load err', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [league, user]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  if (loading || !summary) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.center}><ActivityIndicator color={theme.colors.brandSecondary} /></View>
      </SafeAreaView>
    );
  }

  const isListino = league?.mode === 'listino';
  const rankColor =
    summary.rank === 1 ? theme.colors.brandSecondary :
    summary.rank <= 3 ? theme.colors.brandPrimary : theme.colors.onSurface;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="dashboard-screen">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.brandSecondary} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hi}>Ciao, {user?.name?.split(' ')[0]}</Text>
            <Text style={styles.leagueName} numberOfLines={1}>{summary.my_team_name}</Text>
            <View style={styles.leagueSubRow}>
              <Text style={styles.leagueSub} numberOfLines={1}>{summary.league.name}</Text>
              <View style={[styles.modeBadge, isListino ? styles.modeBadgeListino : styles.modeBadgeAsta]}>
                <Ionicons
                  name={isListino ? 'pricetags' : 'flame'}
                  size={10}
                  color={isListino ? theme.colors.brandPrimary : theme.colors.error}
                />
                <Text style={[styles.modeBadgeText, { color: isListino ? theme.colors.brandPrimary : theme.colors.error }]}>
                  {isListino ? 'LISTINO' : 'ASTA'}
                </Text>
              </View>
            </View>
          </View>
          <Pressable onPress={logout} style={styles.iconBtn} testID="logout-button" hitSlop={8}>
            <Ionicons name="log-out-outline" size={22} color={theme.colors.onSurface} />
          </Pressable>
        </View>

        {/* Hero card */}
        <View style={styles.heroCard}>
          <Image source={{ uri: theme.images.stadium }} style={StyleSheet.absoluteFill} contentFit="cover" />
          <LinearGradient
            colors={['rgba(10,92,54,0.35)', 'rgba(13,15,18,0.95)']}
            locations={[0, 0.9]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.heroContent}>
            <View style={styles.heroPill}>
              <Ionicons name="trophy" size={12} color={theme.colors.brandSecondary} />
              <Text style={styles.heroPillText}>LA TUA POSIZIONE</Text>
            </View>
            <View style={styles.heroRow}>
              <Text style={[styles.rankBig, { color: rankColor }]}>
                #{summary.rank}
                <Text style={styles.rankSuffix}> / {summary.members}</Text>
              </Text>
              <View style={styles.pointsBox}>
                <Text style={styles.pointsValue}>{summary.points}</Text>
                <Text style={styles.pointsLabel}>Punti</Text>
              </View>
            </View>
            <View style={styles.heroBottom}>
              <View style={styles.chipDark}>
                <Ionicons name="calendar-outline" size={14} color={theme.colors.brandSecondary} />
                <Text style={styles.chipText}>{summary.next_matchday}ª Giornata</Text>
              </View>
              <View style={styles.chipDark}>
                <Ionicons name="timer-outline" size={14} color={theme.colors.warning} />
                <Text style={styles.chipText}>Kickoff in {countdown(summary.next_kickoff)}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Quick actions */}
        <View style={styles.quickRow}>
          {isListino ? (
            <QuickAction icon="pricetags" label="Listino" tint={theme.colors.brandSecondary}
              onPress={() => router.push('/mercato')} testID="qa-listino" />
          ) : (
            <QuickAction icon="flame" label="Asta Live" tint={theme.colors.error} badge="LIVE"
              onPress={() => router.push('/(tabs)/auction')} testID="qa-auction" />
          )}
          <QuickAction icon="radio" label="Live Match" tint={theme.colors.success} badge="LIVE"
            onPress={() => router.push('/live')} testID="qa-live" />
          <QuickAction icon="swap-horizontal" label="Mercato" tint={theme.colors.brandSecondary}
            onPress={() => router.push('/mercato')} testID="qa-mercato" />
        </View>

        {/* Invite Code Strip */}
        <Pressable style={styles.inviteStrip} onPress={() => router.push('/(tabs)/league')} testID="dashboard-invite-strip">
          <View style={styles.inviteIcon}>
            <Ionicons name="key" size={16} color={theme.colors.brandSecondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.inviteTitle}>Codice invito</Text>
            <Text style={styles.inviteSub}>Condividilo con gli amici per farli entrare in lega</Text>
          </View>
          <Text style={styles.inviteCode}>{summary.league.code}</Text>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.onSurfaceSecondary} />
        </Pressable>

        {/* Fixture card */}
        {myFixture && (
          <View style={styles.fixtureCard} testID="dashboard-fixture">
            <View style={styles.fixtureHead}>
              <Text style={styles.fixtureLbl}>PROSSIMO SCONTRO · {myFixture.matchday}ª GIORNATA</Text>
            </View>
            {myFixture.is_bye ? (
              <View style={styles.byeBox}>
                <Ionicons name="pause-circle" size={22} color={theme.colors.warning} />
                <Text style={styles.byeText}>Turno di riposo</Text>
                <Text style={styles.byeSub}>La tua squadra non gioca questa giornata</Text>
              </View>
            ) : (
              <View style={styles.matchRow}>
                <View style={styles.matchSide}>
                  <Text style={styles.matchTeam} numberOfLines={1}>{myFixture.home_team}</Text>
                  <Text style={styles.matchTag}>CASA</Text>
                </View>
                <Text style={styles.matchVs}>vs</Text>
                <View style={styles.matchSide}>
                  <Text style={styles.matchTeam} numberOfLines={1}>{myFixture.away_team}</Text>
                  <Text style={styles.matchTag}>OSPITE</Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* Section: Activity */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Attività Live</Text>
          <View style={styles.livePill}>
            <View style={styles.liveDotSmall} />
            <Text style={styles.livePillText}>IN DIRETTA</Text>
          </View>
        </View>

        <View style={styles.feedList}>
          {activity.map((a, i) => {
            const ic = kindIcon(a.kind);
            return (
              <View key={a.id} style={[styles.feedItem, i === activity.length - 1 && { borderBottomWidth: 0 }]}
                testID={`activity-item-${i}`}>
                <View style={[styles.feedIcon, { backgroundColor: ic.color + '22' }]}>
                  <Ionicons name={ic.name} size={16} color={ic.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.feedTitle} numberOfLines={1}>{a.title}</Text>
                  <Text style={styles.feedSub} numberOfLines={1}>{a.subtitle}</Text>
                </View>
                <Text style={styles.feedTime}>{relTime(a.created_at)}</Text>
              </View>
            );
          })}
          {activity.length === 0 && (
            <Text style={styles.emptyText}>Nessuna attività recente</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function QuickAction({ icon, label, tint, onPress, badge, testID }: {
  icon: any; label: string; tint: string; onPress: () => void; badge?: string; testID?: string;
}) {
  return (
    <Pressable style={({ pressed }) => [styles.quickCard, pressed && { opacity: 0.85 }]} onPress={onPress} testID={testID}>
      {badge && (
        <View style={styles.quickBadge}>
          <Text style={styles.quickBadgeText}>{badge}</Text>
        </View>
      )}
      <View style={[styles.quickIcon, { backgroundColor: tint + '22' }]}>
        <Ionicons name={icon} size={20} color={tint} />
      </View>
      <Text style={styles.quickLabel} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.md,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  hi: { color: theme.colors.onSurfaceSecondary, fontSize: 13, marginBottom: 2 },
  leagueName: { color: theme.colors.onSurface, fontSize: 22, fontWeight: '800', letterSpacing: -0.3, maxWidth: 280 },
  leagueSub: { color: theme.colors.onSurfaceSecondary, fontSize: 12, marginTop: 2, maxWidth: 200 },
  leagueSubRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  modeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4, borderWidth: 1,
  },
  modeBadgeAsta: { backgroundColor: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.4)' },
  modeBadgeListino: { backgroundColor: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.4)' },
  modeBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.surfaceSecondary, borderWidth: 1, borderColor: theme.colors.border,
  },

  heroCard: {
    marginHorizontal: theme.spacing.lg,
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
    height: 200,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)',
  },
  heroContent: { flex: 1, padding: theme.spacing.lg, justifyContent: 'space-between' },
  heroPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.35)',
  },
  heroPillText: { color: theme.colors.brandSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  rankBig: { fontSize: 56, fontWeight: '800', letterSpacing: -2, lineHeight: 58 },
  rankSuffix: { color: theme.colors.onSurfaceSecondary, fontSize: 18, fontWeight: '600' },
  pointsBox: { alignItems: 'flex-end' },
  pointsValue: { color: theme.colors.onSurface, fontSize: 28, fontWeight: '800' },
  pointsLabel: { color: theme.colors.onSurfaceSecondary, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  heroBottom: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chipDark: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: theme.radius.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  chipText: { color: theme.colors.onSurface, fontSize: 12, fontWeight: '600' },

  quickRow: {
    flexDirection: 'row', gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg, marginTop: theme.spacing.lg,
  },
  quickCard: {
    flex: 1, borderRadius: theme.radius.md, padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1, borderColor: theme.colors.border,
    gap: 10, position: 'relative',
  },
  quickBadge: {
    position: 'absolute', top: 8, right: 8,
    backgroundColor: theme.colors.error, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  quickBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  quickIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { color: theme.colors.onSurface, fontSize: 13, fontWeight: '600' },

  inviteStrip: {
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.md,
    padding: theme.spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.35)',
  },
  inviteIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: 'rgba(212,175,55,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  inviteTitle: { color: theme.colors.onSurface, fontSize: 13, fontWeight: '700' },
  inviteSub: { color: theme.colors.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  inviteCode: {
    color: theme.colors.brandSecondary,
    fontSize: 18, fontWeight: '800', letterSpacing: 2,
  },

  fixtureCard: {
    marginHorizontal: theme.spacing.lg, marginTop: theme.spacing.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  fixtureHead: { marginBottom: theme.spacing.md },
  fixtureLbl: { color: theme.colors.brandSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  matchSide: { flex: 1, alignItems: 'center', gap: 4 },
  matchTeam: { color: theme.colors.onSurface, fontSize: 15, fontWeight: '800' },
  matchTag: { color: theme.colors.onSurfaceSecondary, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  matchVs: { color: theme.colors.brandSecondary, fontSize: 14, fontWeight: '800' },
  byeBox: { alignItems: 'center', gap: 6, paddingVertical: 8 },
  byeText: { color: theme.colors.warning, fontSize: 15, fontWeight: '800' },
  byeSub: { color: theme.colors.onSurfaceSecondary, fontSize: 11 },

  sectionHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: theme.spacing.lg, marginTop: theme.spacing.xl, marginBottom: theme.spacing.md,
  },
  sectionTitle: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '700' },
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(239,68,68,0.15)', borderRadius: theme.radius.pill,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.35)',
  },
  liveDotSmall: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.error },
  livePillText: { color: theme.colors.error, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },

  feedList: {
    marginHorizontal: theme.spacing.lg,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  feedItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md,
    borderBottomWidth: 1, borderBottomColor: theme.colors.divider,
  },
  feedIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  feedTitle: { color: theme.colors.onSurface, fontSize: 14, fontWeight: '600' },
  feedSub: { color: theme.colors.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  feedTime: { color: theme.colors.onSurfaceSecondary, fontSize: 11 },
  emptyText: { color: theme.colors.onSurfaceSecondary, padding: theme.spacing.lg, textAlign: 'center' },
});
