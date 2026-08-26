import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator, Dimensions,
} from 'react-native';
import { useRouter, Link } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/lib/auth';
import { theme } from '@/src/lib/theme';

const { height: SH } = Dimensions.get('window');

export default function SignIn() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('demo@fanta.it');
  const [password, setPassword] = useState('demo1234');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    if (!email || !password) { setError('Inserisci email e password'); return; }
    setLoading(true);
    try {
      await login(email.trim(), password);
      router.replace('/(tabs)');
    } catch (e: any) {
      setError(e.message || 'Accesso fallito');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root} testID="sign-in-screen">
      <Image source={{ uri: theme.images.stadium }} style={StyleSheet.absoluteFill} contentFit="cover" transition={300} />
      <LinearGradient
        colors={['rgba(13,15,18,0.55)', 'rgba(13,15,18,0.85)', theme.colors.surface]}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View style={styles.badge}>
              <Ionicons name="football" size={18} color={theme.colors.brandSecondary} />
              <Text style={styles.badgeText}>CAMPIONATO ITALIANO · 2025/26</Text>
            </View>
            <Text style={styles.title}>Fantacalcio{'\n'}Manager</Text>
            <Text style={styles.subtitle}>
              Il tuo comando strategico. Aste live, formazioni vincenti, gloria.
            </Text>
          </View>

          <BlurView intensity={30} tint="dark" style={styles.card}>
            <View style={styles.cardInner}>
              <Text style={styles.cardTitle}>Accedi</Text>

              <View style={styles.field}>
                <Ionicons name="mail-outline" size={18} color={theme.colors.onSurfaceSecondary} />
                <TextInput
                  testID="sign-in-email-input"
                  style={styles.input}
                  placeholder="Email"
                  placeholderTextColor={theme.colors.onSurfaceSecondary}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  value={email}
                  onChangeText={setEmail}
                />
              </View>

              <View style={styles.field}>
                <Ionicons name="lock-closed-outline" size={18} color={theme.colors.onSurfaceSecondary} />
                <TextInput
                  testID="sign-in-password-input"
                  style={styles.input}
                  placeholder="Password"
                  placeholderTextColor={theme.colors.onSurfaceSecondary}
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                />
              </View>

              {error ? <Text style={styles.error} testID="sign-in-error">{error}</Text> : null}

              <Pressable
                testID="sign-in-submit-button"
                style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
                onPress={onSubmit}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator color={theme.colors.onBrandSecondary} />
                  : <Text style={styles.ctaText}>Entra nella lega</Text>}
              </Pressable>

              <View style={styles.demoHint}>
                <Text style={styles.demoText}>Demo: demo@fanta.it · demo1234</Text>
              </View>

              <View style={styles.footerRow}>
                <Text style={styles.footerLabel}>Non hai un account?</Text>
                <Link href="/auth/sign-up" asChild>
                  <Pressable testID="go-to-sign-up-button" hitSlop={8}>
                    <Text style={styles.footerLink}>Registrati</Text>
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  scroll: { flexGrow: 1, justifyContent: 'space-between', paddingHorizontal: theme.spacing.lg, paddingTop: SH * 0.08, paddingBottom: theme.spacing.xl },
  header: { paddingHorizontal: theme.spacing.sm },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: 'rgba(212,175,55,0.12)',
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.35)',
  },
  badgeText: { color: theme.colors.brandSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
  title: { color: theme.colors.onSurface, fontSize: 44, lineHeight: 48, fontWeight: '800', marginTop: 16, letterSpacing: -1 },
  subtitle: { color: theme.colors.onSurfaceSecondary, fontSize: 15, lineHeight: 22, marginTop: 10, maxWidth: 320 },

  card: {
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginTop: theme.spacing.xxl,
  },
  cardInner: { padding: theme.spacing.lg, backgroundColor: 'rgba(13,15,18,0.55)' },
  cardTitle: { color: theme.colors.onSurface, fontSize: 20, fontWeight: '700', marginBottom: theme.spacing.md },
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
  cta: {
    marginTop: theme.spacing.md,
    backgroundColor: theme.colors.brandSecondary,
    borderRadius: theme.radius.md,
    paddingVertical: 15,
    alignItems: 'center',
  },
  ctaText: { color: theme.colors.onBrandSecondary, fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
  demoHint: { marginTop: 12, alignItems: 'center' },
  demoText: { color: theme.colors.onSurfaceSecondary, fontSize: 12 },
  footerRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: theme.spacing.md },
  footerLabel: { color: theme.colors.onSurfaceSecondary, fontSize: 14 },
  footerLink: { color: theme.colors.brandPrimary, fontSize: 14, fontWeight: '700' },
});
