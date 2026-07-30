import type { LucideIcon } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ResponsiveLayout } from './useResponsiveLayout';

/**
 * react-native-web adds `hovered` to the Pressable style callback, but the
 * React Native types do not describe it. Reading it through this type keeps
 * pointer affordances on desktop without an `any`.
 */
type PressableVisualState = { pressed: boolean; hovered?: boolean };

export type NavItem<TScreen extends string> = {
  key: TScreen;
  label: string;
  icon: LucideIcon;
  /** Longer description, shown only in the desktop sidebar. */
  hint: string;
};

/**
 * Chrome around the four screens. On a phone this is the original layout: a
 * status-bar spacer, the notice bar, the screen, and a bottom tab bar. From
 * 1024px the tab bar becomes a persistent sidebar and the content column is
 * capped, so a desktop browser does not render one stretched phone column.
 */
export default function AppShell<TScreen extends string>({
  activeScreen,
  children,
  items,
  layout,
  notice,
  onSelect,
  subtitle,
  title,
}: {
  activeScreen: TScreen;
  children: ReactNode;
  items: Array<NavItem<TScreen>>;
  layout: ResponsiveLayout;
  notice: string;
  onSelect: (screen: TScreen) => void;
  subtitle: string;
  title: string;
}) {
  // The centred variant must not combine `width: 100%` with horizontal margins:
  // flex items default to `min-width: auto`, so an over-wide child stretches the
  // whole root and clips every screen, tab bar included.
  const centred = !layout.isPhone;
  const noticeBar = (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[
        styles.noticeBar,
        centred
          ? [styles.noticeBarCentred, { maxWidth: layout.contentMaxWidth }]
          : styles.noticeBarFlush,
      ]}
    >
      <Text style={styles.noticeText}>{notice}</Text>
    </View>
  );

  if (layout.usesSideNav) {
    return (
      <View style={styles.desktopOuter}>
      <View style={styles.desktopRoot}>
        <View role="navigation" style={styles.sidebar}>
          <View style={styles.brand}>
            <Text style={styles.brandTitle}>{title}</Text>
            <Text style={styles.brandSubtitle}>{subtitle}</Text>
          </View>
          <View style={styles.sidebarNav}>
            {items.map((item) => (
              <SidebarButton
                active={item.key === activeScreen}
                item={item}
                key={item.key}
                onPress={() => onSelect(item.key)}
              />
            ))}
          </View>
        </View>
        <View style={styles.desktopMain}>
          <View style={styles.desktopNoticeSlot}>{noticeBar}</View>
          <View style={styles.desktopContent}>{children}</View>
        </View>
      </View>
      </View>
    );
  }

  return (
    <View style={styles.compactRoot}>
      <View style={styles.safeTop} />
      <View
        style={centred ? styles.centredNoticeSlot : styles.compactNoticeSlot}
      >
        {noticeBar}
      </View>
      <View style={styles.content}>{children}</View>
      <View role="tablist" style={styles.tabBar}>
        {items.map((item) => (
          <TabButton
            active={item.key === activeScreen}
            item={item}
            key={item.key}
            onPress={() => onSelect(item.key)}
          />
        ))}
      </View>
    </View>
  );
}

function SidebarButton<TScreen extends string>({
  active,
  item,
  onPress,
}: {
  active: boolean;
  item: NavItem<TScreen>;
  onPress: () => void;
}) {
  const Icon = item.icon;

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={(state) => {
        const { hovered, pressed } = state as PressableVisualState;

        return [
          styles.sidebarButton,
          active && styles.sidebarButtonActive,
          hovered && !active && styles.sidebarButtonHovered,
          pressed && styles.pressed,
        ];
      }}
    >
      <Icon
        color={active ? '#FFFFFF' : '#52606D'}
        size={20}
        strokeWidth={active ? 2.5 : 2.1}
      />
      <View style={styles.sidebarCopy}>
        <Text
          style={[styles.sidebarLabel, active && styles.sidebarLabelActive]}
        >
          {item.label}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.sidebarHint, active && styles.sidebarHintActive]}
        >
          {item.hint}
        </Text>
      </View>
    </Pressable>
  );
}

function TabButton<TScreen extends string>({
  active,
  item,
  onPress,
}: {
  active: boolean;
  item: NavItem<TScreen>;
  onPress: () => void;
}) {
  const Icon = item.icon;

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      style={(state) => {
        const { hovered, pressed } = state as PressableVisualState;

        return [
          styles.tabButton,
          active && styles.tabButtonActive,
          hovered && !active && styles.tabButtonHovered,
          pressed && styles.pressed,
        ];
      }}
    >
      <Icon
        color={active ? '#FFFFFF' : '#52606D'}
        size={20}
        strokeWidth={active ? 2.5 : 2.1}
      />
      <Text style={[styles.tabText, active && styles.tabTextActive]}>
        {item.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  compactRoot: { flex: 1, backgroundColor: '#F6F5F1' },
  // The browser has no notch to clear; the native spacer is unchanged.
  safeTop: {
    height: Platform.select({ ios: 54, web: 12, default: 28 }),
  },
  content: { flex: 1 },
  compactNoticeSlot: { alignItems: 'stretch' },
  centredNoticeSlot: { alignItems: 'center', paddingHorizontal: 16 },
  noticeBar: {
    marginBottom: 8,
    borderRadius: 8,
    backgroundColor: '#E7F0EA',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  // Phone: stretched by the parent, inset by margins. Exactly as before.
  noticeBarFlush: { marginHorizontal: 16 },
  // Tablet/desktop: centred by the slot, so it needs an explicit width.
  noticeBarCentred: { width: '100%' },
  noticeText: { color: '#315C45', fontSize: 13, lineHeight: 18 },

  // On an ultra-wide monitor, centring only the text column leaves the sidebar
  // stranded at the far edge. Capping and centring the whole shell keeps the
  // navigation and the content visually related.
  desktopOuter: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#F6F5F1',
  },
  desktopRoot: {
    flex: 1,
    width: '100%',
    maxWidth: 1400,
    flexDirection: 'row',
    backgroundColor: '#F6F5F1',
  },
  sidebar: {
    width: 252,
    borderRightColor: '#E4DED4',
    borderRightWidth: 1,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 24,
    gap: 24,
  },
  brand: { gap: 4 },
  brandTitle: { color: '#17212B', fontSize: 19, fontWeight: '900' },
  brandSubtitle: { color: '#79838C', fontSize: 12, fontWeight: '700' },
  sidebarNav: { gap: 6 },
  sidebarButton: {
    minHeight: 52,
    alignItems: 'center',
    flexDirection: 'row',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 12,
  },
  sidebarButtonActive: { backgroundColor: '#17212B' },
  sidebarButtonHovered: { backgroundColor: '#EFEDE7' },
  sidebarCopy: { flex: 1 },
  sidebarLabel: { color: '#38424C', fontSize: 14, fontWeight: '800' },
  sidebarLabelActive: { color: '#FFFFFF' },
  sidebarHint: { color: '#79838C', fontSize: 11, fontWeight: '600' },
  sidebarHintActive: { color: '#B7C0C9' },
  desktopMain: { flex: 1 },
  desktopNoticeSlot: {
    alignItems: 'center',
    paddingTop: 20,
    paddingHorizontal: 16,
  },
  desktopContent: { flex: 1 },

  // Values below are carried over verbatim from the original tab bar so the
  // phone layout is visually identical to the iPhone build.
  tabBar: {
    flexDirection: 'row',
    borderTopColor: '#DEDBD3',
    borderTopWidth: 1,
    backgroundColor: '#FFFFFF',
    paddingBottom: Platform.select({ ios: 24, web: 11, default: 11 }),
    paddingHorizontal: 9,
    paddingTop: 9,
    gap: 7,
  },
  tabButton: {
    flex: 1,
    minHeight: 50,
    alignItems: 'center',
    borderRadius: 8,
    gap: 3,
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  tabButtonActive: { backgroundColor: '#17212B' },
  tabButtonHovered: { backgroundColor: '#EFEDE7' },
  tabText: {
    color: '#52606D',
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
  },
  tabTextActive: { color: '#FFFFFF' },
  pressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
});
