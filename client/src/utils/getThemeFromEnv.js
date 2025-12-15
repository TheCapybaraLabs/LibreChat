/**
 * Loads theme configuration from environment variables
 * Supports both light and dark theme variants
 * @returns {{ light?: import('@librechat/client').IThemeRGB, dark?: import('@librechat/client').IThemeRGB } | undefined}
 */
export function getThemeFromEnv() {
  // Check if any theme environment variables are set
  const hasLightTheme = Object.keys(import.meta.env).some((key) =>
    key.startsWith('VITE_THEME_LIGHT_'),
  );
  const hasDarkTheme = Object.keys(import.meta.env).some((key) =>
    key.startsWith('VITE_THEME_DARK_'),
  );

  if (!hasLightTheme && !hasDarkTheme) {
    return undefined; // Use default themes
  }

  const result = {};

  // Helper to build theme from environment variables
  const buildTheme = (prefix) => {
    const theme = {};
    const getEnv = (key) => import.meta.env[`VITE_THEME_${prefix}_${key}`];

    // Text colors
    if (getEnv('TEXT_PRIMARY')) theme['rgb-text-primary'] = getEnv('TEXT_PRIMARY');
    if (getEnv('TEXT_SECONDARY')) theme['rgb-text-secondary'] = getEnv('TEXT_SECONDARY');
    if (getEnv('TEXT_SECONDARY_ALT')) theme['rgb-text-secondary-alt'] = getEnv('TEXT_SECONDARY_ALT');
    if (getEnv('TEXT_TERTIARY')) theme['rgb-text-tertiary'] = getEnv('TEXT_TERTIARY');
    if (getEnv('TEXT_WARNING')) theme['rgb-text-warning'] = getEnv('TEXT_WARNING');

    // Ring colors
    if (getEnv('RING_PRIMARY')) theme['rgb-ring-primary'] = getEnv('RING_PRIMARY');

    // Header colors
    if (getEnv('HEADER_PRIMARY')) theme['rgb-header-primary'] = getEnv('HEADER_PRIMARY');
    if (getEnv('HEADER_HOVER')) theme['rgb-header-hover'] = getEnv('HEADER_HOVER');
    if (getEnv('HEADER_BUTTON_HOVER')) theme['rgb-header-button-hover'] = getEnv('HEADER_BUTTON_HOVER');

    // Surface colors
    if (getEnv('SURFACE_ACTIVE')) theme['rgb-surface-active'] = getEnv('SURFACE_ACTIVE');
    if (getEnv('SURFACE_ACTIVE_ALT')) theme['rgb-surface-active-alt'] = getEnv('SURFACE_ACTIVE_ALT');
    if (getEnv('SURFACE_HOVER')) theme['rgb-surface-hover'] = getEnv('SURFACE_HOVER');
    if (getEnv('SURFACE_HOVER_ALT')) theme['rgb-surface-hover-alt'] = getEnv('SURFACE_HOVER_ALT');
    if (getEnv('SURFACE_PRIMARY')) theme['rgb-surface-primary'] = getEnv('SURFACE_PRIMARY');
    if (getEnv('SURFACE_PRIMARY_ALT')) theme['rgb-surface-primary-alt'] = getEnv('SURFACE_PRIMARY_ALT');
    if (getEnv('SURFACE_PRIMARY_CONTRAST')) theme['rgb-surface-primary-contrast'] = getEnv('SURFACE_PRIMARY_CONTRAST');
    if (getEnv('SURFACE_SECONDARY')) theme['rgb-surface-secondary'] = getEnv('SURFACE_SECONDARY');
    if (getEnv('SURFACE_SECONDARY_ALT')) theme['rgb-surface-secondary-alt'] = getEnv('SURFACE_SECONDARY_ALT');
    if (getEnv('SURFACE_TERTIARY')) theme['rgb-surface-tertiary'] = getEnv('SURFACE_TERTIARY');
    if (getEnv('SURFACE_TERTIARY_ALT')) theme['rgb-surface-tertiary-alt'] = getEnv('SURFACE_TERTIARY_ALT');
    if (getEnv('SURFACE_DIALOG')) theme['rgb-surface-dialog'] = getEnv('SURFACE_DIALOG');
    if (getEnv('SURFACE_SUBMIT')) theme['rgb-surface-submit'] = getEnv('SURFACE_SUBMIT');
    if (getEnv('SURFACE_SUBMIT_HOVER')) theme['rgb-surface-submit-hover'] = getEnv('SURFACE_SUBMIT_HOVER');
    if (getEnv('SURFACE_DESTRUCTIVE')) theme['rgb-surface-destructive'] = getEnv('SURFACE_DESTRUCTIVE');
    if (getEnv('SURFACE_DESTRUCTIVE_HOVER')) theme['rgb-surface-destructive-hover'] = getEnv('SURFACE_DESTRUCTIVE_HOVER');
    if (getEnv('SURFACE_CHAT')) theme['rgb-surface-chat'] = getEnv('SURFACE_CHAT');

    // Border colors
    if (getEnv('BORDER_LIGHT')) theme['rgb-border-light'] = getEnv('BORDER_LIGHT');
    if (getEnv('BORDER_MEDIUM')) theme['rgb-border-medium'] = getEnv('BORDER_MEDIUM');
    if (getEnv('BORDER_MEDIUM_ALT')) theme['rgb-border-medium-alt'] = getEnv('BORDER_MEDIUM_ALT');
    if (getEnv('BORDER_HEAVY')) theme['rgb-border-heavy'] = getEnv('BORDER_HEAVY');
    if (getEnv('BORDER_XHEAVY')) theme['rgb-border-xheavy'] = getEnv('BORDER_XHEAVY');

    // Brand colors
    if (getEnv('BRAND_PURPLE')) theme['rgb-brand-purple'] = getEnv('BRAND_PURPLE');
    if (getEnv('BRAND_BORDER')) theme['rgb-brand-border'] = getEnv('BRAND_BORDER');
    if (getEnv('BRAND_FOOTER')) theme['rgb-brand-footer'] = getEnv('BRAND_FOOTER');
    if (getEnv('BRAND_PRIMARY')) theme['rgb-brand-primary'] = getEnv('BRAND_PRIMARY');
    if (getEnv('BRAND_PRIMARY_HOVER')) theme['rgb-brand-primary-hover'] = getEnv('BRAND_PRIMARY_HOVER');

    // Presentation
    if (getEnv('PRESENTATION')) theme['rgb-presentation'] = getEnv('PRESENTATION');

    // Utility colors (HSL format for shadcn/ui compatibility)
    if (getEnv('BACKGROUND')) theme['rgb-background'] = getEnv('BACKGROUND');
    if (getEnv('FOREGROUND')) theme['rgb-foreground'] = getEnv('FOREGROUND');
    if (getEnv('PRIMARY')) theme['rgb-primary'] = getEnv('PRIMARY');
    if (getEnv('PRIMARY_FOREGROUND')) theme['rgb-primary-foreground'] = getEnv('PRIMARY_FOREGROUND');
    if (getEnv('SECONDARY')) theme['rgb-secondary'] = getEnv('SECONDARY');
    if (getEnv('SECONDARY_FOREGROUND')) theme['rgb-secondary-foreground'] = getEnv('SECONDARY_FOREGROUND');
    if (getEnv('MUTED')) theme['rgb-muted'] = getEnv('MUTED');
    if (getEnv('MUTED_FOREGROUND')) theme['rgb-muted-foreground'] = getEnv('MUTED_FOREGROUND');
    if (getEnv('ACCENT')) theme['rgb-accent'] = getEnv('ACCENT');
    if (getEnv('ACCENT_FOREGROUND')) theme['rgb-accent-foreground'] = getEnv('ACCENT_FOREGROUND');
    if (getEnv('DESTRUCTIVE_FOREGROUND')) theme['rgb-destructive-foreground'] = getEnv('DESTRUCTIVE_FOREGROUND');
    if (getEnv('BORDER')) theme['rgb-border'] = getEnv('BORDER');
    if (getEnv('INPUT')) theme['rgb-input'] = getEnv('INPUT');
    if (getEnv('RING')) theme['rgb-ring'] = getEnv('RING');
    if (getEnv('CARD')) theme['rgb-card'] = getEnv('CARD');
    if (getEnv('CARD_FOREGROUND')) theme['rgb-card-foreground'] = getEnv('CARD_FOREGROUND');

    return Object.keys(theme).length > 0 ? theme : undefined;
  };

  // Build light and dark themes
  if (hasLightTheme) {
    result.light = buildTheme('LIGHT');
  }
  if (hasDarkTheme) {
    result.dark = buildTheme('DARK');
  }

  return Object.keys(result).length > 0 ? result : undefined;
}
