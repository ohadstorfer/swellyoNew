# Messaging & Chat — UX Audit (Swellyo)

Domain: Messaging & Chat. Bar: WhatsApp / Instagram polish. Platform: React Native + Expo (iOS/Android/web).

Severity key: 🔴 Critical · 🟠 High · 🟡 Medium · 🔵 Low

---

## Top 5 most impactful fixes

1. **🔴 No day/date separators in either chat.** Both DM and group threads show only HH:MM timestamps with no "Today / Yesterday / March 3" divider rows (`DirectMessageScreen.tsx:4721`, `DirectGroupChat.tsx:4605`). In any multi-day thread the user cannot tell when messages were sent — the single most-missed WhatsApp affordance across both screens.
2. **🔴 No offline / "Connecting…" feedback anywhere, despite full health tracking.** DM, group, and provider all track `realtimeHealthy`/`realtimeStatus` and run reconnect catch-up (`DirectMessageScreen.tsx:1006`, `DirectGroupChat.tsx:992`, `MessagingProvider.tsx:1392`) but NONE surface it. On a dead socket new messages silently stop and optimistic sends look sent but sit in the outbox. Add a "Connecting…"/offline header pill.
3. **🔴 Blank chat on cold/cache-miss open.** `listEmptyComponent` returns `null` while fetching in both screens (`DirectMessageScreen.tsx:4690`, `DirectGroupChat.tsx:4574`) — dead space over the background image on slow networks. A `loadingContainer` style even exists unused. Add a shimmer skeleton or spinner.
4. **🟠 Groups are anonymous: no delivery ticks, typing doesn't name anyone, no member list.** Read/delivery ticks are hard-disabled in groups (`DirectGroupChat.tsx:114`, `enabled={isDirect}`), the typing indicator shows only anonymous dots / "N people typing…" even though per-typer identities are already tracked (`4178`, `typingUsersRef`), and there's no member roster or member-count subtitle (header opens the trip detail instead, `5456`). Group senders can't tell a message sent, who's typing, or who's in the room.
5. **🟠 Two silent data-loss / dead-end bugs:** (a) multi-photo OS share forwards only `share.files[0]` while previewing "N photos" (`ShareToChatScreen.tsx:111-120`); (b) a failed **voice** message is a dead bubble — alert icon, disabled play, no tap-to-retry (`AudioMessageBubble.tsx:173`), unlike the image/album path. Plus hardcoded **Spanish** strings in the DM failed-text menu inside an English app (`DirectMessageScreen.tsx:4156`).

_Honorable mentions:_ list has no row actions (mute/delete/mark-read) and the fake "Swellyo Team" row shows a permanent unread "1" (`ConversationsScreen.tsx:475`); list-wide re-renders from un-memoized bubbles + heavy `renderItem` deps; Android has no scroll anchoring (`maintainVisibleContentPosition` is iOS-only); 500-char message cap; no Forward / @mentions / mark-as-unread; production `console.log` in hot paths.

---

## ConversationsScreen (conversation list)

- 🟢 **Good:** loading uses `ConversationListSkeleton` (skeletons, not a spinner) — `ConversationsScreen.tsx:1302`. Virtualized FlatList with tuned `initialNumToRender/maxToRenderPerBatch/windowSize/removeClippedSubviews` (1287-1290). Cache-first render via provider. Media/deleted/commitment previews with icons. Group last-message sender prefix ("You:" / "Name:") 954-961.
- 🟡 **No row-level actions (mute / delete / archive / mark read/unread).** The row is a plain `TouchableOpacity` with only `onPress` (`ConversationsScreen.tsx:973-977`). WhatsApp offers swipe-to-archive and a long-press action sheet (mute, delete, mark unread, pin). None exist here. *Fix:* add long-press → action sheet (Mute, Delete conversation, Mark as read/unread) and/or swipeable row.
- 🟡 **Fake welcome row shows a permanent unread badge.** `createWelcomeConversation()` hardcodes `unread_count: 1` (`ConversationsScreen.tsx:475`); tapping it opens `SwellyoTeamWelcome` and never clears it, so the "1" persists every launch. *Fix:* persist a "welcome seen" flag and drop the count once opened.
- 🟡 **List-load failure degrades to an empty/welcome state with no error affordance.** `loadConversations` catches, logs, and `setLoading(false)` (`MessagingProvider.tsx:612-626`); with no cache the user sees the empty/welcome UI as if they have no chats. *Fix:* track a `loadError` and render a "Couldn't load chats — Retry" state distinct from the empty state.
- 🟡 **No pull-to-refresh.** The list `FlatList` has no `RefreshControl` (`ConversationsScreen.tsx:1279`). It refreshes on `AppState` active (332-339), but users instinctively pull down. *Fix:* add `RefreshControl` wired to `refreshConversations`.
- 🔵 **Aggressive press dim.** Conversation row `activeOpacity={0.2}` (`ConversationsScreen.tsx:977`) drops the row to 20% opacity on touch — heavier than the ~0.6-0.7 used elsewhere. Reads as a flash. *Fix:* raise to ~0.6.
- 🔵 **Time format can read oddly.** `formatTime` returns `DD/MM` for same-year and `DD/MM/YYYY` otherwise (`ConversationsScreen.tsx:530-533`); WhatsApp shows locale short dates. Minor consistency nit.
- 🔵 **Group avatar fallback is a generic people glyph** (`ConversationsScreen.tsx:1006-1008`) when no cover thumb — acceptable, but a colored initials tile would look less "empty".

## Global message search (ChatSearchHeader + overlay)

- 🟢 **Good:** dedicated in-conversation search bar with hit counter ("N of M"), up/down navigation, disabled arrow states, loading spinner, and an entrance animation (`ChatSearchHeader.tsx`). Global full-screen search overlay from the list. This is WhatsApp-grade.
- 🔵 **"0 of 0" only appears at query length ≥ 2** (`ChatSearchHeader.tsx:104`); a 1-char query shows nothing, which is fine but silently gives no feedback that search needs ≥2 chars.

## ChatScreen (Swelly AI onboarding chat)

*(This is the AI onboarding chat, not user-to-user, but shares the chat surface.)*

- 🔴 **Send failure has no recovery.** On `sendMessage` error it shows `Alert.alert('Error', 'Failed to send message. Please try again.')` (`ChatScreen.tsx:553-555`) but the optimistic user bubble stays in the list looking sent, `isLoading` clears, and there is no failed state or retry. The user must retype. *Fix:* mark the message failed with a tap-to-retry, like WhatsApp.
- 🟠 **Init failure = dead screen.** If `healthCheck`/`initializeWithProfile` throws, it shows a one-shot `Alert` with only "OK" (`ChatScreen.tsx:323-330`) and leaves an empty chat with no greeting and no retry button. *Fix:* inline error state with "Retry".
- 🔵 **`initialNumToRender={50}` / `maxToRenderPerBatch={50}`** (`ChatScreen.tsx:1014-1015`) is heavy for a short onboarding thread; harmless here but copy-paste risk if reused.
- 🟢 **Good:** animated typing indicator (memoized, leak-safe), progress bar, keyboard-synced composer via Reanimated worklets.

## ChatTextInput (composer)

- 🟢 **Excellent:** auto-grow 1→5 lines with a mirror on web, haptic on send (`hapticLight`, line 277), push-to-talk voice with slide-to-cancel + slide-to-lock, camera affordance, edit-mode reuse of the same input (keyboard never drops), RTL handling, focus-retention trick on send. This is genuinely WhatsApp-class.
- 🔵 **No near-limit character counter.** `maxLength` (default 500) silently stops input with no "N left" hint (`ChatTextInput.tsx:570`). Low.
- 🔵 **Send-shrink override uses `setTimeout(…, DURATION+50)`** (`ChatTextInput.tsx:297-299`) — if the component unmounts mid-animation the timer still fires on a released shared value; harmless but worth a cleanup ref.

## Media UX components

- 🟠 **Failed voice message: no retry.** `AudioMessageBubble.tsx:173-175` shows an `alert-circle` on failure and disables the play button, but there is no tap-to-retry (the image/album paths do retry). A failed voice note is a dead bubble. *Fix:* on `upload_state === 'failed'`, make the bubble tappable to re-run the send.
- 🟢 **Good — album bubble:** `MediaAlbumBubble.tsx` renders per-tile uploading spinner and failed→"Retry" tap (72-128), 2×2 grid with "+N" overflow, timestamp/receipt pill. Matches WhatsApp.
- 🟢 **Good — multi-media review:** `MediaReviewModal.tsx` has pager, per-item captions keyed by uri (survive crop/reorder), filmstrip with tap-to-jump / tap-active-to-delete, single live video player with poster fallback for inactive pages, send FAB with count badge, double-send guard.
- 🟡 **No upload progress shown in the review→send handoff.** `MediaReviewModal` hands items to the host and closes; progress lives on the bubbles afterward. Fine *if* the bubbles show real progress (see per-screen findings) — but the review modal itself gives no "preparing…" feedback if the host is slow to mount bubbles.
- 🔵 **Audio bubble hardcodes width off `Dimensions.get('window').width`** at module load (`AudioMessageBubble.tsx:51`) — won't respond to rotation/split-view. Low on phones.
- 🔵 **JumboEmojiMessage timestamp color is fixed dark** `rgba(0,0,0,0.45)` (`JumboEmojiMessage.tsx:79`) regardless of side/background — can be low-contrast on a dark/own bubble area. Low.

## Attachments (AttachPanel / AttachMenuGrid / previews)

- 🟢 **Good:** attach menu renders inside the keyboard's rectangle with no layout jump (`AttachPanel.tsx`), press animations respecting reduced-motion (`AttachMenuGrid.tsx`), document/contact/file preview-before-send modals with double-tap guards (`FilePreviewModal.tsx`, `ContactPreviewModal.tsx`), in-app file viewer for received docs with share escape hatch (`FileViewerModal.tsx`).
- 🔵 **Contact preview "Send" pill has no busy/spinner state** (`ContactPreviewModal.tsx:127-137`) — relies on `sendingRef`; a slow send shows no feedback. Low.

## ShareToChatScreen (OS "Send to…")

- 🟠 **Multi-photo share drops extra files.** `previewLine` says "N photos" (`ShareToChatScreen.tsx:55-60`) but `sendTo` for `kind === 'media'` opens the chat with only `share.files[0]` (111-120). Sharing multiple images from Photos sends exactly one. *Fix:* pass the full array to the composer's batch (MediaReviewModal) path.
- 🟢 **Good:** search, empty states distinguishing "No chats yet" vs "no match" (193-197), per-row busy spinner, single-send guard (`sentRef`), replaces itself with the ChatCard so the user lands in-thread.

## MessagingProvider / realtime / offline

- 🟢 **Strong foundation:** cache-first load with 5-min freshness skip, outbox drained on mount + foreground + NetInfo recovery (`MessagingProvider.tsx:1392-1452`), enrichment retry (3× backoff), reconnect sync, in-app banners for background messages, read-watermark debounce, avatar prefetch, top-conversation message prewarm.
- 🟠 **No user-visible offline / reconnecting state.** Network loss is handled silently by the outbox; there is no "Connecting…" header or "waiting for network" like WhatsApp. Combined with the missing per-message failed state, a user on a dead network sees messages that look sent but aren't. *Fix:* surface subscription health / NetInfo as a thin header banner in the chat + list.
- 🟡 **Heavy production console logging.** `onNewMessage` alone logs 3-4 times per message with emoji prefixes, none `__DEV__`-gated (`MessagingProvider.tsx:1091-1314`, and throughout). On a busy group this is real main-thread/log-bridge cost and leaks message metadata to logs. *Fix:* gate behind `__DEV__`.
- 🔵 **`fetchAndEnrichConversation` fires several sequential/parallel Supabase reads per newly-discovered conversation** (91-224). Fine at low volume; could batch.

## Cross-cutting / consistency

- 🟢 **Good:** every bubble routes through `SafeMessageBubble` (per-message error boundary + PostHog redaction) and the screen through `ChatErrorBoundary` with a Try-again/Go-back fallback. Robust.
- 🔵 **`ChatErrorBoundary` fallback is light-themed** (`#fff` bg, dark text) — fine on the light chat area but would clash if ever mounted over the dark list header. Low.

---

## DirectMessageScreen (1:1)

Heavily engineered — clears the WhatsApp bar on the hard problems (optimistic send, upload-first media, outbox retry, reconnect catch-up, unread divider, reactions, reply/swipe, albums, in-chat search). Gaps below are polish/robustness, ranked.

### Loading states
- 🔴 **Blank chat on cold/cache-miss open.** `listEmptyComponent` returns `null` while `isFetchingMessages` is true (`DirectMessageScreen.tsx:4690`) and nothing else renders during the first `getMessages` fetch (line 1962). Slow network = dead space over the background image. An unused `loadingContainer/loadingText` style already exists (line 6697). *Fix:* shimmer bubble skeleton or centered spinner while `isFetchingMessages && messages.length === 0`.
- 🟠 **Dead `loadingMessage` state.** `setLoadingMessage('This is taking longer than usual...')` is set during new-conversation creation (line 2210) but never rendered anywhere. The reassurance never reaches the user. *Fix:* render it or remove.
- 🟡 **No "connecting" feedback on first realtime subscribe** despite `realtimeStatus`/`realtimeHealthy` being tracked (lines 493, 750).
- 🟢 Media upload progress is real byte-progress `UploadProgressRing` on image/video/file bubbles (lines 5086, 5182, 4935), throttled.

### Error & failure handling
- 🔴 **No realtime-disconnect / offline banner.** Screen tracks `realtimeHealthy=false`, `reconnectAttempt`, `wasDisconnectedRef` and runs staggered reconnect catch-up (lines 1006-1054) but never tells the user. On a dead socket new messages silently stop until catch-up fires. *Fix:* header pill ("Connecting…") when `!realtimeHealthy` for >Ns.
- 🟠 **Spanish hardcoded strings in the failed-text menu** inside an all-English app: `'Mensaje sin enviar'`, `'Reenviar'`, `'Copiar texto'`, `'Borrar'`, `'Cancelar'` (`DirectMessageScreen.tsx:4156-4165`). Ships Spanish to English users. *Fix:* translate.
- 🟡 **Stuck text has no explicit failed cue.** On send error the optimistic bubble is left with no tick and relies on the silent outbox (lines 2371-2379); the catch path intentionally does not set `upload_state='failed'` for text, so the "Tap to retry" label (line 5476) rarely appears. Below the WhatsApp bar (red "!"). Intentional per design, but consider a red exclamation after a timeout.
- 🟢 Media failure handling is strong: failed overlay + Retry + Remove on image/video/audio/file (lines 5071, 5185, 4980, 4945); retry re-runs upload-first with the cached local URI, offers Remove if the local file is gone (3662-3737).

### Empty states
- 🟡 **Group-path empty state is fully blank** (`listEmptyComponent` returns `null` when `!isDirect`, line 4695). Direct chats get `WelcomeIntroMessage`. *Fix:* generic "No messages yet — say hi" for groups.

### Feedback & delivery
- 🔴 **No date/day separators.** Timestamps are HH:MM only (`formatTime`, line 4721); no "Today / Yesterday / March 3" divider grouping by day. In a multi-day thread the user can't tell when things were sent. Biggest missing feedback feature. *Fix:* insert day-divider rows in `displayRows` (line 4384) keyed on calendar day.
- 🟡 **Two-tick only, no single-tick "sent".** `getReceiptState` returns `'delivered'` (gray double-tick) the instant the row is server-confirmed (line 126); `'pending'` → no tick. No ✓ vs ✓✓ distinction.
- 🟡 **No haptic on send or reaction-apply** (`hapticMedium()` fires only on long-press, line 4146). Low effort, noticeable polish.
- 🟢 Typing indicator, optimistic send + slide-up, unread divider + jump badge, read receipts — all present and well done.

### Message interactions
- 🟡 **Copy has no confirmation** (`handleCopyMessageText`, line 3914) — no "Copied" toast/haptic.
- 🟡 **`onScrollToIndexFailed` retries once at fixed 200ms** (lines 5799-5807); on a slow list the reply-/search-jump silently does nothing. *Fix:* backoff or `scrollToOffset` fallback.
- 🟢 Reply (swipe + menu), react (long-press bar + who-reacted sheet), edit (15-min window, in-place composer), delete, copy, scroll-to-bottom FAB, jump-to-unread, reply-jump re-anchoring — strong.

### Media UX
- 🟡 **Video signing round-trip has no loading/error state.** `openVideo` (line 5016) opens the viewer on the poster and signs behind it; slow signing = frozen poster with no spinner, and failure just closes the viewer (line 5031) with no message. *Fix:* spinner over poster while `url===null`, error toast on failure.
- 🟢 Inline 600px thumbnails, poster frames, aspect clamping, fullscreen viewers, album grid+pager, audio waveform, image/video captions — strong.

### Missing vs WhatsApp
- 🟡 **No forward, no pinned, no mentions, no "mark as unread", no starred.** `MessageActionsMenu` has only Edit/Delete/Copy/Reply/Report/React (lines 6293-6409). Image caption IS supported (5216-5276). Forward and mark-as-unread are the most-expected.
- 🟡 **500-char hard cap** (`maxLength={500}`, line 5862); WhatsApp allows ~65k. Pasting a paragraph silently truncates.

### UI / consistency
- 🟠 **Android list jumps on prepend/trim.** `maintainVisibleContentPosition` is iOS-only (comment line 5792); Android has no anchoring. Loading older messages (line 2002) or trimming the window visibly jumps the viewport on Android. *Fix:* `@stream-io/flat-list-mvcp` or FlashList.
- 🟡 **Hot-path `console.log` not `__DEV__`-gated** — `loadMessages` (1726/1751/1794), `handleMessageLongPress` (4121), `canDeleteMessage` on every menu render (4301), `MessageActionsMenu` renders (6313/6376). Production overhead + noise.

### Performance-perceived
- 🟠 **List-wide re-renders.** `renderItem` `useCallback` deps include `menuVisible`, `selectedMessage`, `otherUserLastReadAt`, `editingMessageId`, `highlightedMessageId`, `resolvingReplyJumpId`, `displayRows` (line 4665). Opening the menu, a read receipt, editing, or highlighting re-renders every visible cell.
- 🟠 **Bubbles not memoized.** `renderMessage` (line 4728) is a plain function; no `React.memo` row component. Every re-render re-runs link-parsing regex, `getBodyTextAlign` char-loop, `getReceiptState`, emoji detection for all visible rows. *Fix:* extract a `React.memo`'d `MessageRow`.
- 🟡 **No `removeClippedSubviews`** on the FlatList (5733-5816); media-heavy Android threads keep off-screen cells mounted.
- 🟢 Good: `keyExtractor` prefers stable `client_id` (4671), tuned `initialNumToRender=20`/`windowSize=7`, synchronous memory-cache-first load for instant warm opens.

### Edge cases
- 🟢 Well covered: media dedup guard (4s window), per-send UUID clientId, module-scoped `inFlightUploads` surviving unmount, zombie-heal effect flipping dead uploads to `failed`+Retry (line 1410), per-text outbox entries.

## DirectGroupChat (group)

`DirectGroupChat` serves both DMs and groups; many polished behaviors are gated to DMs, so group-specific gaps concentrate in **identity/feedback** (who's here, who's typing, did it send) rather than media plumbing.

### Loading states
- 🟠 **No initial message-load indicator** — `listEmptyComponent` returns `null` while fetching (`DirectGroupChat.tsx:4574`); only pagination has a loader (line 4568). Blank chat background on cold open. *Fix:* spinner/skeleton when `isFetchingMessages && messages.length === 0`.
- 🟠 **Dead `loadingMessage` state** — set to "This is taking longer than usual..." during the up-to-30s conversation-create wait (lines 2018-2037) but never rendered (only declared, line 432).
- 🟡 **Red "Sending…" spinner reads as an error.** A normal in-flight text send uses a red `ActivityIndicator` + red `#E53935` text (lines 5363-5367); red is the app's error color everywhere else. *Fix:* neutral/gray for pending.
- 🟢 Media upload progress well handled (`UploadProgressRing`, lines 4828, 4979, 5075).

### Error & failure handling
- 🟠 **No realtime disconnect/reconnect UI** despite `realtimeHealthy`/`realtimeStatus` tracking + background catch-up (lines 467, 701, 992-1012). A dropped socket is invisible. *Fix:* "Connecting…" header subtitle/banner.
- 🟡 **Text send failure is silent by design** (comment 2185-2189): a failing text sits on the red "Sending…" spinner indefinitely; "Tap to retry" (5369-5378) only shows when `upload_state==='failed'`, which the text path never sets. Confirm intended.
- 🟢 Media failure/retry strong: image/video/file/audio all have Retry + Remove (4838, 4873, 4964, 5078) plus zombie-heal recovery (1369-1417).

### Empty states
- 🟡 **Empty group chat shows nothing** (`listEmptyComponent` → `null` for `!isDirect`, lines 4578-4581). *Fix:* group-specific "This is the beginning of [group] — Say hi" with member count.
- 🟡 **No "you're alone / members failed to load" state.**

### Feedback & delivery
- 🟠 **Delivery/read ticks fully disabled in groups.** `ReadReceipt` gets `enabled={isDirect}` and early-returns `null` (lines 114-117; call sites 4442, 4823, 4856, 4991, 5104, 5321, 5349). A group sender gets NO send confirmation — not even a single "sent" tick. WhatsApp shows gray/blue ticks in groups. Biggest group feedback gap. *Fix:* at minimum a single "sent" tick once the server row exists.
- 🟠 **Typing indicator doesn't show WHO is typing.** A single typer renders anonymous dots (lines 4178-4192); only `typingCount > 1` shows a generic "N people typing…". Per-typer identities are already in `typingUsersRef` keyed by userId (698, 1221-1240) — only the count is surfaced. *Fix:* map userIds → names ("Alice is typing…") with avatar in the typing bubble.
- 🟠 **No day/date separators.** Unread divider exists (4471-4478) but no "Today/Yesterday/date" dividers; `formatTime` is HH:MM 24h only (4605-4610). No temporal anchoring in multi-day threads.
- 🟡 **Received sender label can fall back to the GROUP name.** `senderName = message.sender_name || message.sender?.name || otherUserName` (line 4655; album 4351) — in a group `otherUserName` is the group title, so a message with missing sender enrichment shows the *group name* as author. *Fix:* fall back to `senderNamesById`/member list, not the group title.
- 🟢 Optimistic send, per-sender colors, first-in-run name + last-in-run avatar, haptic on long-press — good.

### Message interactions
- 🟡 **No Forward** — `MessageActionsMenu` has Reply/React/Edit/Delete/Copy/Report only (6200-6322). Core group behavior.
- 🟡 **No @mentions** — no parsing, autocomplete, or highlight. Standard for pinging a member.
- 🟢 Reply, react + "who reacted" sheet, edit (15-min), delete, copy, swipe-to-reply, scroll-to-bottom FAB w/ unread count, jump-to-unread, reply-jump re-anchoring — solid.

### Media UX
- 🟢 Most polished dimension: image/video/audio bubbles, 600px inline thumbnails, fullscreen viewers, on-demand signed video URLs, poster frames, captions, WhatsApp-style albums (4+ collapse to grid) with pager, multi-select review, progress rings, aspect clamping. Web degrades to single-item viewers sensibly.

### Missing vs WhatsApp groups
- 🟠 **No member list / member-count subtitle.** Header renders only the group name (5505-5507); `onlineStatusElement` returns `null` for groups (4589-4591). Tapping the header opens the **trip detail** (5456-5502), not group-info/members. No way to see who's in the group. *Fix:* member-count subtitle + group-info screen.
- 🟡 **No admin actions** (add/remove member, make admin, rename) from chat.
- 🟢 **Join/leave system messages ARE supported** — centered `is_system` pills (4616-4622). Not a gap.

### UI / consistency
- 🟡 **Typing bubble has no avatar lane in groups** (4179-4180 use `botMessageContainer`), so it reads detached from the sender's avatar column.
- 🟢 Tail-corner run logic, per-media sender-name insets, keyboard handling — carefully done. No long-message cut-off.

### Performance-perceived
- 🟠 **`maintainVisibleContentPosition` iOS-only** (5702-5704) — Android jumps the viewport on prepend/trim in long history. *Fix:* `@stream-io/flat-list-mvcp`.
- 🟡 **No `removeClippedSubviews`** (5643-5726) — off-screen media cells stay mounted (test: known inverted-list Android bugs).
- 🟢 Stable `keyExtractor` (`client_id || id`), tuned virtualization, `dedupeMessages` chokepoint, bounded rAF re-measure loop (only while menu open).

### Edge cases
- 🟢 Rapid/dup sends (`lastMediaSendRef` + `dedupeMessages`) and backgrounding during upload (module-scoped `inFlightUploads` + zombie-heal) handled well.
- 🟡 **Many members feel anonymous** — no member roster, no per-member read state, typing caps at "N people typing…".
