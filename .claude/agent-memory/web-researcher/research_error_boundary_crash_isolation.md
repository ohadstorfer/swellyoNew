---
name: error-boundary-crash-isolation
description: React Native error boundary placement strategy, per-item list isolation, react-error-boundary v4+ API, Sentry integration gotchas, double-reporting bug, data validation at parse layer — for Swellyo chat screens
metadata:
  type: reference
---

## Context

Swellyo currently has ONE error boundary (PostHogErrorBoundary) that re-throws everything except PostHog errors, meaning any render crash in a chat screen tears down the entire app. Sentry is wired in. The goal is granular crash isolation for messaging screens.

## Library to Use: react-error-boundary v4+ (bvaughn/react-error-boundary)

- Current stable: v6.1.2, MIT, actively maintained
- Works with all React renderers including React Native
- React 19 compatible (supports `useTransition` error catching)
- NOT react-native-error-boundary (carloscuesta) — that library is for the simpler top-level-only pattern; react-error-boundary is more powerful

### Full API

```tsx
<ErrorBoundary
  FallbackComponent={MyFallback}  // receives { error, resetErrorBoundary }
  fallbackRender={({ error, resetErrorBoundary }) => <View>...</View>}  // alternative
  fallback={<Text>Error</Text>}   // static alternative (no reset access)
  onError={(error, info) => {     // log to reporting service here
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
  }}
  onReset={() => {                // cleanup before retry
    // clear bad cache entry, reset local state, etc.
  }}
  resetKeys={[conversationId]}   // auto-reset when this changes (navigation)
>
  <ChatScreen />
</ErrorBoundary>
```

**useErrorBoundary hook** — for async/event-handler errors:
```tsx
const { showBoundary } = useErrorBoundary();
// in a catch block: showBoundary(error)
```

What error boundaries do NOT catch: event handlers, async/await, setTimeout, server errors. Use try/catch + showBoundary or Sentry.captureException for those.

## Placement Strategy — Three Layers

### Layer 1: Per-Screen (navigator level) — MANDATORY
Wrap each major chat screen at the navigator level. Allows navigation away even if the screen crashes. Gives a "Go back" CTA in fallback UI.

```tsx
function MessagingStack() {
  return (
    <ErrorBoundary
      FallbackComponent={ChatScreenErrorFallback}
      resetKeys={[route.key]}  // auto-reset on navigation
    >
      <Stack.Navigator>
        <Stack.Screen name="DirectMessage" component={DirectMessageScreen} />
        <Stack.Screen name="GroupChat" component={DirectGroupChat} />
      </Stack.Navigator>
    </ErrorBoundary>
  );
}

function ChatScreenErrorFallback({ resetErrorBoundary }) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>Something went wrong in this chat.</Text>
      <TouchableOpacity onPress={resetErrorBoundary}><Text>Retry</Text></TouchableOpacity>
      <TouchableOpacity onPress={() => navigation.goBack()}><Text>Go back</Text></TouchableOpacity>
    </View>
  );
}
```

### Layer 2: Per-List-Item — FOR CHAT BUBBLES SPECIFICALLY
Wrap the renderItem function output in a per-message error boundary. A corrupt single message then renders a placeholder, not a white screen.

```tsx
function SafeMessageBubble({ message }) {
  return (
    <ErrorBoundary
      fallback={<View style={styles.errorBubble}><Text>Message unavailable</Text></View>}
      onError={(error) => {
        Sentry.captureException(error, {
          tags: { screen: 'chat', layer: 'message_bubble' },
          extra: { messageId: message.id, messageType: message.type }
        });
      }}
    >
      <MessageBubble message={message} />
    </ErrorBoundary>
  );
}

// In FlatList:
keyExtractor={(item) => item.id}
renderItem={({ item }) => <SafeMessageBubble message={item} />}
```

IMPORTANT: Each item boundary must be a distinct component (not inline JSX), or React can't isolate the error tree correctly.

### Layer 3: Data Validation at the Cache/Parse Layer — BEST ROI
The most cost-effective approach: validate message objects with Zod `safeParse` before they enter the render array. Corrupt items get filtered or replaced with a placeholder object before FlatList ever sees them.

```ts
const MessageSchema = z.object({
  id: z.string(),
  content: z.string().nullable().default(''),
  sender_id: z.string(),
  created_at: z.string(),
  type: z.enum(['text', 'image', 'video', 'audio']).default('text'),
  // ... rest of fields with .default() or .nullable() everywhere
});

function safeParseMessages(raw: unknown[]): Message[] {
  return raw.flatMap(item => {
    const result = MessageSchema.safeParse(item);
    if (!result.success) {
      Sentry.captureException(new Error('Invalid message schema'), {
        extra: { raw: item, issues: result.error.issues }
      });
      return []; // filter out corrupt item silently
    }
    return [result.data];
  });
}
```

Use this at the point messages arrive from Supabase Realtime or chatHistoryCache — before they go into state.

## Sentry Integration — Avoiding Double-Reporting

**Known bug**: React re-renders a failing component twice before giving up (React's "replayUnitOfWork" mechanism). Combined with Sentry's `CaptureConsole` integration, this causes the same error to appear twice in Sentry. Confirmed in getsentry/sentry-javascript#1432.

**Fix strategy**:
1. Use `Sentry.ErrorBoundary` OR `react-error-boundary` with `onError` callback — not both together
2. If using react-error-boundary (preferred for RN — more flexible API), add `onError` prop to call `Sentry.captureException`
3. Disable `CaptureConsole` integration OR add a `beforeSend` filter to deduplicate by fingerprint
4. Do NOT also call `Sentry.captureException` manually inside the same `componentDidCatch`

**Recommended integration**:
```tsx
<ErrorBoundary
  FallbackComponent={fallback}
  onError={(error, info) => {
    Sentry.withScope(scope => {
      scope.setTag('boundary', 'chat-screen');
      scope.setExtras({ componentStack: info.componentStack });
      Sentry.captureException(error);
    });
  }}
>
```

**Sentry.ErrorBoundary** (their own component) — supports `beforeCapture` for adding tags pre-send, `onError` for propagation, `fallback` prop. Can be used instead of react-error-boundary but has fewer reset features (no resetKeys equivalent). Use it if you only want the boundary for error reporting without reset/retry logic.

## Bluesky social-app Pattern

Bluesky wraps its export with `Sentry.wrap(App)` for global error capture. The main component tree uses nested providers in dependency order. No per-item boundaries are visible from the public tree inspection, but they use `freezeOnBlur: true` at the navigator level to reduce error surface when screens are backgrounded.

## React Native Specific Notes

- Error boundaries only catch JS render errors. Native crashes (OOM, native module failures) are NOT caught — Sentry's native SDK handles those separately.
- In __DEV__ mode, RN shows a RedBox instead of the fallback UI — test boundary behavior with production builds only.
- The current Swellyo `PostHogErrorBoundary` re-throws non-PostHog errors via `throw error` in `getDerivedStateFromError` — this is the correct pattern for a specialized filter boundary, but it means nothing else is caught.

## Recommended Layered Approach for Swellyo

1. **App.tsx level**: Keep PostHogErrorBoundary as-is. Add a second outer `Sentry.wrap(App)` (already done).
2. **Navigator level (DirectMessageScreen, DirectGroupChat, ConversationScreen)**: Add react-error-boundary with `resetKeys={[conversationId]}` and a "Go back" fallback. This is the PRIMARY protection.
3. **Message bubble level**: Wrap `renderItem` output in a lightweight boundary with a "Message unavailable" placeholder fallback. Use `onError` to log to Sentry with messageId tag.
4. **Cache/parse layer (chatHistoryCache, Realtime payload handler)**: Add Zod safeParse on message schema before inserting into state. This prevents most crashes before the render layer.

Priority order: Layer 1 (data validation) prevents the crash entirely. Layer 2 (screen boundary) catches what slips through. Layer 3 (per-item) gives fine-grained isolation for corrupt items that passed validation.

## Sources

- https://github.com/bvaughn/react-error-boundary (v6.1.2, active)
- https://docs.sentry.io/platforms/react-native/integrations/error-boundary/
- https://www.reactnative.university/blog/react-native-error-boundaries
- https://docs.expo.dev/router/error-handling/
- https://github.com/getsentry/sentry-javascript/issues/1432 (double-reporting bug)
- https://github.com/bluesky-social/social-app (Sentry.wrap pattern, freezeOnBlur)
- https://dev.to/carloscuesta/managing-react-native-crashes-with-error-boundaries-13k
- https://medium.com/@apurvashekharofficial/is-error-boundary-enough-to-handle-fatal-errors-in-react-native-apps-8d97c108f0c3
