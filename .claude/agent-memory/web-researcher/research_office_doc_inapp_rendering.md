---
name: research-office-doc-inapp-rendering
description: In-app rendering of docx/xlsx/pptx/rich files in RN 0.81/Expo 54 from local file:// — iOS QuickLook vs Android (no native), JS/WebView renderers, recommendation
metadata:
  type: project
---

Researched 2026-07-10: rendering Office/rich docs IN-APP from local file:// (private chat attachments, no upload/public URL). App already renders images (expo-image), PDF (react-native-pdf-renderer), text (.txt/.csv).

**iOS = QuickLook (QLPreviewController)** renders locally + offline: PDF, HTML, RTF, plain text, iWork (Pages/Numbers/Keynote), Microsoft Office incl OOXML (docx/xlsx/pptx), images (JPEG/PNG/GIF/TIFF/BMP/HEIC), audio/video, CSV, fonts, USDZ/AR. Full-screen Apple UI (light, own Done/share/markup). Can be embedded as child VC via addChildViewController but loses page scrubber + is buggy → practically always full-screen. So docx on iOS opens in different chrome than our dark FilePreviewShell.
- Wrappers: `react-native-file-viewer` (iOS→QLPreviewController fullscreen, Android→ACTION_VIEW hand-off; old-arch, turbo fork Vadko/react-native-file-viewer-turbo). `@react-native-documents/viewer` = sponsor-only/paid, also delegates. `react-native-doc-viewer` (philipphecht) = stale. No maintained dedicated "expo-quick-look". Minimal custom Expo module wrapping QLPreviewController is easy (Swift, present from rootVC).

**Android = NO system Office renderer.** ACTION_VIEW = hand-off to another app (share sheet, not in-app). Google Docs Viewer WebView needs PUBLIC url (rejected). Only offline in-process option = bundle a JS/WebView renderer. WhatsApp on Android hands docx off to external app.

**JS/WebView renderers (cross-platform, offline):** mammoth.js (docx→HTML, mangles tables/colors/alignment/images — "glance" only), docx-preview.js (better fidelity, browser-only = works in WebView), SheetJS sheet_to_html (xlsx→HTML table, works offline). pptx = no good on-device JS renderer. Good enough to confirm file contents, NOT faithful for complex layouts.

**Recommendation:** iOS = QuickLook for everything (best coverage, ~free, but full-screen Apple chrome breaks dark-shell consistency). Android = keep share-sheet hand-off for Office + custom viewer for pdf/image/text. Optional cross-platform mammoth/SheetJS WebView renderer inside our chrome if in-app-glance parity matters more than fidelity.
