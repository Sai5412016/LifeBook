import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';
import { useActiveChild } from '@/features/household/repository';

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];
  const { child } = useActiveChild();

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}>
      {/*
        The child's own profile ("Marina" in the design brief — the tab
        label shows the REAL name from the data, never that literal string)
        is the start screen (route "index") and the first tab: settings
        moved here too, reachable via a gear icon on the screen itself
        (src/app/(tabs)/index.tsx), no longer a tab of their own.
      */}
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>{child?.firstName ?? 'Start'}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.crop.circle.fill" md="account_circle" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="chronik">
        <NativeTabs.Trigger.Label>Chronik</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/home.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      {/* 2026-08-22: besondere Momente mit Titel, Datum, Text und Fotos — zwischen Chronik und Alltag, siehe features/events. */}
      <NativeTabs.Trigger name="ereignisse">
        <NativeTabs.Trigger.Label>Ereignisse</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="star.fill" md="star" />
      </NativeTabs.Trigger>

      {/* Formerly "Heute" at route "index" — moved here verbatim (Füttern/Wickeln/Schlafen unchanged) when tab 1 became the child profile. */}
      <NativeTabs.Trigger name="alltag">
        <NativeTabs.Trigger.Label>Alltag</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="waterbottle.fill" md="water_bottle" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
