import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl,
  ActivityIndicator, Share, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/lib/api';
import { useAuth } from '@/src/lib/auth';
import { useLeague } from '@/src/lib/league';
import { theme } from '@/src/lib/theme';

type Member = { user_id: string; user_name: string; team_name: string; role: string; joined_at: string };

export default function LeagueTab() {
  const { league } = useLeague();
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!league) return;
    try {
      const m = await api.leagueMembers(league.id);
      setMembers(m);
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [league]);

  useEffect(() => { load(); }, [load]);

  const copyCode = async () => {
    if (!league) return;
    await Clipboard.setStringAsync(league.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const shareInvite = async () => {
    if (!league) return;
    try {
      await Share.share({
        message: `Unisciti alla mia lega "${league.name}" su Fantacalcio Manager! Codice invito: ${league.code}`,
      });
    } catch {}
  };

  if (!league || loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.center}><ActivityIndicator color={theme.colors.brandSecondary} /></View>
      </SafeAreaView>
    );
  }

  const isAdmin = league.admin_id === user?.id;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="league-screen">
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.colors.brandSecondary} />}
      >
        <Text style={styles.title}>La tua lega</Text>
        <Text style={styles.subtitle} numberOfLines={1}>{league.name}</Text>

        {/* Invite code card */}
        <View style={styles.codeCard} testID="invite-code-card">
          <View style={styles.codeHead}>
            <View style={styles.codeBadge}>
              <Ionicons name="key" size={12} color={theme.colors.brandSecondary} />
              <Text style={styles.codeBadgeText}>CODICE INVITO</Text>
            </View>
            {isAdmin && (
              <View style={styles.adminBadge}>
                <Ionicons name="star" size={10} color={theme.colors.onBrandSecondary} />
                <Text style={styles.adminBadgeText}>ADMIN</Text>
              </View>
            )}
          </View>

          <Pressable onPress={copyCode} testID="copy-code-button">
            <Text style={styles.codeDigits} selectable>{league.code}</Text>
          </Pressable>

          <Text style={styles.codeHelp}>
            Condividi questo codice con i tuoi amici per invitarli nella lega.
          </Text>

          <View style={styles.codeBtnRow}>
            <Pressable
              testID="copy-code-btn"
              onPress={copyCode}
              style={({ pressed }) => [styles.codeBtn, styles.codeBtnGhost, pressed && { opacity: 0.85 }]}>
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16}
                color={copied ? theme.colors.success : theme.colors.onSurface} />
              <Text style={[styles.codeBtnText, copied && { color: theme.colors.success }]}>
                {copied ? 'Copiato!' : 'Copia'}
              </Text>
            </Pressable>
            {Platform.OS !== 'web' && (
              <Pressable
                testID="share-code-btn"
                onPress={shareInvite}
                style={({ pressed }) => [styles.codeBtn, styles.codeBtnPrimary, pressed && { opacity: 0.85 }]}>
                <Ionicons name="share-outline" size={16} color={theme.colors.onBrandSecondary} />
                <Text style={[styles.codeBtnText, { color: theme.colors.onBrandSecondary }]}>Condividi</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* Members */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Membri</Text>
          <Text style={styles.sectionCount}>{members.length}</Text>
        </View>

        <View style={styles.memberList}>
          {members.map((m, i) => {
            const isYou = m.user_id === user?.id;
            const isMemberAdmin = m.role === 'admin';
            return (
              <View
                key={m.user_id}
                style={[styles.memberRow, i === members.length - 1 && { borderBottomWidth: 0 }]}
                testID={`member-row-${i}`}
              >
                <View style={[styles.avatar, isYou && { backgroundColor: theme.colors.brandSecondary }]}>
                  <Text style={[styles.avatarText, isYou && { color: theme.colors.onBrandSecondary }]}>
                    {m.team_name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[styles.teamName, isYou && { color: theme.colors.brandSecondary }]}
                      numberOfLines={1}>
                      {m.team_name}
                    </Text>
                    {isMemberAdmin && <Ionicons name="star" size={12} color={theme.colors.brandSecondary} />}
                  </View>
                  <Text style={styles.userMeta} numberOfLines={1}>
                    {m.user_name}{isYou ? ' (Tu)' : ''}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { color: theme.colors.onSurface, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: theme.colors.onSurfaceSecondary, fontSize: 13, marginTop: 4, marginBottom: theme.spacing.lg },

  codeCard: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.35)',
  },
  codeHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  codeBadge: {
    flexDirection: 'row', gap: 6, alignItems: 'center',
    backgroundColor: 'rgba(212,175,55,0.12)',
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: theme.radius.pill,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.35)',
  },
  codeBadgeText: { color: theme.colors.brandSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  adminBadge: {
    flexDirection: 'row', gap: 4, alignItems: 'center',
    backgroundColor: theme.colors.brandSecondary,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.pill,
  },
  adminBadgeText: { color: theme.colors.onBrandSecondary, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  codeDigits: {
    color: theme.colors.brandSecondary,
    fontSize: 52, fontWeight: '800',
    letterSpacing: 8,
    textAlign: 'center',
    marginVertical: theme.spacing.lg,
  },
  codeHelp: { color: theme.colors.onSurfaceSecondary, fontSize: 13, textAlign: 'center', lineHeight: 18 },
  codeBtnRow: { flexDirection: 'row', gap: 10, marginTop: theme.spacing.md },
  codeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: theme.radius.md,
  },
  codeBtnGhost: { backgroundColor: theme.colors.surfaceTertiary, borderWidth: 1, borderColor: theme.colors.border },
  codeBtnPrimary: { backgroundColor: theme.colors.brandSecondary },
  codeBtnText: { color: theme.colors.onSurface, fontWeight: '700', fontSize: 14 },

  sectionHead: { flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-end', marginTop: theme.spacing.xl, marginBottom: theme.spacing.md },
  sectionTitle: { color: theme.colors.onSurface, fontSize: 16, fontWeight: '700' },
  sectionCount: { color: theme.colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600' },

  memberList: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md,
    borderBottomWidth: 1, borderBottomColor: theme.colors.divider,
  },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: theme.colors.surfaceTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 16 },
  teamName: { color: theme.colors.onSurface, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  userMeta: { color: theme.colors.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
});
