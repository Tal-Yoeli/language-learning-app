import { useWindowDimensions } from 'react-native';

import { resolveLayout, type ResponsiveLayout } from './breakpoints';

export { BREAKPOINTS, columnStyle, resolveLayout } from './breakpoints';
export type { ResponsiveLayout } from './breakpoints';

/**
 * `useWindowDimensions` re-renders on resize and orientation change, so the
 * same breakpoint rules drive browser resizing and native tablet rotation.
 */
export function useResponsiveLayout(): ResponsiveLayout {
  const { width } = useWindowDimensions();
  return resolveLayout(width);
}
