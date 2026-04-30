---
name: Google Places API — Display Fields and Short Name Formatting
description: Which field to use for compact place display (name, formatted_address, vicinity, structured_formatting, address_components); how to derive "Ocean Beach, San Diego"-style labels
type: reference
---

## Field comparison

| Field | Contains | Example |
|---|---|---|
| `name` / `displayName` | Place's own name only, no address | "Ocean Beach" |
| `formatted_address` | Full readable address incl. state + country | "Ocean Beach, San Diego, CA, USA" |
| `vicinity` | Street + locality, NO state/province/country | "Newport Ave, Ocean Beach" |
| `structured_formatting.main_text` | Autocomplete only — place's primary name | "Ocean Beach" |
| `structured_formatting.secondary_text` | Autocomplete only — disambiguating context | "San Diego, CA, USA" |
| `address_components` | Structured array of each part with types | See below |

## Cleanest way to get "Ocean Beach, San Diego"

1. **From Autocomplete response**: Use `structured_formatting.main_text` + first segment of `secondary_text` (split on ", " and take [0]).
   - `main_text` = "Ocean Beach"
   - `secondary_text` = "San Diego, CA, USA" → split → "San Diego"
   - Result: "Ocean Beach, San Diego"

2. **From Place Details response**: Concatenate from `address_components`:
   - Look for type `sublocality_level_1` or `neighborhood` → "Ocean Beach"
   - Look for type `locality` → "San Diego"
   - Result: "Ocean Beach, San Diego"
   - Skip `administrative_area_level_1` (state) and `country`

3. **Using `name` alone**: Returns just "Ocean Beach" — use `name` + locality component for the "X, City" pattern.

## No API-side shortening option
Google has no "short" format parameter. All trimming is always done on the client.

## Regional gotchas for address_components
- UK / Sweden: city is `postal_town`, not `locality`
- NYC boroughs: city is `sublocality_level_1` (e.g. "Brooklyn"), no `locality`
- Australia: state abbreviation in `administrative_area_level_1.short_name` (e.g. "NSW" not "New South Wales")

## Localization
Google returns address parts in the user's locale by default (based on browser language or `language` request param). This is generally fine — just be aware that place names and component values will vary by locale. You can override with `language=en` in the API request if you need consistent English output.

## UI pattern for tight slots
- Show `name` (most specific part) as primary, city as secondary in smaller font
- Or show `main_text` only (from autocomplete), city on second line
- For single-line display: `name + ", " + locality` with numberOfLines=1 + ellipsizeMode="tail"
- Most apps (Airbnb, Booking) use two-line display rather than cramming everything on one line
- If single line is required: show only `main_text` / `name`, drop city entirely for <20 char slots

## Sources
- Google Places API Legacy Docs: https://developers.google.com/maps/documentation/places/web-service/legacy/details
- Google Places API New: https://developers.google.com/maps/documentation/places/web-service/place-details
- Structured formatting: https://developers.google.com/maps/documentation/places/web-service/legacy/autocomplete
- Parsing address_components: https://medium.com/@almestaadmicadiab/how-to-parse-google-maps-address-components-geocoder-response-774d1f3375d
