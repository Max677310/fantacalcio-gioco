import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { useRouter, Link } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/lib/auth';
import { theme } from '@/src/lib/theme';

type Mode = 'create' | 'join';

export default function SignUp() {
  const router = useRouter();
  const { register } = useAuth();
  const [mode, setMode] = useState<Mode>('create');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [teamName, setTeamName] = useState('');
  const [leagueName, setLeagueName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    if (!name || !email || !password) { setError('Compila tutti i campi'); return; }
    if (password.length < 6) { setError('Password minima: 6 caratteri'); return; }
    if (!teamName.trim()) { setError('Inserisci il nome della tua squadra'); return; }
    if (mode === 'join' && inviteCode.trim().length < 4) {
      setError('Inserisci un codice invito valido'); return;
    }
    setLoading(true);
    try {
      await register({
        email: email.trim(),
        password,
        name: name.trim(),
        action: mode,
        team_name: teamName.trim(),
        invite_code: mode === 'join' ? inviteCode.trim() : undefined,
        league_name: mode === 'create' ? (leagueName.trim() || undefined) : undefined,
      });
      router.replace('/(tabs)');
    } catch (e: any) {
      setError(e.message || 'Registrazione fallita');
    } finally { setLoading(false); }
  };

  return (
    <View style={styles.root} testID="sign-up-screen">
      <Image source={{ uri: theme.images.stadium }} style={StyleSheet.absoluteFill} contentFit="cover" />
      <LinearGradient
        colors={['rgba(13,15,18,0.6)', 'rgba(13,15,18,0.9)', theme.colors.surface]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} style={styles.back} testID="back-button" hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={theme.colors.onSurface} />
          </Pressable>

          <Text style={styles.title}>Registrati</Text>
          <Text style={styles.subtitle}>Crea una nuova lega o unisciti a quella dei tuoi amici.</Text>

          {/* Mode toggle */}
          <View style={styles.segment}>
            <Pressable
              testID="mode-create"
              style={[styles.segmentBtn, mode === 'create' && styles.segmentBtnActive]}
              onPress={() => setMode('create')}
            >
              <Ionicons name="add-circle-outline" size={16}
                color={mode === 'create' ? theme.colors.onBrandSecondary : theme.colors.onSurfaceSecondary} />
              <Text style={[styles.segmentText, mode === 'create' && styles.segmentTextActive]}>
                Crea lega
              </Text>
            </Pressable>
            <Pressable
              testID="mode-join"
              style={[styles.segmentBtn, mode === 'join' && styles.segmentBtnActive]}
              onPress={() => setMode('join')}
            >
              <Ionicons name="enter-outline" size={16}
                color={mode === 'join' ? theme.colors.onBrandSecondary : theme.colors.onSurfaceSecondary} />
              <Text style={[styles.segmentText, mode === 'join' && styles.segmentTextActive]}>
                Unisciti con codice
              </Text>
            </Pressable>
          </View>

          <BlurView intensity={30} tint="dark" style={styles.card}>
            <View style={styles.cardInner}>
              <Field icon="person-outline" testID="sign-up-name-input" placeholder="Il tuo nome"
                value={name} onChangeText={setName} />
              <Field icon="mail-outline" testID="sign-up-email-input" placeholder="Email"
                value={email} onChangeText={setEmail}
                autoCapitalize="none" keyboardType="email-address" />
              <Field icon="lock-closed-outline" testID="sign-up-password-input" placeholder="Password (min. 6)"
                value={password} onChangeText={setPassword} secureTextEntry />

              <View style={styles.sep} />
              <Text style={styles.sectionLabel}>
                {mode === 'create' ? 'La tua lega' : 'Unisciti alla lega'}
              </Text>

              <Field icon="shield-outline" testID="sign-up-team-input" placeholder="Nome della tua squadra"
                value={teamName} onChangeText={setTeamName} />

              {mode === 'create' ? (
                <Field icon="trophy-outline" testID="sign-up-league-name-input"
                  placeholder="Nome della lega (opzionale)"
                  value={leagueName} onChangeText={setLeagueName} />
              ) : (
                <Field icon="key-outline" testID="sign-up-code-input" placeholder="Codice invito (6 cifre)"
                  value={inviteCode} onChangeText={(t) => setInviteCode(t.replace(/[^0-9A-Za-z]/g, '').slice(0, 8))}
                  keyboardType="number-pad" maxLength={8} />
              )}

              {error ? <Text style={styles.error} testID="sign-up-error">{error}</Text> : null}

              <Pressable
                testID="sign-up-submit-button"
                style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
                onPress={onSubmit}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator color={theme.colors.onBrandSecondary} />
                  : <Text style={styles.ctaText}>
                      {mode === 'create' ? 'Crea account e lega' : 'Crea account e unisciti'}
                    </Text>}
              </Pressable>

              <View style={styles.footerRow}>
                <Text style={styles.footerLabel}>Hai già un account?</Text>
                <Link href="/auth/sign-in" asChild>
                  <Pressable testID="go-to-sign-in-button" hitSlop={8}>
                    <Text style={styles.footerLink}>Accedi</Text>
                  </Pressable>
                </Link>
              </View>
            </View>
          </BlurView>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Field({ icon, ...props }: any) {
  return (
    <View style={styles.field}>
      <Ionicons name={icon} size={18} color={theme.colors.onSurfaceSecondary} />
      <TextInput
        {...props}
        style={styles.input}
        placeholderTextColor={theme.colors.onSurfaceSecondary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  scroll: { flexGrow: 1, paddingHorizontal: theme.spacing.lg, paddingTop: 60, paddingBottom: theme.spacing.xl },
  back: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.lg,
  },
  title: { color: theme.colors.onSurface, fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: theme.colors.onSurfaceSecondary, fontSize: 14, lineHeight: 20, marginTop: 6, maxWidth: 320 },

  segment: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: theme.radius.pill,
    padding: 4,
    marginTop: theme.spacing.lg,
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
  sep: { height: 1, backgroundColor: theme.colors.divider, marginVertical: theme.spacing.md },
  sectionLabel: { color: theme.colors.brandSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 8 },
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
  footerRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: theme.spacing.md },
  footerLabel: { color: theme.colors.onSurfaceSecondary, fontSize: 14 },
  footerLink: { color: theme.colors.brandPrimary, fontSize: 14, fontWeight: '700' },
});
