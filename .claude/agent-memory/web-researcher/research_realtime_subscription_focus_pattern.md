---
name: realtime-subscription-focus-pattern
description: Card-stack nav + Supabase Realtime: subscribe-on-focus/unsubscribe-on-blur pattern validation, freezeOnBlur mechanics, Supabase channel limits, TanStack subscribed prop, industry architecture
metadata:
  type: reference
---

# Card-Stack Navigation + Realtime Subscriptions — Full Research Brief

## Verdict
The proposed fix (useFocusEffect to subscribe/unsubscribe Supabase channels as screens gain/lose focus) is the officially documented and community-validated pattern. YES — it matches industry best practice.

## Key Sources
- React Navigation useFocusEffect docs: https://reactnavigation.org/docs/use-focus-effect/
- React Navigation focus guide: https://reactnavigation.org/docs/function-after-focusing-screen/
- Supabase Realtime limits: https://supabase.com/docs/guides/realtime/limits
- TanStack Query React Native: https://tanstack.com/query/v5/docs/framework/react/react-native
- React Navigation v8 inactiveBehavior: https://reactnavigation.org/blog/2026/03/10/react-navigation-8.0-march-progress/
- Software Mansion react-freeze blog: https://swmansion.com/blog/experimenting-with-react-freeze-71da578e2fa6
- Supabase realtime production lessons: https://www.agilesoftlabs.com/blog/2026/05/supabase-realtime-in-production-what
- TanStack query #6002 discussion: https://github.com/TanStack/query/discussions/6002

## freezeOnBlur — what it does and doesn't do
- freezeOnBlur=true (react-freeze) halts RENDERING only — timers, websockets, and useEffect subscriptions continue running in the background
- Source: Software Mansion blog: "prevent[s] parts of the react component tree from rendering while keeping its state untouched"
- This means: freezeOnBlur alone does NOT solve the multi-channel problem. Channels stay open, events still fire, invalidations still queue.
- Known bugs: doesn't work with animated tab transitions (shift type), and causes media to freeze mid-play

## Supabase Realtime limits (hard numbers)
- Channels per connection: 100 (all plans except Enterprise)
- Concurrent connections: 200 (Free), 500 (Pro), 10,000 (Team/Enterprise)
- Messages per second: 100 (Free), 500 (Pro)
- One WebSocket connection per Supabase client instance — all channels share it (Phoenix Channels multiplexed)
- Known removeChannel() race condition bug (supabase-js #1612): if called before subscribe handshake completes, can remove ALL channels instead of just one

## React Navigation official guidance on subscriptions
- useFocusEffect is THE documented pattern for subscriptions tied to screen visibility
- Official example literally shows: const unsubscribe = API.subscribe(userId, onUpdate); return () => unsubscribe();
- Official quote: "useful for cases such as adding event listeners, for fetching data with an API call when a screen becomes focused, or any other action that needs to happen once the screen comes into view"
- useIsFocused is explicitly warned against for subscriptions: "only use if you need to trigger a re-render; for subscriptions use useFocusEffect"
- Cleanup function = runs on blur AND unmount — handles both cases

## TanStack Query v5 — subscribed prop
- Official API: useQuery({ queryKey, queryFn, subscribed: isFocused })
- When subscribed=false, the useQuery instance is not subscribed to cache updates
- The official RN docs literally show: const isFocused = useIsFocused(); useQuery({ subscribed: isFocused })
- Also: useRefreshOnFocus() custom hook pattern — refetchQueries({ stale: true, type: 'active' }) on focus, skip first mount via ref

## React Navigation v8 inactiveBehavior (coming soon)
- New option: inactiveBehavior="pause" = screens stay rendered, BUT effects are cleaned up via React.Activity
- Quote: "Any subscriptions, timers etc. are cleaned up for paused screens"
- This is the React Navigation team's OFFICIAL acknowledgment that the current detachInactiveScreens=false + no focus management = broken pattern
- Not yet in v7 (current) — this is a forward-looking signal that the team agrees the fix belongs at the effect level

## Industry architecture (Slack/Discord/WhatsApp)
- No published React Native specifics on per-screen vs global for these apps
- Slack: one WebSocket per session, routes messages to Channel Servers via consistent hash — client subscribes to specific channel IDs via the gateway, not per-screen
- Principle: "only what's visible gets live updates" is the consensus even if implementation varies
- The "global subscription manager with reference counting" is a viable alternative but adds significant complexity

## Supabase-specific best practices
- removeChannel(channel) on EVERY navigation away that opened a channel — "zombie channels are #1 cause of hitting connection limits"
- Leaked channels auto-timeout 30s after disconnect, but accumulate during navigation
- Use server-side filter: parameter in Postgres Changes to reduce WAL load
- removeAllChannels() disconnects the WebSocket entirely — use only at logout/app background

## Swellyo-specific context
- useTripRealtime and useTripsListRealtime both use useEffect + removeChannel in cleanup
- Both are called from screens that can be in mounted-but-unfocused state under card-stack navigation
- The fix: change useEffect to useFocusEffect in both hooks
- TripDetailScreen calls useTripRealtime(tripId) at line 381 — this is the primary target
- TripsScreen calls useTripsListRealtime() at line 1042 — secondary target
- RootNavigator has detachInactiveScreens={false} at line 389 — this is intentional for instant-back UX, not a bug

**How to apply:** When implementing the fix, use useFocusEffect in place of useEffect in both realtime hooks. Add a refetch after resubscribe (invalidateQueries on the key) to catch missed events during blur. Add 50-100ms debounce before re-subscribing to prevent subscribe/unsubscribe churn on rapid navigation. Watch the removeChannel() race condition — check channel.state before calling removeChannel, or add a small delay.
