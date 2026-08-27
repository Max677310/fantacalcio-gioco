import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/lib/api';
import { theme } from '@/src/lib/theme';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    setError(null);
    if (!email.trim()) { setError('Inserisci la tua email'); return; }
    setLoading(true);
    try {
      await api.forgotPassword(email.trim().toLowerCase());
      setSent(true);
    } catch (e: any) {
      setError(e.message || 'Impossibile inviare l\'email');
    } finally { setLoading(false); }
  };

  return (
    <View style={styles.root} testID="forgot-password-screen">
      <Stack.Screen options={{ headerShown: false }} />
      <Image source={{ uri: theme.images.stadium }} style={StyleSheet.absoluteFill} contentFit="cover" transition={300} />
      <LinearGradient
        colors={['rgba(13,15,18,0.55)', 'rgba(13,15,18,0.85)', theme.colors.surface]}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.topBar}>
            <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn} testID="fp-back">
              <Ionicons name="chevron-back" size={22} color={theme.colors.onSurface} />
            </Pressable>
          </View>

          <View style={styles.header}>
            <View style={styles.badge}>
              <Ionicons name="key" size={16} color={theme.colors.brandSecondary} />
              <Text style={styles.badgeText}>RECUPERO PASSWORD</Text>
            </View>
            <Text style={styles.title}>Reimposta{'\n'}la tua password</Text>
            <Text style={styles.subtitle}>
              Ti invieremo un codice a 6 cifre valido per 15 minuti.
            </Text>
          </View>

          <BlurView intensity={30} tint="dark" style={styles.card}>
            <View style={styles.cardInner}>
              {sent ? (
                <>
                  <View style={styles.okIcon}>
                    <Ionicons name="checkmark-circle" size={44} color={theme.colors.success} />
                  </View>
                  <Text style={styles.cardTitle}>Controlla la tua email</Text>
                  <Text style={styles.helpText}>
                    Se l&apos;indirizzo esiste nel nostro sistema, riceverai un codice a 6 cifre entro
                    pochi istanti. Controlla anche la cartella spam.
                  </Text>
                  <Pressable
                    testID="continue-to-reset"
                    style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
                    onPress={() => router.push({ pathname: '/auth/reset-password', params: { email } })}
                  >
                    <Text style={styles.ctaText}>Ho ricevuto il codice</Text>
                  </Pressable>
                  <Pressable onPress={() => setSent(false)} hitSlop={8} style={{ marginTop: 12, alignItems: 'center' }}>
                    <Text style={styles.linkGhost}>Reinvia con un&apos;altra email</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={styles.cardTitle}>Email dell&apos;account</Text>
                  <View style={styles.field}>
                    <Ionicons name="mail-outline" size={18} color={theme.colors.onSurfaceSecondary} />
                    <TextInput
                      testID="fp-email-input"
                      style={styles.input}
                      placeholder="Email"
                      placeholderTextColor={theme.colors.onSurfaceSecondary}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="email-address"
                      value={email}
                      onChangeText={setEmail}
                    />
                  </View>
                  {error && <Text style={styles.error} testID="fp-error">{error}</Text>}
                  <Pressable
                    testID="fp-submit"
                    style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
                    onPress={submit}
                    disabled={loading}
                  >
                    {loading
                      ? <ActivityIndicator color={theme.colors.onBrandSecondary} />
                      : <Text style={styles.ctaText}>Invia codice</Text>}
                  </Pressable>
                  <Pressable
                    onPress={() => router.replace('/auth/sign-in')}
                    hitSlop={8}
                    style={{ marginTop: 12, alignItems: 'center' }}
                  >
                    <Text style={styles.linkGhost}>Torna al login</Text>
                  </Pressable>
                </>
              )}
            </View>
          </BlurView>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  scroll: { flexGrow: 1, paddingHorizontal: theme.spacing.lg, paddingTop: 60, paddingBottom: theme.spacing.xl },
  topBar: { position: 'absolute', top: 40, left: theme.spacing.lg, zIndex: 5 },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: theme.colors.border,
  },
  header: { paddingHorizontal: theme.spacing.sm, marginTop: 20, marginBottom: theme.spacing.lg },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: 'rgba(212,175,55,0.12)',
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.35)',
  },
  badgeText: { color: theme.colors.brandSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
  title: { color: theme.colors.onSurface, fontSize: 32, lineHeight: 36, fontWeight: '800', marginTop: 16, letterSpacing: -0.8 },
  subtitle: { color: theme.colors.onSurfaceSecondary, fontSize: 14, lineHeight: 20, marginTop: 8 },
  card: {
    borderRadius: theme.radius.lg, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  cardInner: { padding: theme.spacing.lg, backgroundColor: 'rgba(26,29,36,0.75)' },
  cardTitle: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '700', marginBottom: theme.spacing.md },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: theme.radius.md,
    paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 14 : 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  input: { flex: 1, color: theme.colors.onSurface, fontSize: 15, paddingVertical: 4 },
  error: { color: theme.colors.error, fontSize: 13, marginTop: 8 },
  helpText: { color: theme.colors.onSurfaceSecondary, fontSize: 13, lineHeight: 19, marginBottom: theme.spacing.md },
  okIcon: { alignItems: 'center', marginBottom: 8 },
  cta: {
    marginTop: theme.spacing.md,
    backgroundColor: theme.colors.brandSecondary,
    borderRadius: theme.radius.md,
    paddingVertical: 15, alignItems: 'center',
  },
  ctaText: { color: theme.colors.onBrandSecondary, fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
  linkGhost: { color: theme.colors.brandPrimary, fontSize: 13, fontWeight: '600' },
});
