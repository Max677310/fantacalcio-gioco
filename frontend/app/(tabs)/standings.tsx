import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/src/lib/api';
import { theme } from '@/src/lib/theme';
import { useLeague } from '@/src/lib/league';
import { useAuth } from '@/src/lib/auth';

type Row = { user_id: string; user_name: string; team_name: string; played: number; wins: number; draws: number; losses: number; points: number; goals_for: number; goals_against: number };

export default function Standings() {
  const router = useRouter();
  const { league } = useLeague();
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!league) return;
    try {
      const data = await api.standings(league.id);
      setRows(data);
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [league]);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="standings-screen">
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Classifica</Text>
          <Text style={styles.subtitle}>{league?.name || 'Lega'}</Text>
        </View>
        <Pressable onPress={() => router.push('/settings')} style={styles.settingsBtn} testID="open-settings" hitSlop={8}>
          <Ionicons name="settings-outline" size={20} color={theme.colors.onSurface} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.colors.brandSecondary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.colors.brandSecondary} />}
        >
          {/* Header row */}
          <View style={styles.tableHead}>
            <Text style={[styles.th, { width: 26 }]}>#</Text>
            <Text style={[styles.th, { flex: 1 }]}>Manager</Text>
            <Text style={[styles.th, styles.thNum]}>G</Text>
            <Text style={[styles.th, styles.thNum]}>V</Text>
            <Text style={[styles.th, styles.thNum]}>P</Text>
            <Text style={[styles.th, styles.thNum]}>Pt</Text>
          </View>
          {rows.map((r, i) => {
            const rank = i + 1;
            const isYou = r.user_id === user?.id;
            const isFirst = rank === 1;
            return (
              <View key={r.user_id} style={[styles.row, isYou && styles.rowYou]} testID={`standings-row-${rank}`}>
                <View style={[styles.rankBox, isFirst && { backgroundColor: theme.colors.brandSecondary + '33', borderColor: theme.colors.brandSecondary }]}>
                  {isFirst ? <Ionicons name="trophy" size={14} color={theme.colors.brandSecondary} />
                           : <Text style={[styles.rankText, rank <= 3 && { color: theme.colors.brandPrimary }]}>{rank}</Text>}
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={[styles.userName, isYou && { color: theme.colors.brandSecondary }]} numberOfLines={1}>
                    {r.team_name}{isYou ? ' (Tu)' : ''}
                  </Text>
                  <Text style={styles.userMeta} numberOfLines={1}>
                    {r.user_name} · {r.goals_for}:{r.goals_against} gol · {r.draws} pareggi
                  </Text>
                </View>
                <Text style={styles.tdNum}>{r.played}</Text>
                <Text style={styles.tdNum}>{r.wins}</Text>
                <Text style={styles.tdNum}>{r.losses}</Text>
                <Text style={[styles.tdNum, styles.tdPoints, isFirst && { color: theme.colors.brandSecondary }]}>{r.points}</Text>
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.md },
  title: { color: theme.colors.onSurface, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: theme.colors.onSurfaceSecondary, fontSize: 13, marginTop: 2 },
  settingsBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.surfaceSecondary, borderWidth: 1, borderColor: theme.colors.border },

  tableHead: { flexDirection: 'row', paddingHorizontal: 12, paddingBottom: 8, alignItems: 'center' },
  th: { color: theme.colors.onSurfaceSecondary, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, fontWeight: '700' },
  thNum: { width: 32, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: theme.colors.border },
  rowYou: { borderColor: theme.colors.brandSecondary, backgroundColor: 'rgba(212,175,55,0.06)' },
  rankBox: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.surfaceTertiary, borderWidth: 1, borderColor: theme.colors.border },
  rankText: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 13 },
  userName: { color: theme.colors.onSurface, fontSize: 14, fontWeight: '700' },
  userMeta: { color: theme.colors.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  tdNum: { width: 32, textAlign: 'center', color: theme.colors.onSurfaceSecondary, fontSize: 13, fontWeight: '600' },
  tdPoints: { color: theme.colors.onSurface, fontWeight: '800' },
});
