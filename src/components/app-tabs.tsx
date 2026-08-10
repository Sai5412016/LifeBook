import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}>
      {/*
        Füttern is the start screen (route "index") and the first tab —
        needed ten times a day, against the Chronik's few times a week, so it
        gets the position and the app-launch slot that used to belong to the
        photo timeline.
      */}
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Füttern</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="waterbottle.fill" md="water_bottle" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="chronik">
        <NativeTabs.Trigger.Label>Chronik</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/home.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="explore">
        <NativeTabs.Trigger.Label>Einstellungen</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/explore.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
