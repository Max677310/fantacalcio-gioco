export const theme = {
  colors: {
    surface: '#0D0F12',
    onSurface: '#F2F4F7',
    surfaceSecondary: '#1A1D24',
    onSurfaceSecondary: '#9CA3AF',
    surfaceTertiary: '#2A2E39',
    onSurfaceTertiary: '#D1D5DB',
    brand: '#0A5C36',
    brandPrimary: '#10B981',
    onBrandPrimary: '#000000',
    brandSecondary: '#D4AF37',
    onBrandSecondary: '#000000',
    brandTertiary: '#064E3B',
    onBrandTertiary: '#A7F3D0',
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    info: '#3B82F6',
    border: '#2A2E39',
    borderStrong: '#4B5563',
    divider: '#1F2937',
    pitch: '#0A4A2A',
    pitchLine: 'rgba(255,255,255,0.35)',
    glass: 'rgba(26, 29, 36, 0.72)',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: { sm: 6, md: 12, lg: 20, pill: 999 },
  font: {
    sizes: { xs: 11, sm: 12, base: 14, lg: 16, xl: 20, xxl: 24, xxxl: 32, display: 40 },
    weight: { regular: '400', medium: '500', semibold: '600', bold: '700', extra: '800' } as const,
  },
  images: {
    stadium: 'https://images.pexels.com/photos/15867405/pexels-photo-15867405.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940',
    player:  'https://images.unsplash.com/photo-1584462746497-276f4aeb9fca?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMzV8MHwxfHNlYXJjaHwxfHxzb2NjZXIlMjBwbGF5ZXIlMjBzaWxob3VldHRlJTIwcG9ydHJhaXQlMjBkYXJrfGVufDB8fHx8MTc4Nzc0ODY2NHww&ixlib=rb-4.1.0&q=85',
    ball:    'https://images.pexels.com/photos/16826135/pexels-photo-16826135.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940',
    trophy:  'https://images.pexels.com/photos/6532380/pexels-photo-6532380.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940',
  },
};

export const roleLabels: Record<string, string> = {
  P: 'Portiere',
  D: 'Difensore',
  C: 'Centrocampista',
  A: 'Attaccante',
};

export const roleColors: Record<string, string> = {
  P: '#F59E0B',
  D: '#3B82F6',
  C: '#10B981',
  A: '#EF4444',
};
