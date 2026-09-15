/* ═══════════════════════════════════════════════════════════════════════════
   ICONS + SHELL
   ═══════════════════════════════════════════════════════════════════════════ */
const I = (d,sz=16,extra='') =>
  `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

const ICON = {
  trips:   I('<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z"/><path d="M9 3v15M15 6v15"/>'),
  itin:    I('<path d="M4 6h10M4 12h16M4 18h7"/><circle cx="18" cy="6" r="2"/><circle cx="14" cy="18" r="2"/>'),
  crm:     I('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/>'),
  pay:     I('<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/>'),
  reports: I('<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>'),
  inv:     I('<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 12l9 5 9-5M3 16l9 5 9-5"/>'),
  net:     I('<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M12 7.5v4M10.2 13.4L7 15.9M13.8 13.4l3.2 2.5"/>'),
  cog:     I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a1.7 1.7 0 0 0-1.6-1H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 3 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 3V3a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 9h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1z"/>'),
  plus:    I('<path d="M12 5v14M5 12h14"/>'),
  chev:    I('<path d="M9 18l6-6-6-6"/>',14),
  search:  I('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',15),
  cal:     I('<rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M3 10h18M8 2.5v4M16 2.5v4"/>',14),
  users:   I('<path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/>',14),
  pin:     I('<path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',14),
  edit:    I('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',15),
  eye:     I('<path d="M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/>',15),
  dots:    I('<circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/>',15),
  bell:    I('<path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8z"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',16),
  down:    I('<path d="M12 3v13M6.5 11.5L12 17l5.5-5.5M4 20h16"/>',15),
  check:   I('<path d="M20 6L9 17l-5-5"/>',14),
  x:       I('<path d="M18 6L6 18M6 6l12 12"/>',14),
  grip:    I('<path d="M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01" stroke-width="2.4"/>',15),
  card:    I('<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/>',14),
  bank:    I('<path d="M3 10h18M5 10v8M19 10v8M9 10v8M15 10v8M2 21h20M12 3l9 5H3l9-5z"/>',14),
  file:    I('<path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/>',14),
  sign:    I('<path d="M3 18s3-1 5-5 4 6 6 3 3-3 7-3"/><path d="M3 21h18"/>',14),
  arrow:   I('<path d="M5 12h14M13 6l6 6-6 6"/>',14),
  back:    I('<path d="M19 12H5M11 6l-6 6 6 6"/>',16),
  globe:   I('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/>',14),
  warn:    I('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',14),
  phone:   I('<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>',14),
};

const NAV = [
  { id:'trips', label:'Trips', icon:'trips', kids:[
      { id:'trips',   label:'Upcoming Trips', count:()=>DB.trips.filter(t=>t.status==='upcoming').length },
      { id:'past',    label:'Past Trips' },
      { id:'draft',   label:'Draft Trips',  count:()=>DB.trips.filter(t=>t.status==='draft').length },
      { id:'deactivated',label:'Deactivated Trips' },
      { id:'archived',label:'Archived Trips' },
      { id:'joined',  label:'Trips I Joined' },
  ]},
  { id:'itineraries', label:'Itineraries', icon:'itin' },
  { id:'crm',      label:'CRM',      icon:'crm' },
  { id:'payments', label:'Payments', icon:'pay' },
  { id:'reports',  label:'Reports',  icon:'reports' },
  { id:'inventory',label:'Inventory',icon:'inv' },
  { id:'network',  label:'Network',  icon:'net' },
  { id:'settings', label:'Business settings', icon:'cog' },
];

const TRIP_VIEWS = ['trip','builder'];
const inTrips = v => ['trips','past','draft','archived','deactivated','joined',...TRIP_VIEWS].includes(v);

function shell(){
  const nav = NAV.map(n=>{
    if(n.kids){
      const open = S.navOpen.trips;
      const active = inTrips(S.view);
      return `<button class="nav-item" aria-expanded="${open}" ${active&&!open?'aria-current="page"':''}
                 onclick="S.navOpen.trips=!S.navOpen.trips;render()">
          ${ICON[n.icon]}<span>${n.label}</span><span class="chev">${ICON.chev}</span>
        </button>
        ${open ? `<div class="nav-sub">${n.kids.map(k=>`
          <button class="nav-item" ${S.view===k.id||(TRIP_VIEWS.includes(S.view)&&k.id==='trips')?'aria-current="page"':''}
            onclick="go('${k.id}')">${k.label}
            ${k.count&&k.count()?`<span class="count">${k.count()}</span>`:''}</button>`).join('')}</div>` : ''}`;
    }
    return `<button class="nav-item" ${S.view===n.id?'aria-current="page"':''} onclick="go('${n.id}')">
      ${ICON[n.icon]}<span>${n.label}</span></button>`;
  }).join('');

  return `<aside class="rail">
    <div class="rail-top">
      <div class="mark"><span class="mark-badge">${I('<path d="M2 15c2.5-2 4.5 2 7 0s4.5-2 7 0 4.5 2 6 0"/><path d="M2 10c2.5-2 4.5 2 7 0s4.5-2 7 0 4.5 2 6 0"/>',17)}</span>
        <span>Uluwatu Surf</span></div>
    </div>
    <button class="create" onclick="toast('A real product would open the trip builder here.')">${ICON.plus} Create new</button>
    <nav class="rail-scroll">${nav}</nav>
    <div class="rail-foot">
      <span class="av">OS</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:12.5px;font-weight:600">Ohad Storfer</div>
        <div style="font-size:11px;color:var(--muted)">Pro · $79/mo</div>
      </div>
      <button class="icon-btn" title="Notifications">${ICON.bell}</button>
    </div>
  </aside>`;
}

function topbar(crumbs, right=''){
  return `<div class="topbar">
    <div class="crumb">${crumbs.map((c,i)=>
      (i?'<span class="sep">/</span>':'') + (c.go
        ? `<button class="linky" style="font-weight:500;color:var(--muted)" onclick="${c.go}">${esc(c.t)}</button>`
        : `<b>${esc(c.t)}</b>`)).join('')}</div>
    <div class="topbar-right">
      ${right}
      <button class="btn btn-sm" onclick="go('traveller')">${ICON.phone} Traveller view</button>
    </div>
  </div>`;
}

function statCard(label, value, sub, tone='', tip=''){
  return `<div class="card stat">
    <div class="stat-l">${esc(label)}${tip?`<button class="q" title="${esc(tip)}">?</button>`:''}</div>
    <div class="stat-v" ${tone?`style="color:${tone}"`:''}>${value}</div>
    ${sub?`<div class="stat-s">${sub}</div>`:''}
  </div>`;
}

function render(){
  const app = $('#app');
  const body = S.view==='traveller' ? viewTraveller() : viewFor(S.view);
  app.innerHTML = S.view==='traveller'
    ? `<div class="main">${body}</div>`
    : `${shell()}<div class="main">${body}</div>`;
  app.style.gridTemplateColumns = S.view==='traveller' ? '1fr' : 'var(--rail) 1fr';
}

function viewFor(v){
  switch(v){
    case 'trips': case 'past': case 'draft': case 'archived':
    case 'deactivated': case 'joined': return viewTrips(v);
    case 'trip':       return viewTrip();
    case 'builder':    return viewBuilder();
    case 'crm':        return viewCRM();
    case 'contact':    return viewContact();
    case 'payments':   return viewPayments();
    case 'reports':    return viewReports();
    case 'inventory':  return viewInventory();
    case 'network':    return viewNetwork();
    case 'settings':   return viewSettings();
    case 'itineraries':return viewItineraries();
    default:           return viewTrips('trips');
  }
}
