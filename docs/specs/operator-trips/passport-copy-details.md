# Passport — "Copy details"

**Status:** built 3 August 2026, uncommitted. Needs a native rebuild before it does anything.
**Decided by:** Ohad, 3 August 2026.
**Follows:** `passport-upload-v1.md` (image only, no extraction). This is the "later" half of §346 of that spec, done a different way.

---

## 1. What it does

Today the operator opens a passport photo and retypes the details into a flight booking by hand.

Now there is a **Copy details** button. It reads the passport on the phone, shows the fields, and copies them:

```
Surname: GONZALEZ
Given names: MARIA LUZ
Passport no: X1234567
Nationality: SLV
Date of birth: 1994-03-12
Sex: F
Expires: 2029-08-30
```

**Nothing is saved.** Not to the database, not to a cache, not to a log. The details are worked out when the button is pressed and gone when the screen closes.

Ohad's words: *"que extraiga los detalles del pasaporte en vivo, sin guardarlos en la base de datos. Solo lo copia."*

---

## 2. Why nothing is saved

This is not only a preference — it removes three obligations at once:

| If we saved it | What that would cost |
|---|---|
| Passport number in a column | An encryption key (`DOCUMENT_ENCRYPTION_KEY`), and a purge that wipes it |
| Names, dates, nationality | A data-protection clause in the operator agreement |
| Anything at all | A promise about how long we keep it |

Reading it live means there is nothing at rest to protect. The `20260729000000_passport_apis_fields.sql` migration and the `group-document-passport` edge function stay **unapplied and undeployed**, as `passport-upload-v1.md` §4 says.

---

## 3. Why we read the code lines, not the printed page

A passport carries the same details twice: printed for people, and encoded in the two `<<<<<` lines at the bottom (the **machine-readable zone**).

We read the code lines because they carry **ICAO check digits**. That means we can tell whether the read was right.

This matters more than it sounds. A wrong passport number on a ticket is a traveler stopped at the gate. General text recognition of the printed page would hand the operator a wrong number with no way to know. The check digits turn a guess into a verified read — or an honest "check this".

The screen says which of the three it is:

- **"Read and checked."** — every check digit agrees. Copy it.
- **"Check the marked fields against the photo."** — some digit disagreed. Those fields are marked; the rest are fine.
- **"Could not find the two code lines."** — bad photo. The fields are blank and typeable.

---

## 4. Where the reading happens

**On the phone.** Apple Vision on iOS, Google ML Kit on Android. Both are already on the device, both work offline, both are free.

The passport photo is **never sent to an OCR service**. No third party ever sees it. That was the deciding factor over sending it to an AI model, which would have read bad photos better but would have meant passport images leaving us.

### Library choice

`expo-ocr-kit`, picked over the more popular `expo-mlkit-ocr` and `@react-native-ml-kit/text-recognition` for two concrete reasons:

| | expo-ocr-kit | the alternatives |
|---|---|---|
| iOS engine | Apple Vision, no pod | Google ML Kit pod |
| iOS app size | **no change** | tens of MB added |
| iOS minimum | **15.1 — exactly ours** | 16.0, which would drop iOS 15 users |

The risk is that it is young (v0.1.4, one author). It is also tiny — two Swift files, one gradle line, a small JS wrapper. If it goes stale we vendor it, which is a much smaller bet than it looks. The Swift was read before depending on it.

Android gets `com.google.mlkit:text-recognition` bundled, which adds a few MB to the APK. iOS gets nothing.

---

## 5. Files

| File | What it is |
|---|---|
| `src/services/trips/passportMrz.ts` | **Pure.** OCR text → fields → the copied block. No native modules, no network. |
| `src/services/trips/__tests__/passportMrz.test.ts` | 23 tests. Builds valid passports with real check digits, then corrupts them. |
| `src/services/trips/passportScanService.ts` | Signed URL → download → recognise → delete → parse. |
| `src/components/trips/PassportDetailsPanel.tsx` | The screen. Editable fields, marked doubts, Copy. |
| `src/components/trips/DocumentViewer.tsx` | Gained `isPassport` and `travelerName`, and the button. |
| `src/components/trips/DocumentReviewScreen.tsx` | Host side. Passes `isPassport={viewing?.kind === 'passport'}`. |
| `src/screens/trips/TripDetailScreen.tsx` | Traveler side, on their own passport. `viewingDocPath` → `viewingDoc` so the kind travels with the path. |
| `jest.config.js` | `mrz` is ESM-only, so Jest has to transform it. |

The split matters: everything that can be silently wrong is in the **pure** file, so it is tested without a phone.

---

## 6. Traps

**The image has to touch disk.** Text recognition needs bytes. `DocumentViewer` rule 2 (`cachePolicy="none"`) keeps passports out of the image cache, so the scan downloads to the cache directory and deletes in a `finally` — the same trade the PDF branch already makes (its rule 3). **That delete is the only thing keeping a plain copy of someone's passport out of the cache directory. Do not remove it.**

**It is a layer, never a Modal.** `DocumentViewer` is already rendered inline inside `DocumentReviewScreen`'s Modal. A Modal presented from inside a Modal is what strands an invisible view controller on iOS and kills every touch on the screen underneath.

**Do not `import` from `expo-ocr-kit`.** Its index re-exports a native *view*, and `requireNativeView` runs at module scope — the import itself throws in Expo Go. Bind the module with `requireOptionalNativeModule('ExpoOcrKit')` instead, which returns null.

**Line repairs are safe only because they are checked.** OCR drops a filler character often enough that a strict reader fails on real passports. `findMrzCandidates` produces several plausible repairs and `readPassportText` keeps the one the check digits vouch for. A bad guess loses to a good one, or fails visibly. Never accept a repair without validating it.

**Fields stay editable even on a perfect read.** A read is a guess about a photo taken on a kitchen table. A screen that shows a failure and offers no way forward sends the operator back to squinting and retyping, which is the thing this replaces.

**Two-digit years.** A birth year above this year's is last century; an expiry is always this century. The one case this gets wrong is someone aged exactly 100.

---

## 7. Before it works

1. **Native rebuild.** `expo-ocr-kit` is a native module.
   - iOS: `npx pod-install`, then build. **No `expo prebuild`** — the Podfile already has `use_expo_modules!`, and a prebuild would fight the committed native projects.
   - Android: Gradle autolinks it; just build.
2. **Not visible in Expo Go.** The button appears and explains itself rather than doing nothing.
3. **Test on a real passport photo.** The unit tests prove the parsing; only a device proves the recognition. Try a good photo, a dim one, and one where the bottom of the page is cut off.

---

## 8. Open

- **Passport expiry warning.** Many countries want a passport valid six months past the return date. We now read the expiry date — comparing it to the trip's end date is a small addition and a real one. Not built.
- **Desktop dashboard.** The operator dashboard shows passports too and has no equivalent. Browsers have no free offline OCR worth using, so it would mean a different approach there.
- ~~**Should the traveler get this too?**~~ **Decided yes, 3 August.** A traveler filling in an airline booking retypes the same seven fields off the same photo. It is their own passport, and nothing is stored either way, so there is no new exposure. `TripDetailScreen` passes `isPassport` on the traveler's own viewer; `viewingDocPath` became `viewingDoc` so the kind travels with the path.
