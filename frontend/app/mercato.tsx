import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/lib/api';
import { useAuth } from '@/src/lib/auth';
import { useLeague } from '@/src/lib/league';
import { theme, roleColors, roleLabels } from '@/src/lib/theme';

type Player = { id: string; name: string; team: string; role: string; price: number };
type RosterEntry = { player_id: string; price_paid: number };

type Tab = 'rosa' | 'free';

export default function Mercato() {
  const router = useRouter();
  const { user } = useAuth();
  const { league, refresh } = useLeague();
  const [tab, setTab] = useState<Tab>('rosa');
  const [wallet, setWallet] = useState<any>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [playersById, setPlayersById] = useState<Record<string, Player>>({});
  const [freeAgents, setFreeAgents] = useState<Player[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const showToast = (msg: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2200);
  };

  const load = useCallback(async () => {
    if (!league || !user) return;
    try {
      const [w, r, fa] = await Promise.all([
        api.wallet(league.id),
        api.roster(league.id, user.id),
        api.freeAgents(league.id, role || undefined),
      ]);
      setWallet(w);
      setRoster(r.entries || []);
      setFreeAgents(fa);
      // Fetch player details for roster
      const ids = (r.entries || []).map((e: any) => e.player_id);
      const details = await Promise.all(ids.map((id: string) => api.player(id)));
      const map: Record<string, Player> = {};
      details.forEach((p) => { map[p.id] = p; });
      setPlayersById(map);
    } catch (e: any) {
      showToast(e.message || 'Errore caricamento', 'err');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [league, user, role]);

  useEffect(() => { load(); }, [load]);

  const release = async (pid: string) => {
    if (!league) return;
    setBusy(true);
    try {
      await api.releasePlayer(league.id, pid);
      showToast('Giocatore svincolato · credito rimborsato');
      await load();
    } catch (e: any) {
      showToast(e.message || 'Errore', 'err');
    } finally { setBusy(false); }
  };

  const buy = async (pid: string) => {
    if (!league) return;
    setBusy(true);
    try {
      await api.buyFreeAgent(league.id, pid);
      showToast('Giocatore acquistato');
      await load();
    } catch (e: any) {
      showToast(e.message || 'Errore', 'err');
    } finally { setBusy(false); }
  };

  const toggleMercato = async () => {
    if (!league) return;
    try {
      if (league.transfer_window_open) await api.mercatoClose(league.id);
      else await api.mercatoOpen(league.id);
      showToast(league.transfer_window_open ? 'Mercato chiuso' : 'Mercato aperto');
      await refresh();
      await load();
    } catch (e: any) {
      showToast(e.message || 'Errore', 'err');
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.center}><ActivityIndicator color={theme.colors.brandSecondary} /></View>
      </SafeAreaView>
    );
  }

  const isAdmin = league?.admin_id === user?.id;
  const isOpen = league?.transfer_window_open;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="mercato-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="mercato-back" hitSlop={8}>
          <Ionicons name="arrow-back" size={20} color={theme.colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Mercato</Text>
          <Text style={styles.subtitle}>
            {isOpen ? '● Aperto — Riparazione attiva' : '○ Chiuso'}
          </Text>
        </View>
        {isAdmin && (
          <Pressable onPress={toggleMercato} testID="toggle-mercato"
            style={[styles.toggleBtn, isOpen && styles.toggleBtnOpen]}>
            <Text style={[styles.toggleTxt, isOpen && styles.toggleTxtOpen]}>
              {isOpen ? 'Chiudi' : 'Apri'}
            </Text>
          </Pressable>
        )}
      </View>

      {/* Wallet strip */}
      <View style={styles.wallet}>
        <View style={styles.walletIcon}>
          <Ionicons name="wallet" size={16} color={theme.colors.brandSecondary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.walletLbl}>FANTAMILIONI</Text>
          <Text style={styles.walletVal}>
            <Text style={styles.walletRem}>{wallet?.remaining}</Text>
            <Text style={styles.walletBudget}> / {wallet?.budget}</Text>
          </Text>
        </View>
        <Text style={styles.walletSpent}>-{wallet?.spent} spesi</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <Pressable
          testID="tab-rosa"
          style={[styles.tabBtn, tab === 'rosa' && styles.tabBtnActive]}
          onPress={() => setTab('rosa')}
        >
          <Text style={[styles.tabTxt, tab === 'rosa' && styles.tabTxtActive]}>Rosa ({roster.length})</Text>
        </Pressable>
        <Pressable
          testID="tab-free"
          style={[styles.tabBtn, tab === 'free' && styles.tabBtnActive]}
          onPress={() => setTab('free')}
        >
          <Text style={[styles.tabTxt, tab === 'free' && styles.tabTxtActive]}>Free Agent</Text>
        </Pressable>
      </View>

      {tab === 'free' && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}>
          {[
            { key: null, label: 'Tutti' }, { key: 'P', label: 'Portieri' },
            { key: 'D', label: 'Difensori' }, { key: 'C', label: 'Centrocampisti' },
            { key: 'A', label: 'Attaccanti' },
          ].map(c => {
            const active = role === c.key;
            return (
              <Pressable key={String(c.key)} onPress={() => setRole(c.key)}
                style={[styles.roleChip, active && styles.roleChipActive]}>
                <Text style={[styles.roleChipText, active && styles.roleChipTextActive]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.colors.brandSecondary} />}
      >
        {tab === 'rosa' ? (
          roster.length === 0 ? (
            <Text style={styles.empty}>Nessun giocatore in rosa</Text>
          ) : roster.map((e, i) => {
            const p = playersById[e.player_id];
            if (!p) return null;
            const tint = roleColors[p.role];
            const refund = Math.max(1, Math.floor(e.price_paid * 0.5));
            return (
              <View key={e.player_id} style={styles.card} testID={`roster-item-${i}`}>
                <View style={[styles.roleTag, { backgroundColor: tint + '22', borderColor: tint + '55' }]}>
                  <Text style={[styles.roleTagText, { color: tint }]}>{p.role}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardName}>{p.name}</Text>
                  <Text style={styles.cardMeta}>{p.team} · Comprato a {e.price_paid}</Text>
                </View>
                {isOpen ? (
                  <Pressable
                    testID={`release-${p.id}`}
                    onPress={() => release(p.id)}
                    disabled={busy}
                    style={({ pressed }) => [styles.actBtn, styles.releaseBtn, pressed && { opacity: 0.85 }]}
                  >
                    <Text style={styles.releaseTxt}>Svincola</Text>
                    <Text style={styles.actSubTxt}>+{refund}</Text>
                  </Pressable>
                ) : (
                  <View style={styles.priceBadge}>
                    <Text style={styles.priceBadgeText}>{p.price}</Text>
                  </View>
                )}
              </View>
            );
          })
        ) : (
          freeAgents.length === 0 ? (
            <Text style={styles.empty}>Nessun free agent disponibile</Text>
          ) : freeAgents.map((p, i) => {
            const tint = roleColors[p.role];
            const canAfford = (wallet?.remaining || 0) >= p.price;
            return (
              <View key={p.id} style={styles.card} testID={`free-agent-${i}`}>
                <View style={[styles.roleTag, { backgroundColor: tint + '22', borderColor: tint + '55' }]}>
                  <Text style={[styles.roleTagText, { color: tint }]}>{p.role}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardName}>{p.name}</Text>
                  <Text style={styles.cardMeta}>{p.team} · {roleLabels[p.role]}</Text>
                </View>
                {isOpen ? (
                  <Pressable
                    testID={`buy-${p.id}`}
                    onPress={() => buy(p.id)}
                    disabled={busy || !canAfford}
                    style={({ pressed }) => [
                      styles.actBtn, styles.buyBtn,
                      !canAfford && styles.buyBtnDisabled,
                      pressed && canAfford && { opacity: 0.85 },
                    ]}
                  >
                    <Text style={[styles.buyTxt, !canAfford && { color: theme.colors.onSurfaceSecondary }]}>Compra</Text>
                    <Text style={[styles.actSubTxt, { color: theme.colors.onBrandSecondary }]}>{p.price}</Text>
                  </Pressable>
                ) : (
                  <View style={styles.priceBadge}>
                    <Text style={styles.priceBadgeText}>{p.price}</Text>
                  </View>
                )}
              </View>
            );
          })
        )}

        {!isOpen && (
          <View style={styles.closedBanner}>
            <Ionicons name="lock-closed" size={16} color={theme.colors.warning} />
            <Text style={styles.closedText}>
              Il mercato è chiuso. {isAdmin ? 'Aprilo per permettere svincoli e acquisti.' : "Attendi che l'admin apra la finestra."}
            </Text>
          </View>
        )}
      </ScrollView>

      {toast && (
        <View style={[styles.toast, toast.kind === 'err' && styles.toastErr]} testID="mercato-toast">
          <Ionicons name={toast.kind === 'ok' ? 'checkmark-circle' : 'alert-circle'}
            size={16} color={toast.kind === 'ok' ? theme.colors.success : theme.colors.error} />
          <Text style={styles.toastText}>{toast.msg}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.surfaceSecondary, borderWidth: 1, borderColor: theme.colors.border },
  title: { color: theme.colors.onSurface, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: theme.colors.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  toggleBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.pill,
    borderWidth: 1, borderColor: theme.colors.brandSecondary },
  toggleBtnOpen: { backgroundColor: theme.colors.brandSecondary },
  toggleTxt: { color: theme.colors.brandSecondary, fontWeight: '800', fontSize: 12 },
  toggleTxtOpen: { color: theme.colors.onBrandSecondary },

  wallet: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: theme.spacing.lg, marginTop: theme.spacing.sm,
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.3)',
  },
  walletIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(212,175,55,0.15)',
    alignItems: 'center', justifyContent: 'center' },
  walletLbl: { color: theme.colors.onSurfaceSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  walletVal: { marginTop: 2 },
  walletRem: { color: theme.colors.brandSecondary, fontSize: 22, fontWeight: '800' },
  walletBudget: { color: theme.colors.onSurfaceSecondary, fontSize: 14, fontWeight: '600' },
  walletSpent: { color: theme.colors.onSurfaceSecondary, fontSize: 11, fontWeight: '600' },

  tabs: { flexDirection: 'row', marginHorizontal: theme.spacing.lg, marginTop: theme.spacing.md,
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: theme.radius.pill, padding: 4 },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: theme.radius.pill },
  tabBtnActive: { backgroundColor: theme.colors.brandSecondary },
  tabTxt: { color: theme.colors.onSurfaceSecondary, fontSize: 13, fontWeight: '600' },
  tabTxtActive: { color: theme.colors.onBrandSecondary, fontWeight: '800' },

  chipRow: { height: 56, paddingHorizontal: theme.spacing.lg, gap: 8, alignItems: 'center' },
  roleChip: { height: 32, paddingHorizontal: 12, borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceSecondary, borderWidth: 1, borderColor: theme.colors.border,
    justifyContent: 'center', flexShrink: 0 },
  roleChipActive: { backgroundColor: theme.colors.brandSecondary, borderColor: theme.colors.brandSecondary },
  roleChipText: { color: theme.colors.onSurface, fontSize: 12, fontWeight: '600' },
  roleChipTextActive: { color: theme.colors.onBrandSecondary, fontWeight: '800' },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12,
    backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.md,
    marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border,
  },
  roleTag: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  roleTagText: { fontWeight: '800', fontSize: 13 },
  cardName: { color: theme.colors.onSurface, fontSize: 14, fontWeight: '700' },
  cardMeta: { color: theme.colors.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  actBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, alignItems: 'center', gap: 2, minWidth: 68 },
  releaseBtn: { borderWidth: 1, borderColor: theme.colors.error },
  releaseTxt: { color: theme.colors.error, fontWeight: '800', fontSize: 12 },
  buyBtn: { backgroundColor: theme.colors.brandSecondary },
  buyBtnDisabled: { backgroundColor: theme.colors.surfaceTertiary },
  buyTxt: { color: theme.colors.onBrandSecondary, fontWeight: '800', fontSize: 12 },
  actSubTxt: { fontSize: 11, fontWeight: '700', color: theme.colors.error, opacity: 0.9 },
  priceBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
    backgroundColor: 'rgba(212,175,55,0.12)', borderWidth: 1, borderColor: 'rgba(212,175,55,0.3)' },
  priceBadgeText: { color: theme.colors.brandSecondary, fontWeight: '800' },

  closedBanner: {
    marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12,
    backgroundColor: 'rgba(245,158,11,0.1)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)',
    borderRadius: theme.radius.md,
  },
  closedText: { color: theme.colors.warning, fontSize: 12, flex: 1 },
  empty: { color: theme.colors.onSurfaceSecondary, textAlign: 'center', paddingVertical: 40 },

  toast: { position: 'absolute', bottom: 24, left: 20, right: 20,
    padding: 12, borderRadius: 12, backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1, borderColor: theme.colors.success + '55',
    flexDirection: 'row', gap: 8, alignItems: 'center' },
  toastErr: { borderColor: theme.colors.error + '55' },
  toastText: { color: theme.colors.onSurface, fontSize: 13, flex: 1 },
});
