---
name: tanstack-query-v5-react-native
description: TanStack Query v5 compatibility, RN-specific setup, cache behavior on unmount/remount, gotchas for React Native 0.81 / Expo 54 / React 19
metadata:
  type: reference
---

## Version
- Latest stable: 5.101.0 (as of June 2026, ships continuously)
- peerDependencies: `"react": "^18 || ^19"` — fully supports React 19
- Pure JS, no native modules — works in Expo Go without a native build

## React Native Required Setup

### focusManager (required for refetch-on-app-focus)
`refetchOnWindowFocus` is a no-op in RN by default — no "window" event. Must wire AppState manually:
```tsx
import { AppState, Platform } from 'react-native'
import { focusManager } from '@tanstack/react-query'

function onAppStateChange(status: string) {
  if (Platform.OS !== 'web') {
    focusManager.setFocused(status === 'active')
  }
}
// in a root useEffect:
AppState.addEventListener('change', onAppStateChange)
```

### onlineManager (optional but strongly recommended for mobile)
Without it, queries won't automatically re-run after regaining connectivity. `@react-native-community/netinfo` is the standard — it IS a native module, NOT available in Expo Go. On Expo, use `expo-network` instead, or just skip it for now if offline support is not critical.
```tsx
import NetInfo from '@react-native-community/netinfo'
import { onlineManager } from '@tanstack/react-query'
onlineManager.setEventListener((setOnline) => {
  return NetInfo.addEventListener((state) => {
    setOnline(!!state.isConnected)
  })
})
```

## Recommended QueryClient Defaults for RN
```ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,     // 5 min — prevents refetch storm on re-mount
      gcTime: 1000 * 60 * 30,        // 30 min — keep cache alive across unmounts
      retry: 2,
      refetchOnWindowFocus: false,    // no-op in RN; disable to be explicit
      refetchOnReconnect: true,       // important for mobile
    },
  },
})
```

## Cache Behavior on Unmount/Remount
- Cache lives in QueryClient, NOT the component. Survives full component unmount.
- On remount: returns cached data immediately (isLoading=false, data=cached), then triggers background refetch ONLY if data is stale per staleTime.
- gcTime controls how long unused cache entries live after all subscribers unmount. Default = 5 min.
- gcTime must be >= staleTime. Otherwise cache may be GC'd before staleTime expires.

## Key Gotchas
1. **staleTime defaults to 0** — every mount triggers a background refetch. With no staleTime set, boolean-toggled screens that unmount/remount will refetch every time. Always set staleTime explicitly.
2. **refetchOnWindowFocus is TRUE by default** — in RN it's a no-op but wastes mental overhead. Explicitly set to false.
3. **NetInfo = native module** — `@react-native-community/netinfo` does NOT work in Expo Go. For Expo Go testing, either skip onlineManager setup or gate it with `Constants.appOwnership !== 'expo'`.
4. **Query keys must be arrays** — in v5 the object form was removed. Always use `['key', param]` syntax.
5. **`enabled: !!param`** — forgetting this on dependent queries causes fetch with undefined params.
6. **DevTools don't work in RN** — `@tanstack/react-query-devtools` is web-only. Debug via `QueryCache.subscribe()` or a custom dev panel.
7. **Over-invalidation** — don't call `queryClient.invalidateQueries()` with no args (invalidates everything). Target by key prefix.
8. **QueryClientProvider must wrap all useQuery callers** — place at root of app tree, above navigation and auth providers (or at least above any component that calls useQuery). No specific ordering constraint vs other providers, just must be an ancestor.
9. **gcTime > staleTime** — if gcTime < staleTime, data will be GC'd while still "fresh," defeating the cache. Keep gcTime significantly higher.
10. **Persisting errors** — if using AsyncStorage persistence, filter to `status === 'success'` only. Persisting error states causes stale error screens on cold boot.

## Bundle Size
~12-16 KB gzipped total for typical usage (useQuery + QueryClient + QueryClientProvider + useQueryClient).

## Expo Go Compatibility
Pure JS — works in Expo Go. Exception: `@react-native-community/netinfo` for onlineManager is a native module and will crash in Expo Go. Gate it or swap for `expo-network`.
