import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Switch, TextInput, Pressable,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/lib/api';
import { theme } from '@/src/lib/theme';
import { useLeague } from '@/src/lib/league';

export default function Settings() {
  const router = useRouter();
  const { league } = useLeague();
  const [reg, setReg] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const load = useCallback(async () => {
    if (!league) return;
    const r = await api.regulations(league.id);
    setReg(r);
  }, [league]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!league || !reg) return;
    setSaving(true);
    try {
      const updated = await api.updateRegulations(league.id, reg);
      setReg(updated);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
    } finally { setSaving(false); }
  };

  if (!reg) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.center}><ActivityIndicator color={theme.colors.brandSecondary} /></View>
      </SafeAreaView>
    );
  }

  const num = (v: any) => (typeof v === 'number' ? v : parseFloat(v) || 0);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="settings-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="settings-back" hitSlop={8}>
          <Ionicons name="arrow-back" size={20} color={theme.colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Regolamento</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <Section icon="wallet-outline" title="Rosa & Budget">
            <NumberField testID="reg-budget" label="Budget totale" value={reg.total_budget}
              onChange={(v) => setReg({ ...reg, total_budget: num(v) })} />
            <View style={styles.rowSplit}>
              <NumberField testID="reg-p" label="Portieri" value={reg.roster_p}
                onChange={(v) => setReg({ ...reg, roster_p: num(v) })} />
              <NumberField testID="reg-d" label="Difensori" value={reg.roster_d}
                onChange={(v) => setReg({ ...reg, roster_d: num(v) })} />
            </View>
            <View style={styles.rowSplit}>
              <NumberField testID="reg-c" label="Centrocampisti" value={reg.roster_c}
                onChange={(v) => setReg({ ...reg, roster_c: num(v) })} />
              <NumberField testID="reg-a" label="Attaccanti" value={reg.roster_a}
                onChange={(v) => setReg({ ...reg, roster_a: num(v) })} />
            </View>
          </Section>

          <Section icon="shield-half-outline" title="Modificatori">
            <ToggleRow testID="reg-mod-def" label="Modificatore difesa" hint="Bonus se la media DIFENSORI ≥ 6"
              value={reg.defense_modifier}
              onChange={(v) => setReg({ ...reg, defense_modifier: v })} />
            <ToggleRow testID="reg-mod-mid" label="Modificatore centrocampo" hint="Bonus se la media CENTROCAMPISTI è alta"
              value={reg.midfield_modifier}
              onChange={(v) => setReg({ ...reg, midfield_modifier: v })} />
          </Section>

          <Section icon="trophy-outline" title="Bonus & Malus (Fantavoto)">
            <NumberField testID="reg-goal-a" label="Gol Attaccante" value={reg.goal_bonus_a}
              onChange={(v) => setReg({ ...reg, goal_bonus_a: num(v) })} />
            <NumberField testID="reg-goal-c" label="Gol Centrocampista" value={reg.goal_bonus_c}
              onChange={(v) => setReg({ ...reg, goal_bonus_c: num(v) })} />
            <NumberField testID="reg-goal-d" label="Gol Difensore" value={reg.goal_bonus_d}
              onChange={(v) => setReg({ ...reg, goal_bonus_d: num(v) })} />
            <NumberField testID="reg-assist" label="Assist" value={reg.assist_bonus}
              onChange={(v) => setReg({ ...reg, assist_bonus: num(v) })} />
            <NumberField testID="reg-yellow" label="Ammonizione" value={reg.yellow_card}
              onChange={(v) => setReg({ ...reg, yellow_card: num(v) })} />
            <NumberField testID="reg-red" label="Espulsione" value={reg.red_card}
              onChange={(v) => setReg({ ...reg, red_card: num(v) })} />
            <NumberField testID="reg-cs" label="Clean sheet portiere" value={reg.clean_sheet_p}
              onChange={(v) => setReg({ ...reg, clean_sheet_p: num(v) })} />
          </Section>
        </ScrollView>

        <View style={styles.footer}>
          {savedFlash && <Text style={styles.savedText}>Salvato ✓</Text>}
          <Pressable
            testID="save-regulations"
            style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.85 }]}
            onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color={theme.colors.onBrandSecondary} />
                    : <Text style={styles.saveBtnText}>Salva regolamento</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Section({ icon, title, children }: any) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <View style={styles.sectionIcon}>
          <Ionicons name={icon} size={16} color={theme.colors.brandSecondary} />
        </View>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function NumberField({ label, value, onChange, testID }: { label: string; value: any; onChange: (v: string) => void; testID?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        testID={testID}
        style={styles.numberInput}
        value={String(value)}
        onChangeText={onChange}
        keyboardType="numeric"
      />
    </View>
  );
}

function ToggleRow({ label, hint, value, onChange, testID }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; testID?: string }) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Switch
        testID={testID}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: theme.colors.brandPrimary, false: theme.colors.surfaceTertiary }}
        thumbColor={value ? '#fff' : theme.colors.onSurfaceSecondary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.surfaceSecondary, borderWidth: 1, borderColor: theme.colors.border },
  title: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '800' },

  section: { marginBottom: theme.spacing.xl },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: theme.spacing.md },
  sectionIcon: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(212,175,55,0.15)', borderWidth: 1, borderColor: 'rgba(212,175,55,0.3)' },
  sectionTitle: { color: theme.colors.onSurface, fontSize: 15, fontWeight: '700' },
  sectionBody: { backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' },

  field: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: theme.spacing.md, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  fieldLabel: { color: theme.colors.onSurface, fontSize: 14, fontWeight: '600' },
  hint: { color: theme.colors.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  numberInput: { minWidth: 70, textAlign: 'right', color: theme.colors.brandSecondary, fontSize: 16, fontWeight: '800',
    paddingHorizontal: 10, paddingVertical: 6, backgroundColor: theme.colors.surface, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border },
  rowSplit: { flexDirection: 'row' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.md, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: theme.colors.divider },

  footer: { position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: theme.spacing.lg, paddingBottom: theme.spacing.xl,
    backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.border },
  saveBtn: { backgroundColor: theme.colors.brandSecondary, paddingVertical: 15, borderRadius: theme.radius.md, alignItems: 'center' },
  saveBtnText: { color: theme.colors.onBrandSecondary, fontWeight: '800', fontSize: 15 },
  savedText: { color: theme.colors.success, textAlign: 'center', marginBottom: 8, fontSize: 12, fontWeight: '700' },
});
