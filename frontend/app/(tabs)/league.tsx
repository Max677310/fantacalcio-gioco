import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl,
  ActivityIndicator, Share, Platform, Modal, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/lib/api';
import { useAuth } from '@/src/lib/auth';
import { useLeague } from '@/src/lib/league';
import { theme } from '@/src/lib/theme';

type Member = { user_id: string; user_name: string; team_name: string; role: string; joined_at: string };

export default function LeagueTab() {
  const router = useRouter();
  const { league, refresh } = useLeague();
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showMdModal, setShowMdModal] = useState(false);
  const [pendingMd, setPendingMd] = useState<number>(1);
  const [savingMd, setSavingMd] = useState(false);

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
  const startMatchday: number = (league as any).start_matchday || 1;
  const kickoffLocked: boolean = !!(league as any).kickoff_locked;
  const canEditMd = isAdmin && !kickoffLocked;

  const openMdModal = () => {
    setPendingMd(startMatchday);
    setShowMdModal(true);
  };

  const saveMd = async () => {
    if (!league) return;
    if (pendingMd === startMatchday) { setShowMdModal(false); return; }
    setSavingMd(true);
    try {
      await api.updateLeagueSettings(league.id, { start_matchday: pendingMd });
      await refresh();
      setShowMdModal(false);
    } catch (e: any) {
      Alert.alert('Errore', e?.message || 'Impossibile aggiornare la giornata di partenza');
    } finally {
      setSavingMd(false);
    }
  };

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

        {/* Kickoff / Settings card */}
        <View style={styles.settingsCard} testID="settings-card">
          <View style={styles.settingsRow}>
            <View style={styles.settingsIcon}>
              <Ionicons name="calendar" size={18} color={theme.colors.brandSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingsLabel}>Giornata di partenza</Text>
              <Text style={styles.settingsSub}>
                {kickoffLocked
                  ? 'Bloccata dopo il kickoff'
                  : (canEditMd ? 'La lega inizia dalla giornata selezionata' : 'Solo l\'admin può modificarla')}
              </Text>
            </View>
            <View style={styles.mdBadge}>
              <Text style={styles.mdBadgeText}>{startMatchday}ª</Text>
            </View>
            {canEditMd && (
              <Pressable testID="edit-start-md" onPress={openMdModal} hitSlop={10} style={styles.editBtn}>
                <Ionicons name="create-outline" size={18} color={theme.colors.brandSecondary} />
              </Pressable>
            )}
          </View>
        </View>

        {isAdmin && (
          <Pressable
            testID="open-matchday-mgmt"
            onPress={() => router.push('/matchday')}
            style={({ pressed }) => [styles.settingsCard, styles.mgmtCard, pressed && { opacity: 0.85 }]}
          >
            <View style={styles.settingsRow}>
              <View style={[styles.settingsIcon, { backgroundColor: 'rgba(46,204,113,0.12)', borderColor: 'rgba(46,204,113,0.35)' }]}>
                <Ionicons name="calculator" size={18} color={theme.colors.success} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingsLabel}>Gestione giornata</Text>
                <Text style={styles.settingsSub}>Carica voti, calcola risultati, aggiorna classifica</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.colors.onSurfaceSecondary} />
            </View>
          </Pressable>
        )}

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

      {/* Start Matchday Modal */}
      <Modal
        visible={showMdModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMdModal(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => !savingMd && setShowMdModal(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHead}>
              <Ionicons name="calendar" size={20} color={theme.colors.brandSecondary} />
              <Text style={styles.modalTitle}>Giornata di partenza</Text>
            </View>
            <Text style={styles.modalSub}>
              Scegli da quale giornata di Serie A la tua lega inizia a tracciare i punteggi (1-38).
            </Text>

            <View style={styles.mdBigRow}>
              <Pressable
                testID="modal-md-dec"
                onPress={() => setPendingMd((v) => Math.max(1, v - 1))}
                style={({ pressed }) => [styles.mdBigBtn, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name="remove" size={26} color={theme.colors.onSurface} />
              </Pressable>
              <View style={styles.mdBigValueWrap}>
                <Text style={styles.mdBigValue}>{pendingMd}</Text>
                <Text style={styles.mdBigLabel}>giornata</Text>
              </View>
              <Pressable
                testID="modal-md-inc"
                onPress={() => setPendingMd((v) => Math.min(38, v + 1))}
                style={({ pressed }) => [styles.mdBigBtn, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name="add" size={26} color={theme.colors.onSurface} />
              </Pressable>
            </View>

            <View style={styles.mdQuickRow}>
              {[1, 5, 10, 15, 20, 25, 30, 35, 38].map((n) => (
                <Pressable
                  key={n}
                  testID={`modal-md-quick-${n}`}
                  onPress={() => setPendingMd(n)}
                  style={[styles.mdChip, pendingMd === n && styles.mdChipActive]}
                >
                  <Text style={[styles.mdChipText, pendingMd === n && styles.mdChipTextActive]}>{n}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.mdWarning}>
              ⚠️ Cambiando la giornata verrà rigenerato il calendario partite.
            </Text>

            <View style={styles.modalBtnRow}>
              <Pressable
                testID="modal-md-cancel"
                onPress={() => setShowMdModal(false)}
                style={[styles.modalBtn, styles.modalBtnGhost]}
                disabled={savingMd}
              >
                <Text style={styles.modalBtnGhostText}>Annulla</Text>
              </Pressable>
              <Pressable
                testID="modal-md-save"
                onPress={saveMd}
                style={[styles.modalBtn, styles.modalBtnPrimary, savingMd && { opacity: 0.7 }]}
                disabled={savingMd}
              >
                {savingMd
                  ? <ActivityIndicator color={theme.colors.onBrandSecondary} />
                  : <Text style={styles.modalBtnPrimaryText}>Salva</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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

  settingsCard: {
    marginTop: theme.spacing.lg,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  mgmtCard: {
    marginTop: theme.spacing.sm,
    borderColor: 'rgba(46,204,113,0.35)',
  },
  settingsRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  settingsIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(212,175,55,0.12)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.35)',
  },
  settingsLabel: { color: theme.colors.onSurface, fontSize: 14, fontWeight: '700' },
  settingsSub: { color: theme.colors.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  mdBadge: {
    backgroundColor: theme.colors.brandSecondary,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: theme.radius.pill,
  },
  mdBadgeText: { color: theme.colors.onBrandSecondary, fontSize: 13, fontWeight: '800' },
  editBtn: { padding: 6 },

  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', padding: theme.spacing.lg,
  },
  modalCard: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  modalHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modalTitle: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '800' },
  modalSub: { color: theme.colors.onSurfaceSecondary, fontSize: 12, lineHeight: 17, marginTop: 6, marginBottom: theme.spacing.md },
  mdBigRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: theme.colors.surfaceTertiary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginVertical: theme.spacing.sm,
  },
  mdBigBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: theme.colors.surface,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: theme.colors.border,
  },
  mdBigValueWrap: { alignItems: 'center' },
  mdBigValue: { color: theme.colors.brandSecondary, fontSize: 40, fontWeight: '800', letterSpacing: -1 },
  mdBigLabel: { color: theme.colors.onSurfaceSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },
  mdQuickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: theme.spacing.sm, marginBottom: theme.spacing.md },
  mdChip: {
    minWidth: 36, height: 30, paddingHorizontal: 8,
    borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  mdChipActive: {
    backgroundColor: theme.colors.brandSecondary,
    borderColor: theme.colors.brandSecondary,
  },
  mdChipText: { color: theme.colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  mdChipTextActive: { color: theme.colors.onBrandSecondary, fontWeight: '800' },
  mdWarning: { color: theme.colors.onSurfaceSecondary, fontSize: 11, textAlign: 'center', marginBottom: theme.spacing.md, lineHeight: 15 },
  modalBtnRow: { flexDirection: 'row', gap: 10 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center' },
  modalBtnGhost: { backgroundColor: theme.colors.surfaceTertiary, borderWidth: 1, borderColor: theme.colors.border },
  modalBtnGhostText: { color: theme.colors.onSurface, fontWeight: '700', fontSize: 14 },
  modalBtnPrimary: { backgroundColor: theme.colors.brandSecondary },
  modalBtnPrimaryText: { color: theme.colors.onBrandSecondary, fontWeight: '800', fontSize: 14 },
});
