import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  Alert, RefreshControl, TextInput, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/lib/api';
import { useAuth } from '@/src/lib/auth';
import { useLeague } from '@/src/lib/league';
import { theme } from '@/src/lib/theme';

type Status = {
  matchday: number;
  start_matchday: number;
  has_ratings: boolean;
  ratings_count: number;
  settled: boolean;
  settled_at: string | null;
};

type Report = {
  matchday: number;
  settled_at: string;
  fixtures: any[];
  scores: any[];
};

export default function MatchdayScreen() {
  const router = useRouter();
  const { league } = useLeague();
  const { user } = useAuth();
  const isAdmin = league?.admin_id === user?.id;

  const [matchday, setMatchday] = useState<number>(1);
  const [status, setStatus] = useState<Status | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [working, setWorking] = useState<string | null>(null); // 'mock' | 'settle' | 'reset' | 'json'

  const [jsonModal, setJsonModal] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [chaosLevel, setChaosLevel] = useState<0 | 1 | 2>(1); // low / med / high

  useEffect(() => {
    if (!league) return;
    const initial = (league as any).start_matchday || 1;
    setMatchday(initial);
  }, [league]);

  const load = useCallback(async () => {
    if (!league) return;
    setLoading(true);
    try {
      const st = await api.matchdayStatus(league.id, matchday);
      setStatus(st);
      if (st.settled) {
        const rep = await api.matchdayResults(league.id, matchday);
        setReport(rep);
      } else {
        setReport(null);
      }
    } catch (e: any) {
      Alert.alert('Errore', e?.message || 'Impossibile caricare lo stato');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [league, matchday]);

  useEffect(() => { load(); }, [load]);

  const onGenerateMock = async () => {
    if (!league) return;
    const chaos = chaosLevel === 0 ? 0.2 : chaosLevel === 1 ? 0.5 : 0.85;
    setWorking('mock');
    try {
      const res = await api.generateMockRatings(league.id, matchday, chaos);
      Alert.alert('Voti generati', `${res.inserted} voti mock salvati per la ${matchday}ª giornata.`);
      await load();
    } catch (e: any) {
      Alert.alert('Errore', e?.message || 'Generazione fallita');
    } finally { setWorking(null); }
  };

  const onSettle = async () => {
    if (!league) return;
    setWorking('settle');
    try {
      const rep = await api.settleMatchday(league.id, matchday);
      setReport(rep);
      const st = await api.matchdayStatus(league.id, matchday);
      setStatus(st);
      const played = (rep.fixtures || []).filter((f: any) => !f.is_bye).length;
      Alert.alert('Giornata calcolata', `${played} partite chiuse. Classifica aggiornata.`);
    } catch (e: any) {
      Alert.alert('Errore', e?.message || 'Calcolo fallito');
    } finally { setWorking(null); }
  };

  const onReset = async () => {
    if (!league) return;
    Alert.alert(
      'Ripristina giornata',
      `Verranno annullati i risultati della ${matchday}ª giornata e sottratti i punti dalla classifica. Continuare?`,
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Sì, ripristina',
          style: 'destructive',
          onPress: async () => {
            setWorking('reset');
            try {
              await api.resetMatchday(league.id, matchday);
              await load();
            } catch (e: any) {
              Alert.alert('Errore', e?.message || 'Reset fallito');
            } finally { setWorking(null); }
          },
        },
      ],
    );
  };

  const onUploadJson = async () => {
    if (!league) return;
    let parsed: any;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      Alert.alert('JSON non valido', 'Verifica la sintassi del testo inserito.');
      return;
    }
    const list = Array.isArray(parsed) ? parsed : (parsed?.ratings || []);
    if (!Array.isArray(list) || list.length === 0) {
      Alert.alert('Formato non valido', 'Fornisci una lista di oggetti { player_id, base_vote, ... }');
      return;
    }
    setWorking('json');
    try {
      const res = await api.uploadRatingsManual(league.id, matchday, list);
      Alert.alert('Voti caricati', `${res.inserted} voti manuali salvati.`);
      setJsonModal(false);
      setJsonText('');
      await load();
    } catch (e: any) {
      Alert.alert('Errore', e?.message || 'Upload fallito');
    } finally { setWorking(null); }
  };

  const canGoPrev = matchday > 1;
  const canGoNext = matchday < 38;

  if (!league) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}><ActivityIndicator color={theme.colors.brandSecondary} /></View>
      </SafeAreaView>
    );
  }

  const startMd = (league as any).start_matchday || 1;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="matchday-screen">
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn} testID="md-back">
          <Ionicons name="chevron-back" size={22} color={theme.colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Gestione Giornata</Text>
          <Text style={styles.subtitle}>
            {isAdmin ? 'Carica i voti, calcola i risultati e aggiorna la classifica' : 'Solo l\'admin può calcolare le giornate'}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.colors.brandSecondary} />}
      >
        {/* Matchday picker */}
        <View style={styles.mdPicker} testID="md-picker">
          <Pressable
            testID="md-prev"
            onPress={() => canGoPrev && setMatchday((m) => m - 1)}
            style={[styles.mdArrow, !canGoPrev && { opacity: 0.3 }]}
            disabled={!canGoPrev}
          >
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <View style={styles.mdValueBox}>
            <Text style={styles.mdNumber}>{matchday}<Text style={styles.mdOrd}>ª</Text></Text>
            <Text style={styles.mdCaption}>Giornata (partenza: {startMd}ª)</Text>
          </View>
          <Pressable
            testID="md-next"
            onPress={() => canGoNext && setMatchday((m) => m + 1)}
            style={[styles.mdArrow, !canGoNext && { opacity: 0.3 }]}
            disabled={!canGoNext}
          >
            <Ionicons name="chevron-forward" size={26} color={theme.colors.onSurface} />
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={theme.colors.brandSecondary} /></View>
        ) : (
          <>
            {/* Status pills */}
            <View style={styles.statusRow}>
              <View style={[styles.pill, status?.has_ratings ? styles.pillOk : styles.pillMuted]}>
                <Ionicons
                  name={status?.has_ratings ? 'checkmark-circle' : 'time-outline'}
                  size={12}
                  color={status?.has_ratings ? theme.colors.success : theme.colors.onSurfaceSecondary}
                />
                <Text style={[styles.pillText, status?.has_ratings ? { color: theme.colors.success } : {}]}>
                  {status?.has_ratings ? `${status.ratings_count} voti caricati` : 'Nessun voto'}
                </Text>
              </View>
              <View style={[styles.pill, status?.settled ? styles.pillLive : styles.pillMuted]}>
                <Ionicons
                  name={status?.settled ? 'trophy' : 'hourglass-outline'}
                  size={12}
                  color={status?.settled ? theme.colors.brandSecondary : theme.colors.onSurfaceSecondary}
                />
                <Text style={[styles.pillText, status?.settled ? { color: theme.colors.brandSecondary } : {}]}>
                  {status?.settled ? 'Calcolata' : 'Non calcolata'}
                </Text>
              </View>
            </View>

            {isAdmin && (
              <>
                {/* Actions: Load ratings */}
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>1. Carica i voti</Text>
                  <Text style={styles.cardHelp}>
                    Genera voti demo per testare, oppure carica manualmente i voti ufficiali della Gazzetta.
                  </Text>

                  <View style={styles.chaosRow}>
                    <Text style={styles.chaosLabel}>Realismo mock:</Text>
                    {(['Basso', 'Medio', 'Alto'] as const).map((lbl, i) => {
                      const active = chaosLevel === i;
                      return (
                        <Pressable
                          key={lbl}
                          testID={`chaos-${lbl}`}
                          onPress={() => setChaosLevel(i as 0 | 1 | 2)}
                          style={[styles.chaosChip, active && styles.chaosChipActive]}
                        >
                          <Text style={[styles.chaosChipText, active && styles.chaosChipTextActive]}>{lbl}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <View style={styles.actionRow}>
                    <Pressable
                      testID="btn-mock"
                      onPress={onGenerateMock}
                      style={({ pressed }) => [styles.actionBtn, styles.actionSecondary, pressed && { opacity: 0.8 }, (working === 'mock' || status?.settled) && { opacity: 0.5 }]}
                      disabled={working !== null || status?.settled}
                    >
                      {working === 'mock'
                        ? <ActivityIndicator color={theme.colors.onSurface} />
                        : <>
                            <Ionicons name="dice" size={18} color={theme.colors.onSurface} />
                            <Text style={styles.actionText}>Genera voti demo</Text>
                          </>}
                    </Pressable>
                    <Pressable
                      testID="btn-manual"
                      onPress={() => setJsonModal(true)}
                      style={({ pressed }) => [styles.actionBtn, styles.actionSecondary, pressed && { opacity: 0.8 }, status?.settled && { opacity: 0.5 }]}
                      disabled={status?.settled}
                    >
                      <Ionicons name="document-text" size={18} color={theme.colors.onSurface} />
                      <Text style={styles.actionText}>Carica JSON</Text>
                    </Pressable>
                  </View>
                </View>

                {/* Actions: Settle */}
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>2. Calcola la giornata</Text>
                  <Text style={styles.cardHelp}>
                    Applica il regolamento (bonus/malus), sostituisce dalla panchina i titolari senza voto e aggiorna automaticamente la classifica.
                  </Text>
                  <Pressable
                    testID="btn-settle"
                    onPress={onSettle}
                    style={({ pressed }) => [
                      styles.actionBtn, styles.actionPrimary,
                      pressed && { opacity: 0.85 },
                      (working === 'settle' || !status?.has_ratings || status?.settled) && { opacity: 0.5 },
                    ]}
                    disabled={working !== null || !status?.has_ratings || status?.settled}
                  >
                    {working === 'settle'
                      ? <ActivityIndicator color={theme.colors.onBrandSecondary} />
                      : <>
                          <Ionicons name="calculator" size={18} color={theme.colors.onBrandSecondary} />
                          <Text style={styles.actionPrimaryText}>
                            {status?.settled ? 'Già calcolata' : 'Calcola giornata'}
                          </Text>
                        </>}
                  </Pressable>
                  {status?.settled && (
                    <Pressable
                      testID="btn-reset"
                      onPress={onReset}
                      style={({ pressed }) => [styles.actionBtn, styles.actionGhost, pressed && { opacity: 0.85 }]}
                      disabled={working !== null}
                    >
                      {working === 'reset'
                        ? <ActivityIndicator color={theme.colors.error} />
                        : <>
                            <Ionicons name="refresh" size={16} color={theme.colors.error} />
                            <Text style={[styles.actionText, { color: theme.colors.error }]}>Ripristina giornata</Text>
                          </>}
                    </Pressable>
                  )}
                </View>
              </>
            )}

            {/* Results */}
            {report && (
              <>
                <Text style={styles.sectionHead}>Risultati</Text>
                {report.fixtures.map((f: any, i: number) => (
                  <View key={i} style={styles.fixtureRow} testID={`fixture-result-${i}`}>
                    {f.is_bye ? (
                      <View style={styles.byeRow}>
                        <Ionicons name="pause-circle" size={16} color={theme.colors.onSurfaceSecondary} />
                        <Text style={styles.byeText}>Turno di riposo · {f.bye_team}</Text>
                      </View>
                    ) : (
                      <>
                        <View style={styles.teamCol}>
                          <Text style={styles.teamName} numberOfLines={1}>{f.home_team}</Text>
                          <Text style={styles.fvSub}>fv {f.home_fv?.toFixed(1)}</Text>
                        </View>
                        <View style={styles.scoreBox}>
                          <Text style={styles.scoreText}>{f.home_score} – {f.away_score}</Text>
                        </View>
                        <View style={[styles.teamCol, { alignItems: 'flex-end' }]}>
                          <Text style={styles.teamName} numberOfLines={1}>{f.away_team}</Text>
                          <Text style={styles.fvSub}>fv {f.away_fv?.toFixed(1)}</Text>
                        </View>
                      </>
                    )}
                  </View>
                ))}

                <Text style={[styles.sectionHead, { marginTop: theme.spacing.lg }]}>Top voti</Text>
                {report.scores
                  .slice()
                  .sort((a: any, b: any) => b.fantavoto - a.fantavoto)
                  .map((s: any, i: number) => (
                    <View key={s.user_id} style={styles.scoreCard} testID={`score-card-${i}`}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.scoreTeam}>{s.team_name}</Text>
                        <Text style={styles.scoreMeta}>
                          {s.formation} · fantavoto {s.fantavoto.toFixed(1)} → {s.goals_scored} {s.goals_scored === 1 ? 'gol' : 'gol'}
                          {s.bench_used?.length ? ` · ${s.bench_used.length} panch.` : ''}
                        </Text>
                      </View>
                      <View style={styles.scoreBadge}>
                        <Text style={styles.scoreBadgeText}>{s.goals_scored}</Text>
                      </View>
                    </View>
                  ))}
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* JSON upload modal */}
      <Modal
        visible={jsonModal}
        transparent
        animationType="fade"
        onRequestClose={() => !working && setJsonModal(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => !working && setJsonModal(false)}>
            <Pressable style={styles.modalCard} onPress={() => {}}>
              <View style={styles.modalHead}>
                <Ionicons name="document-text" size={20} color={theme.colors.brandSecondary} />
                <Text style={styles.modalTitle}>Carica voti manuali (JSON)</Text>
              </View>
              <Text style={styles.modalSub}>
                Formato: lista di oggetti con almeno {`{ player_id, base_vote }`} — opzionali: goals, assists, yellow, red, own_goal, penalty_saved, penalty_missed, played.
              </Text>
              <TextInput
                testID="json-input"
                style={styles.jsonInput}
                multiline
                placeholder={`[
  { "player_id": "p0001", "base_vote": 7, "goals": 1 },
  { "player_id": "p0002", "base_vote": 5.5, "played": false }
]`}
                placeholderTextColor={theme.colors.onSurfaceSecondary}
                value={jsonText}
                onChangeText={setJsonText}
                autoCorrect={false}
                autoCapitalize="none"
              />
              <View style={styles.modalBtnRow}>
                <Pressable
                  onPress={() => setJsonModal(false)}
                  style={[styles.modalBtn, styles.actionGhost]}
                  disabled={working !== null}
                >
                  <Text style={styles.actionText}>Annulla</Text>
                </Pressable>
                <Pressable
                  testID="json-upload"
                  onPress={onUploadJson}
                  style={[styles.modalBtn, styles.actionPrimary, working === 'json' && { opacity: 0.7 }]}
                  disabled={working !== null}
                >
                  {working === 'json'
                    ? <ActivityIndicator color={theme.colors.onBrandSecondary} />
                    : <Text style={styles.actionPrimaryText}>Carica voti</Text>}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  center: { padding: theme.spacing.xl, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md,
    borderBottomWidth: 1, borderBottomColor: theme.colors.divider,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: theme.colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: theme.colors.onSurface, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  subtitle: { color: theme.colors.onSurfaceSecondary, fontSize: 11, marginTop: 2 },

  mdPicker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    borderWidth: 1, borderColor: theme.colors.border,
    marginBottom: theme.spacing.md,
  },
  mdArrow: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: theme.colors.surfaceTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  mdValueBox: { alignItems: 'center' },
  mdNumber: { color: theme.colors.brandSecondary, fontSize: 44, fontWeight: '800', letterSpacing: -1 },
  mdOrd: { fontSize: 24 },
  mdCaption: { color: theme.colors.onSurfaceSecondary, fontSize: 11, marginTop: -6 },

  statusRow: { flexDirection: 'row', gap: 8, marginBottom: theme.spacing.md },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
  },
  pillOk: { backgroundColor: 'rgba(46,204,113,0.12)', borderColor: 'rgba(46,204,113,0.35)' },
  pillLive: { backgroundColor: 'rgba(212,175,55,0.12)', borderColor: 'rgba(212,175,55,0.35)' },
  pillMuted: { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)' },
  pillText: { color: theme.colors.onSurfaceSecondary, fontSize: 11, fontWeight: '700' },

  card: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    borderWidth: 1, borderColor: theme.colors.border,
    marginBottom: theme.spacing.md,
  },
  cardTitle: { color: theme.colors.onSurface, fontSize: 15, fontWeight: '800', marginBottom: 4 },
  cardHelp: { color: theme.colors.onSurfaceSecondary, fontSize: 12, lineHeight: 17, marginBottom: theme.spacing.sm },

  chaosRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: theme.spacing.sm, flexWrap: 'wrap' },
  chaosLabel: { color: theme.colors.onSurfaceSecondary, fontSize: 11, marginRight: 4, fontWeight: '600' },
  chaosChip: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  chaosChipActive: {
    backgroundColor: 'rgba(212,175,55,0.15)',
    borderColor: theme.colors.brandSecondary,
  },
  chaosChipText: { color: theme.colors.onSurfaceSecondary, fontSize: 11, fontWeight: '700' },
  chaosChipTextActive: { color: theme.colors.brandSecondary },

  actionRow: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 12, borderRadius: theme.radius.md,
  },
  actionPrimary: { backgroundColor: theme.colors.brandSecondary },
  actionPrimaryText: { color: theme.colors.onBrandSecondary, fontWeight: '800', fontSize: 14 },
  actionSecondary: {
    backgroundColor: theme.colors.surfaceTertiary,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  actionGhost: {
    marginTop: 10,
    backgroundColor: 'rgba(255,64,64,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,64,64,0.3)',
  },
  actionText: { color: theme.colors.onSurface, fontWeight: '700', fontSize: 13 },

  sectionHead: {
    color: theme.colors.onSurface, fontSize: 15, fontWeight: '800',
    marginBottom: theme.spacing.sm,
  },
  fixtureRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    borderWidth: 1, borderColor: theme.colors.border,
    marginBottom: 8,
  },
  byeRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' },
  byeText: { color: theme.colors.onSurfaceSecondary, fontSize: 13, fontStyle: 'italic' },
  teamCol: { flex: 1 },
  teamName: { color: theme.colors.onSurface, fontSize: 13, fontWeight: '700' },
  fvSub: { color: theme.colors.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  scoreBox: {
    backgroundColor: theme.colors.brandSecondary,
    borderRadius: theme.radius.sm,
    paddingVertical: 6, paddingHorizontal: 12,
    marginHorizontal: 10,
  },
  scoreText: { color: theme.colors.onBrandSecondary, fontSize: 15, fontWeight: '800' },

  scoreCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    borderWidth: 1, borderColor: theme.colors.border,
    marginBottom: 6,
  },
  scoreTeam: { color: theme.colors.onSurface, fontSize: 14, fontWeight: '700' },
  scoreMeta: { color: theme.colors.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  scoreBadge: {
    minWidth: 34, height: 34, borderRadius: 17, paddingHorizontal: 8,
    backgroundColor: 'rgba(212,175,55,0.15)',
    borderWidth: 1, borderColor: theme.colors.brandSecondary,
    alignItems: 'center', justifyContent: 'center',
  },
  scoreBadgeText: { color: theme.colors.brandSecondary, fontSize: 15, fontWeight: '800' },

  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center', padding: theme.spacing.lg,
  },
  modalCard: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  modalHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  modalTitle: { color: theme.colors.onSurface, fontSize: 17, fontWeight: '800' },
  modalSub: { color: theme.colors.onSurfaceSecondary, fontSize: 11, lineHeight: 16, marginBottom: theme.spacing.md },
  jsonInput: {
    minHeight: 180, maxHeight: 300,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    color: theme.colors.onSurface,
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    borderWidth: 1, borderColor: theme.colors.border,
    textAlignVertical: 'top',
  },
  modalBtnRow: { flexDirection: 'row', gap: 10, marginTop: theme.spacing.md },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center' },
});
