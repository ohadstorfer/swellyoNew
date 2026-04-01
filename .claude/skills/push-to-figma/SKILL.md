---
name: push-to-figma
description: Capture the running web app and push it to Figma as editable design layers. Use when the user says "push to Figma", "send to Figma", "capture for Figma", "export to Figma", or wants to send the current UI back to Figma for design review. Supports clipboard, new file, or existing file output modes.
---

## Purpose

Capture the live Expo web app and convert it into editable Figma frames — closing the design-code loop. Designers can then review, annotate, and refine the implementation directly in Figma.

## Prerequisites

- The Expo web dev server must be running (`npm run web`, typically on `localhost:8081`)
- The Express server should be running for full functionality (`npm run dev`, port 3000)
- The Figma MCP server must be connected (`/mcp`)

## Input

Optional args:
- `clipboard` (default) — copies to clipboard for pasting anywhere in Figma
- `new` — creates a new Figma file
- `<figma-url>` — adds to an existing Figma file (extract fileKey from URL)

If no args, default to clipboard mode.

## Steps

### 1. Verify dev server is running

Check common Expo web ports in order:
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8081 2>/dev/null
curl -s -o /dev/null -w "%{http_code}" http://localhost:19006 2>/dev/null
curl -s -o /dev/null -w "%{http_code}" http://localhost:19000 2>/dev/null
```

Use whichever port responds (store it for step 4). If none respond, tell the user to start it with `npm run web` in a separate terminal and wait.

### 2. Determine output mode

Based on user input:
- **clipboard**: `outputMode: "clipboard"`
- **new**: `outputMode: "newFile"`, auto-generate a `fileName`
- **Figma URL**: `outputMode: "existingFile"`, extract `fileKey` from URL. Optionally extract `nodeId` if targeting a specific page/frame.

### 3. Inject the capture script

First, check if `public/index.html` already exists and read it. If it has custom content, **merge** the capture script into the existing `<head>` rather than overwriting. If it doesn't exist, create it using the Expo web template as a base:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
    <title>Swellyo</title>
    <style id="expo-reset">
      html, body { height: 100%; }
      body { overflow: hidden; }
      #root { display: flex; height: 100%; flex: 1; }
    </style>
    <!-- Figma capture script (TEMPORARY - remove after capture) -->
    <script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async></script>
  </head>
  <body>
    <noscript>You need to enable JavaScript to run this app.</noscript>
    <div id="root"></div>
  </body>
</html>
```

**IMPORTANT**: This file is temporary. Flag it for removal after capture is complete.

### 4. Open the browser with capture mode

For **clipboard mode** (use the port detected in step 1):
```bash
start "http://localhost:<PORT>#figmacapture&figmadelay=1000"
```

For **new file** or **existing file** mode:
Call `mcp__figma__generate_figma_design` with the appropriate `outputMode`, `fileKey`, and/or `fileName`.
Then poll with `captureId` every 5 seconds (up to 10 times) until status is `completed`.

### 5. Guide the user

Tell the user:
1. A browser window has opened with the app + a Figma capture toolbar
2. Navigate to the screens they want to capture
3. Click **"Entire screen"** for full page or **"Select element"** for a specific component
4. Repeat for each screen/state they want
5. For clipboard mode: a toast confirms when copied — paste with Ctrl+V in Figma
6. For file modes: click **"Open file"** when done

### 6. Cleanup reminder

After the user confirms capture is complete, remind them that `public/index.html` contains the capture script and should be cleaned up. Offer to:
- Delete `public/index.html` entirely (if it didn't exist before)
- Remove just the capture script line (if the file had other customizations)

**NEVER leave the capture script in a production build.** It should not be committed to git.

## Output modes detail

### Clipboard (default)
- No polling needed
- User sees a success toast, then pastes into any Figma file
- Most flexible — user chooses where to paste

### New file
- Call `generate_figma_design` with `outputMode: "newFile"` and auto-generated `fileName`
- May need to select a plan/team if user has multiple
- Poll with `captureId` until complete
- Return the new file URL

### Existing file
- Call `generate_figma_design` with `outputMode: "existingFile"` and `fileKey`
- User must have edit permission on the file
- Creates a new page in the file with captured frames
- Poll with `captureId` until complete

## Tips for best results

- **Set the browser to mobile viewport** (393px wide) before capturing — this matches the mobile-first design intent
- **Navigate to the exact state** you want captured (logged in, specific screen, specific data)
- **Capture multiple screens** in one session by navigating between them
- **Animations won't transfer** — only the static state at time of capture
- The capture is a starting point for design review, not a pixel-perfect reproduction
