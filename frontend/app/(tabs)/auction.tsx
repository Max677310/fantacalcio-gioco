import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform, Modal, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useLeague } from '@/src/lib/league';
import { useAuth } from '@/src/lib/auth';
import { api } from '@/src/lib/api';
import { theme, roleLabels, roleColors } from '@/src/lib/theme';

type Player = { id: string; name: string; team: string; role: string; price: number; avg_vote: number };
type Bid = { id: string; user_id: string; user_name: string; amount: number; created_at: string; player_id: string };
type State = {
  active_player_id: string;
  current_bid: number;
  current_bidder_id: string | null;
  current_bidder_name: string | null;
  status: string;
  bid_expires_at?: string | null;
  passed_user_ids?: string[];
  bid_countdown_seconds?: number;
  seconds_remaining?: number | null;
};

const relTime = (iso: string) => {
  const diff = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${Math.floor(diff)}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
};

export default function Auction() {
  const { league } = useLeague();
  const { user } = useAuth();
  const [state, setState] = useState<State | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [customVisible, setCustomVisible] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const [pickerVisible, setPickerVisible] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [wallet, setWallet] = useState<any>(null);
  const pollRef = useRef<any>(null);
  const tickerRef = useRef<any>(null);
  const [tickNow, setTickNow] = useState<number>(Date.now());

  const load = useCallback(async () => {
    if (!league) return;
    try {
      const s = await api.auctionState(league.id);
      setState(s);
      const [p, b, w] = await Promise.all([
        s.active_player_id ? api.player(s.active_player_id) : Promise.resolve(null),
        api.auctionBids(league.id),
        api.wallet(league.id).catch(() => null),
      ]);
      setPlayer(p);
      setBids(b);
      setWallet(w);
    } catch (e) { console.log('auction load err', e); }
    finally { setLoading(false); }
  }, [league]);

  useEffect(() => {
    load();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league?.id]);

  // Adaptive polling: 1.5s when timer running, 4s otherwise
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    const timerActive = state?.status === 'running' && !!state?.bid_expires_at;
    const period = timerActive ? 1500 : 4000;
    pollRef.current = setInterval(load, period);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [state?.status, state?.bid_expires_at, load]);

  // Client-side ticker (200ms) for smooth countdown UI
  useEffect(() => {
    if (tickerRef.current) clearInterval(tickerRef.current);
    if (state?.bid_expires_at) {
      tickerRef.current = setInterval(() => setTickNow(Date.now()), 200);
    }
    return () => { if (tickerRef.current) clearInterval(tickerRef.current); };
  }, [state?.bid_expires_at]);

  const doBid = async (amount: number) => {
    if (!league || !state) return;
    setBusy(true); setErrorMsg(null);
    try {
      await api.placeBid(league.id, amount);
      await load();
    } catch (e: any) { setErrorMsg(e.message); }
    finally { setBusy(false); }
  };

  const doPass = async () => {
    if (!league || !state) return;
    setBusy(true); setErrorMsg(null);
    try {
      await api.passBid(league.id);
      await load();
    } catch (e: any) { setErrorMsg(e.message); }
    finally { setBusy(false); }
  };

  const openPicker = async (role: string | null) => {
    setRoleFilter(role);
    setPickerVisible(true);
    const list = await api.players(role || undefined);
    setPlayers(list);
  };

  const chooseNext = async (p: Player) => {
    if (!league) return;
    setPickerVisible(false);
    setBusy(true);
    try { await api.nextPlayer(league.id, p.id); await load(); }
    finally { setBusy(false); }
  };

  if (loading || !state || !player) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.center}><ActivityIndicator color={theme.colors.brandSecondary} /></View>
      </SafeAreaView>
    );
  }

  const roleTint = roleColors[player.role] || theme.colors.brandPrimary;
  const isCurrentBidder = state.current_bidder_id === user?.id;
  const isSold = state.status === 'sold';
  const isAdmin = league?.admin_id === user?.id;
  const totalSecs = state.bid_countdown_seconds || 15;

  // Client-side countdown (uses server-provided expiry timestamp)
  let secondsLeft: number | null = null;
  if (state.bid_expires_at) {
    const target = new Date(state.bid_expires_at).getTime();
    secondsLeft = Math.max(0, (target - tickNow) / 1000);
  }
  const timerActive = !!state.bid_expires_at && state.status === 'running' && (secondsLeft ?? 0) > 0;
  const timerExpired = !!state.bid_expires_at && (secondsLeft ?? 0) <= 0;
  const hasPassed = !!(user?.id && state.passed_user_ids?.includes(user.id));
  const canBid = !isSold && !timerExpired && !hasPassed;
  const canPass = !isSold && timerActive && !isCurrentBidder && !hasPassed;
  const timerColor =
    (secondsLeft ?? 99) <= 5 ? theme.colors.error :
    (secondsLeft ?? 99) <= 10 ? theme.colors.brandSecondary : theme.colors.success;

  return (
    <View style={styles.root} testID="auction-screen">
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        {/* Top - Active player */}
        <View style={styles.topSection}>
          <Image source={{ uri: theme.images.stadium }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={2} />
          <LinearGradient
            colors={['rgba(13,15,18,0.65)', 'rgba(13,15,18,0.92)']}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.topContent}>
            <View style={styles.topHead}>
              <View style={[styles.livePill, isSold && { backgroundColor: 'rgba(255,64,64,0.2)', borderColor: theme.colors.error }]}>
                <View style={[styles.liveDot, isSold && { backgroundColor: theme.colors.error }]} />
                <Text style={[styles.livePillText, isSold && { color: theme.colors.error }]}>
                  {isSold ? 'VENDUTO' : 'ASTA LIVE'}
                </Text>
              </View>
              {isAdmin && (
                <Pressable onPress={() => openPicker(null)} style={styles.nextBtn} testID="next-player-button" hitSlop={6}>
                  <Ionicons name="shuffle" size={14} color={theme.colors.onSurface} />
                  <Text style={styles.nextBtnText}>{isSold ? 'Prossimo' : 'Cambia'}</Text>
                </Pressable>
              )}
            </View>

            {/* Countdown or Sold banner */}
            {isSold ? (
              <View style={styles.soldBanner} testID="sold-banner">
                <Ionicons name="trophy" size={20} color={theme.colors.brandSecondary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.soldTitle} numberOfLines={1}>
                    Aggiudicato a {state.current_bidder_name || '—'}
                  </Text>
                  <Text style={styles.soldSub}>per {state.current_bid} fantamilioni</Text>
                </View>
              </View>
            ) : state.bid_expires_at ? (
              <View style={styles.timerRow} testID="auction-timer">
                <View style={styles.timerCircle}>
                  <Text style={[styles.timerNumber, { color: timerColor }]} testID="timer-seconds">
                    {Math.ceil(secondsLeft ?? 0)}
                  </Text>
                  <Text style={styles.timerLabel}>SEC</Text>
                </View>
                <View style={styles.timerBarWrap}>
                  <View
                    style={[
                      styles.timerBar,
                      {
                        width: `${Math.max(0, Math.min(100, ((secondsLeft ?? 0) / totalSecs) * 100))}%`,
                        backgroundColor: timerColor,
                      },
                    ]}
                  />
                  <Text style={styles.timerHint}>
                    {timerExpired ? 'Tempo scaduto' : 'Rilancia prima che scada!'}
                  </Text>
                </View>
              </View>
            ) : null}

            <View style={styles.playerRow}>
              <View style={[styles.roleBadge, { backgroundColor: roleTint + '22', borderColor: roleTint + '55' }]}>
                <Text style={[styles.roleBadgeText, { color: roleTint }]}>{player.role}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.playerName} numberOfLines={1}>{player.name}</Text>
                <Text style={styles.playerTeam}>{player.team} · {roleLabels[player.role]}</Text>
              </View>
            </View>

            <View style={styles.bidBox}>
              <View style={{ flex: 1 }}>
                <Text style={styles.bidLabel}>Offerta attuale</Text>
                <Text style={styles.bidValue} testID="current-bid-value">{state.current_bid}</Text>
              </View>
              <View style={styles.bidderCol}>
                <Text style={styles.bidLabel}>{state.current_bidder_name ? 'Rilancio di' : 'Base d\'asta'}</Text>
                <Text style={[styles.bidderName, isCurrentBidder && { color: theme.colors.brandSecondary }]}
                  numberOfLines={1} testID="current-bidder">
                  {state.current_bidder_name || '—'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Middle - Bid log */}
        <View style={styles.logSection}>
          {wallet && (
            <View style={styles.walletBar} testID="auction-wallet">
              <Ionicons name="wallet" size={14} color={theme.colors.brandSecondary} />
              <Text style={styles.walletLbl}>I tuoi Fantamilioni</Text>
              <View style={{ flex: 1 }} />
              <Text style={styles.walletVal}>{wallet.remaining}</Text>
              <Text style={styles.walletTot}> / {wallet.budget}</Text>
            </View>
          )}
          <Text style={styles.logHead}>Log offerte</Text>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
            {bids.map((b, i) => {
              const mine = b.user_id === user?.id;
              return (
                <View key={b.id} style={[styles.bidRow, i === 0 && styles.bidRowLatest]} testID={`bid-row-${i}`}>
                  <View style={[styles.avatar, { backgroundColor: mine ? theme.colors.brandSecondary : theme.colors.surfaceTertiary }]}>
                    <Text style={[styles.avatarText, mine && { color: theme.colors.onBrandSecondary }]}>
                      {b.user_name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.bidUser} numberOfLines={1}>
                      {b.user_name}{mine ? ' (Tu)' : ''}
                    </Text>
                    <Text style={styles.bidMeta}>{relTime(b.created_at)} fa</Text>
                  </View>
                  <Text style={styles.bidAmt}>{b.amount}</Text>
                </View>
              );
            })}
            {bids.length === 0 && (
              <Text style={styles.emptyLog}>Nessuna offerta. Sii il primo a rilanciare!</Text>
            )}
          </ScrollView>
        </View>
      </SafeAreaView>

      {/* Sticky bidding bar */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <BlurView intensity={40} tint="dark" style={styles.stickyBar}>
          <SafeAreaView edges={['bottom']}>
            {errorMsg && <Text style={styles.errorLine} testID="bid-error">{errorMsg}</Text>}
            {hasPassed && !isSold && (
              <View style={styles.passedNote} testID="passed-note">
                <Ionicons name="hand-left" size={12} color={theme.colors.onSurfaceSecondary} />
                <Text style={styles.passedNoteText}>Hai passato — attendi il prossimo giocatore</Text>
              </View>
            )}
            <View style={styles.ctrlRow}>
              <Pressable
                testID="bid-plus-1"
                style={({ pressed }) => [styles.ctrlBtn, styles.ctrlBtnSecondary, pressed && { opacity: 0.8 }, (!canBid || busy) && styles.ctrlBtnDisabled]}
                onPress={() => doBid(state.current_bid + 1)}
                disabled={busy || !canBid}>
                <Text style={styles.ctrlBtnTextSecondary}>+1</Text>
              </Pressable>
              <Pressable
                testID="bid-custom"
                style={({ pressed }) => [styles.ctrlBtn, styles.ctrlBtnPrimary, pressed && { opacity: 0.85 }, (!canBid || busy) && styles.ctrlBtnDisabled]}
                onPress={() => { setCustomAmount(String(state.current_bid + 5)); setCustomVisible(true); }}
                disabled={busy || !canBid}>
                {busy ? <ActivityIndicator color={theme.colors.onBrandSecondary} />
                      : <Text style={styles.ctrlBtnTextPrimary}>
                          {isSold ? 'Venduto' : (hasPassed ? 'Passato' : 'Rilancio custom')}
                        </Text>}
              </Pressable>
              <Pressable
                testID="bid-pass"
                style={({ pressed }) => [styles.ctrlBtn, styles.ctrlBtnGhost, pressed && { opacity: 0.7 }, (!canPass || busy) && styles.ctrlBtnDisabled]}
                onPress={doPass}
                disabled={busy || !canPass}>
                <Text style={styles.ctrlBtnTextGhost}>Passo</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </BlurView>
      </KeyboardAvoidingView>

      {/* Custom bid modal */}
      <Modal visible={customVisible} transparent animationType="fade" onRequestClose={() => setCustomVisible(false)}>
        <Pressable style={styles.modalBg} onPress={() => setCustomVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Rilancio personalizzato</Text>
            <Text style={styles.modalSub}>Offerta minima: {state.current_bid + 1}</Text>
            <TextInput
              testID="custom-bid-input"
              style={styles.modalInput}
              value={customAmount}
              onChangeText={setCustomAmount}
              keyboardType="number-pad"
              placeholder="Es. 25"
              placeholderTextColor={theme.colors.onSurfaceSecondary}
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable style={[styles.modalBtn, styles.modalBtnGhost]} onPress={() => setCustomVisible(false)}>
                <Text style={styles.modalBtnTextGhost}>Annulla</Text>
              </Pressable>
              <Pressable
                testID="custom-bid-confirm"
                style={[styles.modalBtn, styles.modalBtnPrimary]}
                onPress={async () => {
                  const n = parseInt(customAmount, 10);
                  if (Number.isFinite(n)) { setCustomVisible(false); await doBid(n); }
                }}>
                <Text style={styles.modalBtnTextPrimary}>Rilancia</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Player picker modal */}
      <Modal visible={pickerVisible} transparent animationType="slide" onRequestClose={() => setPickerVisible(false)}>
        <View style={styles.pickerBg}>
          <View style={styles.pickerCard}>
            <View style={styles.pickerHead}>
              <Text style={styles.modalTitle}>Prossimo giocatore</Text>
              <Pressable onPress={() => setPickerVisible(false)} testID="picker-close" hitSlop={8}>
                <Ionicons name="close" size={22} color={theme.colors.onSurface} />
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingVertical: 4 }}>
              {[
                { key: null, label: 'Tutti' },
                { key: 'P', label: 'Portieri' },
                { key: 'D', label: 'Difensori' },
                { key: 'C', label: 'Centrocampisti' },
                { key: 'A', label: 'Attaccanti' },
              ].map((c) => (
                <Pressable key={String(c.key)} onPress={() => openPicker(c.key)}
                  style={[styles.chip, roleFilter === c.key && styles.chipActive]}>
                  <Text style={[styles.chipTextC, roleFilter === c.key && styles.chipTextActive]}>{c.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <FlatList
              data={players}
              keyExtractor={(p) => p.id}
              contentContainerStyle={{ padding: 12 }}
              renderItem={({ item }) => {
                const t = roleColors[item.role];
                return (
                  <Pressable style={styles.playerCard} onPress={() => chooseNext(item)} testID={`pick-player-${item.id}`}>
                    <View style={[styles.roleTag, { backgroundColor: t + '22', borderColor: t + '55' }]}>
                      <Text style={[styles.roleTagText, { color: t }]}>{item.role}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.playerCardName}>{item.name}</Text>
                      <Text style={styles.playerCardTeam}>{item.team}</Text>
                    </View>
                    <Text style={styles.playerCardPrice}>{item.price}</Text>
                  </Pressable>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  topSection: { minHeight: 260, overflow: 'hidden', borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  topContent: { flex: 1, paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.md, gap: 10 },
  topHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(239,68,68,0.18)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)' },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.error },
  livePillText: { color: theme.colors.error, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  nextBtn: { flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  nextBtnText: { color: theme.colors.onSurface, fontSize: 12, fontWeight: '600' },

  playerRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  roleBadge: { width: 56, height: 56, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  roleBadgeText: { fontSize: 22, fontWeight: '800' },
  playerName: { color: theme.colors.onSurface, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  playerTeam: { color: theme.colors.onSurfaceSecondary, fontSize: 13, marginTop: 2 },

  bidBox: {
    flexDirection: 'row', alignItems: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: theme.radius.md, padding: theme.spacing.md,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)',
  },
  bidLabel: { color: theme.colors.onSurfaceSecondary, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  bidValue: { color: theme.colors.brandSecondary, fontSize: 42, fontWeight: '800', letterSpacing: -1, lineHeight: 44 },
  bidderCol: { alignItems: 'flex-end', maxWidth: 160 },
  bidderName: { color: theme.colors.onSurface, fontSize: 15, fontWeight: '700' },

  logSection: { flex: 1, paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md },
  walletBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12,
    backgroundColor: 'rgba(212,175,55,0.10)', borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.3)',
  },
  walletLbl: { color: theme.colors.onSurfaceSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  walletVal: { color: theme.colors.brandSecondary, fontSize: 18, fontWeight: '800' },
  walletTot: { color: theme.colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600' },
  logHead: { color: theme.colors.onSurface, fontSize: 15, fontWeight: '700', marginBottom: theme.spacing.sm },
  bidRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md, marginBottom: 8,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  bidRowLatest: { borderColor: theme.colors.brandSecondary, backgroundColor: 'rgba(212,175,55,0.08)' },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: theme.colors.onSurface, fontWeight: '800' },
  bidUser: { color: theme.colors.onSurface, fontSize: 14, fontWeight: '600' },
  bidMeta: { color: theme.colors.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  bidAmt: { color: theme.colors.brandSecondary, fontSize: 20, fontWeight: '800' },
  emptyLog: { color: theme.colors.onSurfaceSecondary, textAlign: 'center', paddingVertical: 32 },

  stickyBar: {
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(13,15,18,0.95)',
  },
  errorLine: { color: theme.colors.warning, textAlign: 'center', fontSize: 12, paddingTop: 6 },
  ctrlRow: { flexDirection: 'row', gap: 8, padding: 12, paddingBottom: 8 },
  ctrlBtn: { borderRadius: theme.radius.md, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  ctrlBtnSecondary: { flex: 0.7, backgroundColor: theme.colors.surfaceTertiary, borderWidth: 1, borderColor: theme.colors.border },
  ctrlBtnPrimary: { flex: 1.6, backgroundColor: theme.colors.brandSecondary },
  ctrlBtnGhost: { flex: 0.7, backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.colors.border },
  ctrlBtnTextSecondary: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 16 },
  ctrlBtnTextPrimary: { color: theme.colors.onBrandSecondary, fontWeight: '800', fontSize: 15 },
  ctrlBtnTextGhost: { color: theme.colors.onSurfaceSecondary, fontWeight: '700', fontSize: 14 },
  ctrlBtnDisabled: { opacity: 0.35 },

  // Timer + Sold banner
  timerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: theme.radius.md,
    padding: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  timerCircle: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  timerNumber: { fontSize: 22, fontWeight: '800', lineHeight: 24 },
  timerLabel: { color: theme.colors.onSurfaceSecondary, fontSize: 8, fontWeight: '700', letterSpacing: 1, marginTop: -2 },
  timerBarWrap: {
    flex: 1, height: 22, backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 11, overflow: 'hidden', position: 'relative',
    justifyContent: 'center',
  },
  timerBar: {
    position: 'absolute', top: 0, left: 0, bottom: 0,
    borderRadius: 11,
  },
  timerHint: {
    color: theme.colors.onSurface, fontSize: 11, fontWeight: '700',
    paddingHorizontal: 10, zIndex: 2,
  },
  soldBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(212,175,55,0.15)',
    borderRadius: theme.radius.md,
    padding: 12,
    borderWidth: 1, borderColor: theme.colors.brandSecondary,
  },
  soldTitle: { color: theme.colors.brandSecondary, fontSize: 14, fontWeight: '800' },
  soldSub: { color: theme.colors.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  passedNote: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingTop: 8,
  },
  passedNoteText: { color: theme.colors.onSurfaceSecondary, fontSize: 11, fontWeight: '600' },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 400, backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.lg, padding: theme.spacing.lg, borderWidth: 1, borderColor: theme.colors.border },
  modalTitle: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '800' },
  modalSub: { color: theme.colors.onSurfaceSecondary, fontSize: 13, marginTop: 4 },
  modalInput: { marginTop: 16, backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: 14, color: theme.colors.onSurface, fontSize: 20, fontWeight: '700', borderWidth: 1, borderColor: theme.colors.border, marginBottom: 16 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: theme.radius.md, alignItems: 'center' },
  modalBtnPrimary: { backgroundColor: theme.colors.brandSecondary },
  modalBtnGhost: { borderWidth: 1, borderColor: theme.colors.border },
  modalBtnTextPrimary: { color: theme.colors.onBrandSecondary, fontWeight: '800' },
  modalBtnTextGhost: { color: theme.colors.onSurface, fontWeight: '600' },

  pickerBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  pickerCard: { height: '85%', backgroundColor: theme.colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: theme.colors.border },
  pickerHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20 },
  chip: { height: 36, paddingHorizontal: 14, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surfaceSecondary, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  chipActive: { backgroundColor: theme.colors.brandSecondary, borderColor: theme.colors.brandSecondary },
  chipTextC: { color: theme.colors.onSurface, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: theme.colors.onBrandSecondary, fontWeight: '800' },
  playerCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.md, marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border },
  roleTag: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  roleTagText: { fontWeight: '800', fontSize: 14 },
  playerCardName: { color: theme.colors.onSurface, fontSize: 14, fontWeight: '700' },
  playerCardTeam: { color: theme.colors.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  playerCardPrice: { color: theme.colors.brandSecondary, fontSize: 18, fontWeight: '800' },
});
