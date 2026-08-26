import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/lib/api';
import { useAuth } from '@/src/lib/auth';
import { useLeague } from '@/src/lib/league';
import { theme } from '@/src/lib/theme';

type Mode = 'create' | 'join';

export default function Onboarding() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { refresh } = useLeague();
  const [mode, setMode] = useState<Mode>('create');
  const [teamName, setTeamName] = useState('');
  const [leagueName, setLeagueName] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!teamName.trim()) { setError('Inserisci il nome della squadra'); return; }
    if (mode === 'join' && code.trim().length < 4) { setError('Codice invito non valido'); return; }
    setLoading(true);
    try {
      if (mode === 'create') {
        await api.createLeague(leagueName.trim() || `Lega di ${user?.name}`, teamName.trim());
      } else {
        await api.joinLeague(code.trim(), teamName.trim());
      }
      await refresh();
      router.replace('/(tabs)');
    } catch (e: any) {
      setError(e.message || 'Operazione fallita');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root} testID="onboarding-screen">
      <Image source={{ uri: theme.images.stadium }} style={StyleSheet.absoluteFill} contentFit="cover" />
      <LinearGradient
        colors={['rgba(13,15,18,0.55)', 'rgba(13,15,18,0.85)', theme.colors.surface]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.topBar}>
              <View style={styles.badge}>
                <Ionicons name="football" size={12} color={theme.colors.brandSecondary} />
                <Text style={styles.badgeText}>BENVENUTO {user?.name?.toUpperCase()}</Text>
              </View>
              <Pressable onPress={logout} hitSlop={8} testID="onboarding-logout">
                <Text style={styles.logoutText}>Esci</Text>
              </Pressable>
            </View>

            <Text style={styles.title}>Inizia a giocare</Text>
            <Text style={styles.subtitle}>Crea una nuova lega con gli amici o unisciti con un codice invito.</Text>

            <View style={styles.segment}>
              <Pressable
                testID="onboarding-mode-create"
                style={[styles.segmentBtn, mode === 'create' && styles.segmentBtnActive]}
                onPress={() => setMode('create')}
              >
                <Ionicons name="add-circle-outline" size={16}
                  color={mode === 'create' ? theme.colors.onBrandSecondary : theme.colors.onSurfaceSecondary} />
                <Text style={[styles.segmentText, mode === 'create' && styles.segmentTextActive]}>Crea</Text>
              </Pressable>
              <Pressable
                testID="onboarding-mode-join"
                style={[styles.segmentBtn, mode === 'join' && styles.segmentBtnActive]}
                onPress={() => setMode('join')}
              >
                <Ionicons name="enter-outline" size={16}
                  color={mode === 'join' ? theme.colors.onBrandSecondary : theme.colors.onSurfaceSecondary} />
                <Text style={[styles.segmentText, mode === 'join' && styles.segmentTextActive]}>Unisciti</Text>
              </Pressable>
            </View>

            <BlurView intensity={30} tint="dark" style={styles.card}>
              <View style={styles.cardInner}>
                <View style={styles.field}>
                  <Ionicons name="shield-outline" size={18} color={theme.colors.onSurfaceSecondary} />
                  <TextInput
                    testID="onboarding-team-input"
                    style={styles.input}
                    placeholder="Nome della tua squadra"
                    placeholderTextColor={theme.colors.onSurfaceSecondary}
                    value={teamName}
                    onChangeText={setTeamName}
                  />
                </View>

                {mode === 'create' ? (
                  <View style={styles.field}>
                    <Ionicons name="trophy-outline" size={18} color={theme.colors.onSurfaceSecondary} />
                    <TextInput
                      testID="onboarding-league-input"
                      style={styles.input}
                      placeholder="Nome della lega (opzionale)"
                      placeholderTextColor={theme.colors.onSurfaceSecondary}
                      value={leagueName}
                      onChangeText={setLeagueName}
                    />
                  </View>
                ) : (
                  <View style={styles.field}>
                    <Ionicons name="key-outline" size={18} color={theme.colors.onSurfaceSecondary} />
                    <TextInput
                      testID="onboarding-code-input"
                      style={styles.input}
                      placeholder="Codice invito (6 cifre)"
                      placeholderTextColor={theme.colors.onSurfaceSecondary}
                      keyboardType="number-pad"
                      maxLength={8}
                      value={code}
                      onChangeText={(t) => setCode(t.replace(/[^0-9A-Za-z]/g, ''))}
                    />
                  </View>
                )}

                {error ? <Text style={styles.error} testID="onboarding-error">{error}</Text> : null}

                <Pressable
                  testID="onboarding-submit"
                  style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
                  onPress={submit}
                  disabled={loading}
                >
                  {loading
                    ? <ActivityIndicator color={theme.colors.onBrandSecondary} />
                    : <Text style={styles.ctaText}>
                        {mode === 'create' ? 'Crea la lega' : 'Unisciti alla lega'}
                      </Text>}
                </Pressable>

                {mode === 'create' && (
                  <Text style={styles.hint}>
                    Riceverai un codice invito a 6 cifre da condividere con gli amici.
                  </Text>
                )}
              </View>
            </BlurView>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  scroll: { flexGrow: 1, paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.xl },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.xl },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(212,175,55,0.12)', paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: theme.radius.pill, borderWidth: 1, borderColor: 'rgba(212,175,55,0.35)',
  },
  badgeText: { color: theme.colors.brandSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  logoutText: { color: theme.colors.onSurfaceSecondary, fontSize: 13 },
  title: { color: theme.colors.onSurface, fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: theme.colors.onSurfaceSecondary, fontSize: 14, marginTop: 6, marginBottom: theme.spacing.lg },
  segment: {
    flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: theme.radius.pill, padding: 4,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  segmentBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: theme.radius.pill,
  },
  segmentBtnActive: { backgroundColor: theme.colors.brandSecondary },
  segmentText: { color: theme.colors.onSurfaceSecondary, fontSize: 13, fontWeight: '600' },
  segmentTextActive: { color: theme.colors.onBrandSecondary, fontWeight: '800' },
  card: { borderRadius: theme.radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginTop: theme.spacing.md },
  cardInner: { padding: theme.spacing.lg, backgroundColor: 'rgba(13,15,18,0.55)' },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: theme.radius.md,
    paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 14 : 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: theme.spacing.sm,
  },
  input: { flex: 1, color: theme.colors.onSurface, fontSize: 15, paddingVertical: 4 },
  error: { color: theme.colors.error, fontSize: 13, marginTop: 4, marginBottom: 4 },
  cta: { marginTop: theme.spacing.md, backgroundColor: theme.colors.brandSecondary, borderRadius: theme.radius.md, paddingVertical: 15, alignItems: 'center' },
  ctaText: { color: theme.colors.onBrandSecondary, fontSize: 15, fontWeight: '800', letterSpacing: 0.3 },
  hint: { color: theme.colors.onSurfaceSecondary, fontSize: 12, marginTop: 10, textAlign: 'center' },
});
