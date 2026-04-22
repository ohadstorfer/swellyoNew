/**
 * Builds the shared map-picker HTML string for WebView (native) and iframe (web).
 * Uses Google Maps JavaScript API + Places for search and place selection.
 * Sends PLACE_SELECTED via window.ReactNativeWebView.postMessage (native) or window.parent.postMessage (web).
 */

function escapeForHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeForJsString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

export function getMapPickerHtml(apiKey: string, destinationCountry?: string): string {
  const safeKey = escapeForHtml(apiKey);
  const countryJs = destinationCountry ? escapeForJsString(destinationCountry) : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pick a place</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, sans-serif; }
    #map { width: 100%; height: 100vh; }
    #search-row {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      padding: 12px;
      background: #fff;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      z-index: 10;
      display: flex;
      gap: 8px;
      align-items: center;
    }
    #search-input {
      flex: 1;
      padding: 12px 16px;
      font-size: 16px;
      border: 1px solid #ddd;
      border-radius: 8px;
    }
    #select-btn {
      padding: 12px 20px;
      font-size: 16px;
      font-weight: 600;
      color: #fff;
      background: #1a73e8;
      border: none;
      border-radius: 8px;
      cursor: pointer;
    }
    #select-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    #done-btn {
      padding: 12px 20px;
      font-size: 16px;
      color: #1a73e8;
      background: transparent;
      border: 1px solid #1a73e8;
      border-radius: 8px;
      cursor: pointer;
    }
    #selected-name { font-size: 14px; color: #333; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  </style>
</head>
<body>
  <div id="search-row">
    <input type="text" id="search-input" placeholder="Search for a place..." autocomplete="off" />
    <span id="selected-name"></span>
    <button type="button" id="select-btn" disabled>Select this place</button>
    <button type="button" id="done-btn">Done</button>
  </div>
  <div id="map"></div>
  <script>
    (function() {
      var API_KEY = '${safeKey}';
      var destinationCountry = ${countryJs ? `'${countryJs}'` : 'null'};

      function send(payload) {
        var json = JSON.stringify(payload);
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(json);
        } else if (window.parent !== window) {
          window.parent.postMessage(json, '*');
        }
      }

      var map, marker, selectedPlace = null;

      function initMap() {
        var defaultCenter = { lat: 20, lng: 0 };
        map = new google.maps.Map(document.getElementById('map'), {
          center: defaultCenter,
          zoom: 2,
          mapTypeControl: true,
          fullscreenControl: true,
          zoomControl: true,
        });

        marker = new google.maps.Marker({ map: map, visible: false });

        var input = document.getElementById('search-input');
        var autocompleteOpts = { types: ['establishment', 'geocode'] };
        if (destinationCountry && destinationCountry.length === 2) {
          autocompleteOpts.componentRestrictions = { country: destinationCountry };
        }
        var autocomplete = new google.maps.places.Autocomplete(input, autocompleteOpts);
        autocomplete.bindTo('bounds', map);

        autocomplete.addListener('place_changed', function() {
          var place = autocomplete.getPlace();
          if (!place.geometry || !place.geometry.location) return;
          map.panTo(place.geometry.location);
          map.setZoom(14);
          marker.setPosition(place.geometry.location);
          marker.setVisible(true);
          selectedPlace = {
            name: place.name || place.formatted_address || 'Selected place',
            placeId: place.place_id || '',
            lat: place.geometry.location.lat(),
            lng: place.geometry.location.lng()
          };
          document.getElementById('selected-name').textContent = selectedPlace.name;
          document.getElementById('select-btn').disabled = false;
        });

        map.addListener('click', function(e) {
          var latLng = e.latLng;
          if (!latLng) return;
          marker.setPosition(latLng);
          marker.setVisible(true);
          var geocoder = new google.maps.Geocoder();
          geocoder.geocode({ location: latLng }, function(results, status) {
            var name = 'Selected location';
            if (status === 'OK' && results && results[0]) {
              name = results[0].formatted_address || results[0].geometry.location.toString();
            }
            selectedPlace = {
              name: name,
              placeId: '',
              lat: latLng.lat(),
              lng: latLng.lng()
            };
            document.getElementById('selected-name').textContent = name;
            document.getElementById('select-btn').disabled = false;
          });
        });

        document.getElementById('select-btn').addEventListener('click', function() {
          if (selectedPlace) {
            send({ type: 'PLACE_SELECTED', place: selectedPlace });
          }
        });

        document.getElementById('done-btn').addEventListener('click', function() {
          send({ type: 'PLACE_PICKER_DONE' });
        });
      }

      function loadScript() {
        var script = document.createElement('script');
        script.src = 'https://maps.googleapis.com/maps/api/js?key=' + API_KEY + '&libraries=places&callback=initMap';
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      window.initMap = initMap;
      loadScript();
    })();
  </script>
</body>
</html>`;
}

/** Region code (e.g. 'us', 'cr') to approximate country center for initial map view. */
export const COUNTRY_CENTERS: Record<string, { lat: number; lng: number }> = {
  us: { lat: 39.5, lng: -98.5 },
  cr: { lat: 9.7, lng: -83.9 },
  ni: { lat: 12.9, lng: -85.2 },
  pa: { lat: 8.5, lng: -80.0 },
  sv: { lat: 13.8, lng: -88.9 },
  id: { lat: -2.0, lng: 118.0 },
  lk: { lat: 7.9, lng: 80.8 },
  ph: { lat: 12.9, lng: 121.8 },
  au: { lat: -25.3, lng: 133.8 },
  mx: { lat: 23.6, lng: -102.6 },
  br: { lat: -14.2, lng: -51.9 },
  pt: { lat: 39.4, lng: -8.2 },
  fr: { lat: 46.2, lng: 2.2 },
  es: { lat: 40.5, lng: -3.7 },
  za: { lat: -30.6, lng: 22.9 },
  ma: { lat: 31.8, lng: -7.1 },
  il: { lat: 31.5, lng: 34.8 },
  jp: { lat: 36.2, lng: 138.3 },
  nz: { lat: -40.9, lng: 174.9 },
  pe: { lat: -9.2, lng: -75.0 },
  ec: { lat: -1.8, lng: -78.2 },
  cl: { lat: -35.7, lng: -71.5 },
};

export interface InlineMapOptions {
  countryCenter?: { lat: number; lng: number };
  zoom?: number;
}

/**
 * Inline map HTML: static country-zoomed map, no interactive UI.
 * The prediction list + place selection are owned by RN above this WebView —
 * keeping the WebView tap-free ensures it can never become first responder
 * and steal focus from the native TextInput (which would dismiss the IME).
 */
export function getMapPickerInlineHtml(
  apiKey: string,
  regionCode?: string,
  options?: InlineMapOptions
): string {
  const safeKey = escapeForHtml(apiKey);
  const center = options?.countryCenter || (regionCode ? COUNTRY_CENTERS[regionCode] : null) || { lat: 20, lng: 0 };
  const zoom = options?.zoom ?? 5;
  const centerLat = center.lat;
  const centerLng = center.lng;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Map</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; font-family: system-ui, sans-serif; }
    #map { width: 100%; height: 100%; position: absolute; left: 0; top: 0; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    (function() {
      var API_KEY = '${safeKey}';
      var initialCenter = { lat: ${centerLat}, lng: ${centerLng} };
      var initialZoom = ${zoom};

      function send(payload) {
        var json = JSON.stringify(payload);
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(json);
        } else if (window.parent !== window) {
          window.parent.postMessage(json, '*');
        }
      }

      function initMap() {
        new google.maps.Map(document.getElementById('map'), {
          center: initialCenter,
          zoom: initialZoom,
          mapTypeControl: false,
          fullscreenControl: false,
          zoomControl: true,
          streetViewControl: false,
          disableDefaultUI: false,
          gestureHandling: 'greedy',
        });
      }

      window.gm_authFailure = function() {
        send({ type: 'MAP_ERROR', error: 'gm_authFailure', message: 'Google Maps auth failure - API key rejected' });
      };
      window.addEventListener('error', function(e) {
        if (e.filename && e.filename.indexOf('maps.googleapis.com') !== -1) {
          send({ type: 'MAP_ERROR', error: 'script_load_error', message: e.message || 'Maps script failed to load' });
        }
      });

      function loadScript() {
        var script = document.createElement('script');
        script.src = 'https://maps.googleapis.com/maps/api/js?key=' + API_KEY + '&libraries=places&callback=initMap';
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      window.initMap = initMap;
      loadScript();
    })();
  </script>
</body>
</html>`;
}
