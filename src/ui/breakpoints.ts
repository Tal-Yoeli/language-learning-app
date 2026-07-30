// Pure layout rules, deliberately free of react-native imports so they can be
// unit tested with node:test the same way src/lib/learning.ts is.

export const BREAKPOINTS = {
  tablet: 768,
  desktop: 1024,
} as const;

export type ResponsiveLayout = {
  width: number;
  isPhone: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  /** Side navigation replaces the bottom tab bar once there is room for it. */
  usesSideNav: boolean;
  /** Reading measure for the main column, so wide screens do not stretch text. */
  contentMaxWidth: number;
  /** Narrower measure for one-question-at-a-time lesson screens. */
  focusMaxWidth: number;
  /** Cards per row in the deck grid. */
  deckColumns: number;
  /** The dashboard splits into two columns when there is room. */
  splitDashboard: boolean;
};

export function resolveLayout(width: number): ResponsiveLayout {
  const isDesktop = width >= BREAKPOINTS.desktop;
  const isTablet = !isDesktop && width >= BREAKPOINTS.tablet;

  return {
    width,
    isPhone: !isDesktop && !isTablet,
    isTablet,
    isDesktop,
    usesSideNav: isDesktop,
    contentMaxWidth: isDesktop ? 860 : isTablet ? 720 : Number.POSITIVE_INFINITY,
    focusMaxWidth: isDesktop ? 640 : isTablet ? 620 : Number.POSITIVE_INFINITY,
    deckColumns: isDesktop ? 3 : isTablet ? 3 : 2,
    // Two columns need real width; 1200px is where the split stops feeling cramped.
    splitDashboard: width >= 1200,
  };
}

/**
 * Centres a scroll column and caps its measure. `maxWidth` is omitted entirely
 * on phones so the existing full-bleed layout is unchanged.
 */
export function columnStyle(maxWidth: number) {
  return {
    width: '100%' as const,
    alignSelf: 'center' as const,
    maxWidth: Number.isFinite(maxWidth) ? maxWidth : undefined,
  };
}
