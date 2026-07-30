/**
 * Dark status-bar icons for the light-background onboarding screens.
 *
 * App.tsx mounts `<StatusBar style="light" />` as the app-wide base (white clock /
 * signal / wifi / battery), which is right for the dark screens (pre-auth
 * WelcomeScreen's video, the main app) but invisible on onboarding's near-white
 * backgrounds — step 0's pastel sky and steps 1–7's #FAFAFA. iOS HIG: dark content
 * on a light bar.
 *
 * This works because RN's StatusBar keeps a STACK of mounted entries and the last
 * one pushed wins. The root entry is rendered before <AppContent /> in App.tsx, so
 * it mounts first and anything a screen mounts later overrides it — and unmounting
 * this component pops the entry, restoring the light default automatically.
 *
 * iOS only for now: on Android the root bar is translucent under edge-to-edge and
 * has never been styled per screen, so leave it as-is (swap the ternary to a bare
 * "dark" if we want the same treatment there).
 */
import React from 'react';
import { Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';

export const OnboardingStatusBar: React.FC = () => (
  <StatusBar style={Platform.OS === 'ios' ? 'dark' : 'light'} />
);
