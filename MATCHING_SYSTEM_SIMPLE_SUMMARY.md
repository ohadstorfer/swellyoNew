# How the Matching System Works – Simple Summary

**For:** Non-technical readers (e.g. founder, product)  
**Goal:** Explain how matching works, what the main risks are, and what to improve first.

---

## How It Works (In Plain English)

1. **User opens the Swelly chat**  
   They tap the Swelly button from the conversations list. The app opens the trip-planning chat.

2. **User chats with Swelly**  
   Swelly is an AI that asks where they want to go and what kind of surfers they want (age, board type, country, etc.). All of this runs on our servers (Supabase Edge + OpenAI).

3. **When Swelly has enough info, it “finishes”**  
   The AI sends back a “finished” signal plus the collected details (destination, filters, etc.). **Important:** The server does **not** find the matches. It only returns the data.

4. **The app finds the matches on the user’s device**  
   Right after the server says “finished,” the **phone or browser** runs the matching logic. It talks to the database to get surfer profiles and then picks who matches. So the heavy work and the data access happen on the **client**.

5. **Matches are shown in the chat**  
   The user sees cards for each matched surfer (name, days in destination, surf level, etc.). They can tap “Send Message” or “View Profile.”

6. **Saving the list for later**  
   The app sends the list of matches to the server so that if the user leaves and comes back, the same list can be shown. This “save” is done in the background. If it fails, the user is not told and the list might not come back next time.

7. **When the user taps “Send Message”**  
   The app checks if a conversation with that surfer already exists. If yes, it opens that chat. If no, it shows a short loading screen, creates the conversation, then opens the chat.

---

## Main Risks

### 1. Matching runs on the user’s device

- **What it means:** The matching logic and the reading of surfer data happen in the app, not on our servers.
- **Why it’s a problem:**  
  - Everyone’s device can try to read a lot of data and do heavy work; that doesn’t scale and can be abused.  
  - We rely on database security (RLS) alone to protect data.  
- **What to do:** Move “find matches” to the server. The app should only send the criteria and get back a ready-made list.

### 2. The “who was already matched” list can be wrong

- **What it means:** When we run matching again (e.g. user does another search in the same chat), we try to exclude people we already showed. That list is built from the chat messages. Because of how the code is written, it sometimes uses an old snapshot of the messages, so the list can be missing the latest matches.
- **Why it’s a problem:** The same person might appear in two different match results in one chat.
- **What to do:** Fix the logic so we always use the up-to-date list of “already matched” users (or a dedicated list we update whenever we show new matches).

### 3. Saving the match list can fail without the user knowing

- **What it means:** When we save the list of matches to the server (so it can be restored later), we don’t retry if the request fails, and we don’t tell the user.
- **Why it’s a problem:** If the network or server has a hiccup, the list might never be saved. When the user comes back, that set of matches could be gone.
- **What to do:** Retry saving a few times; optionally show a short “Couldn’t save; try again” if it still fails.

### 4. “Send Message” can look stuck

- **What it means:** After the user taps “Send Message” on a card, the button shows a loading spinner. The code never turns that off when the conversation actually opens.
- **Why it’s a problem:** The button can look like it’s still loading even after the chat has opened. Confusing.
- **What to do:** Turn off the loading state when we open the conversation (or after a short timeout).

### 5. Unused or duplicate code

- **What it means:** We have a database table meant for storing matches that we never use. We also have two versions of the chat screen and two matching algorithms, with some “optional” behaviors (like asking “add more criteria?”) that are never actually turned on.
- **Why it’s a problem:** Harder to maintain, more bugs, and confusion about how the product really behaves.
- **What to do:** Decide on one flow and one algorithm; remove or properly use the extra table and the dead code.

---

## What to Improve First

**Do these first (in order):**

1. **Move matching to the server**  
   Have the server (e.g. the same place that runs the Swelly chat) run the matching logic and return only the list of matched users (and what’s needed for the cards). The app should not read the full surfer table or run the algorithm. This fixes scalability and security of matching.

2. **Fix the “already matched” list**  
   Make sure every new match run uses the correct, up-to-date list of people we already showed in that chat, so we don’t show the same person twice in one conversation.

3. **Make saving the match list more reliable**  
   Retry when saving fails, and optionally tell the user if we couldn’t save so they can try again.

4. **Fix the Send Message button**  
   Stop showing the loading spinner once the conversation has opened (or after a few seconds).

5. **Clean up the product and code**  
   Pick one chat screen and one matching path; remove or implement the “add more criteria?” flow; use or remove the match-storage table. This reduces bugs and makes future changes easier.

---

## One-Paragraph Summary

Users chat with Swelly to say where they’re going and what they want; when Swelly has enough info, the **app** (not the server) finds matching surfers and shows them. Saving that list to the server can fail silently, and the list of “already shown” users can be wrong so the same person might appear twice. The biggest improvement is to **run matching on the server** and have the app only send criteria and show results; then fix how we track and save matches, and fix the Send Message button so it doesn’t look stuck.
