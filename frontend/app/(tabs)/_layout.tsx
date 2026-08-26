import { Tabs, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { useAuth } from '@/src/lib/auth';
import { useLeague } from '@/src/lib/league';
import { theme } from '@/src/lib/theme';

export default function TabsLayout() {
  const { user, loading } = useAuth();
  const { league, loading: leagueLoading } = useLeague();
  const router = useRouter();

  useEffect(() => {
    if (loading || leagueLoading) return;
    if (!user) { router.replace('/auth/sign-in'); return; }
    if (!league) { router.replace('/onboarding'); return; }
  }, [user, loading, league, leagueLoading, router]);

  if (loading || leagueLoading || !user || !league) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.brandSecondary} />
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.brandSecondary,
        tabBarInactiveTintColor: theme.colors.onSurfaceSecondary,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
        sceneStyle: { backgroundColor: theme.colors.surface },
      }}
    >
      <Tabs.Screen name="index" options={{
        title: 'Dashboard',
        tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size ?? 22} color={color} />,
        tabBarButtonTestID: 'tab-dashboard',
      }} />
      <Tabs.Screen name="auction" options={{
        title: 'Asta',
        tabBarIcon: ({ color, size }) => (
          <View>
            <Ionicons name="flame" size={size ?? 22} color={color} />
            <View style={styles.liveDot} />
          </View>
        ),
        tabBarButtonTestID: 'tab-auction',
      }} />
      <Tabs.Screen name="lineup" options={{
        title: 'Formazione',
        tabBarIcon: ({ color, size }) => <Ionicons name="football" size={size ?? 22} color={color} />,
        tabBarButtonTestID: 'tab-lineup',
      }} />
      <Tabs.Screen name="standings" options={{
        title: 'Classifica',
        tabBarIcon: ({ color, size }) => <Ionicons name="trophy" size={size ?? 22} color={color} />,
        tabBarButtonTestID: 'tab-standings',
      }} />
      <Tabs.Screen name="league" options={{
        title: 'Lega',
        tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size ?? 22} color={color} />,
        tabBarButtonTestID: 'tab-league',
      }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderTopColor: theme.colors.border,
    height: 66,
    paddingTop: 6,
    paddingBottom: 10,
  },
  tabLabel: { fontSize: 10, fontWeight: '600' },
  liveDot: {
    position: 'absolute', top: -2, right: -3,
    width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.error,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
});
