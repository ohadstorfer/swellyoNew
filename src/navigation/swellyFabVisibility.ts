import { Easing, makeMutable, withTiming } from 'react-native-reanimated';

/**
 * Opacity of the floating Swelly avatar (and its "Tap to get started" hint),
 * as a Reanimated shared value rather than React state.
 *
 * Why not just unmount it on tab change: `@bottom-tabs` emits `tabPress` and
 * then dispatches the navigate action inside the *same* JS event handler, so
 * React batches any state write together with the navigation render. The
 * avatar's unmount therefore commits only after the incoming tab has rendered —
 * on the Trips tab that's the whole Explore feed, which is long enough that the
 * avatar sat on top of it for the entire cross-fade.
 *
 * Writing a shared value hands the change straight to the UI runtime, so the
 * fade starts on the next frame no matter how busy the JS thread gets
 * afterwards. React still owns *mounting* (see HomeTabsExtras) — that can lag
 * safely, because by then the view is already invisible.
 */
export const swellyFabOpacity = makeMutable(0);

/** Fade out now — call from the tab-press handler, before navigation work. */
export const hideSwellyFabNow = () => {
  swellyFabOpacity.value = withTiming(0, { duration: 110, easing: Easing.out(Easing.quad) });
};

export const showSwellyFab = () => {
  swellyFabOpacity.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) });
};
