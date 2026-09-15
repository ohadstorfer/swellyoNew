/* ═══════════════════════════════════════════════════════════════════════════
   CRM
   ═══════════════════════════════════════════════════════════════════════════ */
function viewCRM(){
  const tabs = [['opportunities','Opportunities'],['contacts','Contacts'],['fields','Fields'],['templates','Email Templates']];
  const body = { opportunities:crmOpps, contacts:crmContacts, fields:crmFields, templates:crmTemplates }[S.crmTab]();
  return topbar([{t:'CRM'},{t:tabs.find(x=>x[0]===S.crmTab)[1]}]) + `<div class="view">
    <div class="view-head"><div><h1>CRM</h1>
      <p>Everyone who has ever asked about a trip, and every deal that came out of it.</p></div></div>
    <div class="tabs">${tabs.map(([id,l])=>`<button class="tab" aria-selected="${S.crmTab===id}"
      onclick="S.crmTab='${id}';render()">${l}</button>`).join('')}</div>
    ${body}</div>`;
}

function crmOpps(){
  const open = DB.opportunities.filter(o=>o.stage!=='Booked');
  const won  = DB.opportunities.filter(o=>o.stage==='Booked');
  return `<div class="grid-4" style="margin-bottom:16px">
      ${statCard('Open opportunities', open.length, 'Not yet booked')}
      ${statCard('Open value', money0(open.reduce((n,o)=>n+o.value,0),'USD'), 'If every one converted')}
      ${statCard('Converted', won.length, money0(won.reduce((n,o)=>n+o.value,0),'USD')+' booked','var(--ok)')}
      ${statCard('From abandoned checkouts', DB.opportunities.filter(o=>o.source==='Abandoned Checkout').length,
        'People who reached payment and stopped','var(--warn)')}
    </div>
    <div style="display:flex;gap:9px;margin-bottom:14px;align-items:center">
      <div class="seg"><button aria-pressed="true">Board</button><button aria-pressed="false" onclick="toast('List view shows the same records as a table.')">List</button></div>
      <span style="font-size:12.5px;color:var(--muted)">Click a card to move it along.</span>
    </div>
    <div class="kanban">${DB.stages.map(st=>{
      const os = DB.opportunities.filter(o=>o.stage===st.name);
      return `<div class="kcol">
        <div class="kcol-head"><span class="dot" style="background:${st.color}"></span>
          <h4 style="color:${st.color}">${esc(st.name)}</h4>
          <span class="count">${os.length}</span>
          ${st.locked?`<span title="This stage can't be renamed or removed" style="color:var(--muted);font-size:11px">locked</span>`:''}</div>
        ${os.map(o=>{ const c = contact(o.contact);
          return `<div class="kcard" onclick="advanceOpp('${o.id}')">
            <h5>${esc(o.title)}</h5>
            <div class="who"><span class="av av-sm">${initials(c.name)}</span>${esc(c.name)}</div>
            <div class="foot"><span class="pill" style="font-size:10.5px">${esc(o.source)}</span>
              <span style="margin-left:auto" class="tnum">${money0(o.value, trip(o.trip)?.cur||'USD')}</span></div>
            <div style="font-size:11px;color:var(--muted);margin-top:6px">${relDays(o.lastAct)}</div>
          </div>`;}).join('') || '<div style="font-size:12px;color:var(--muted);padding:10px 3px">Nothing here.</div>'}
      </div>`;}).join('')}</div>
    <div class="note" style="margin-top:16px">An opportunity goes quiet after <b>90 days</b> with no
      activity and closes itself. A fresh enquiry then opens a new one rather than reviving the old —
      which keeps the board honest but loses the thread.</div>`;
}

function crmContacts(){
  return `<div class="card"><div class="card-head"><h3>Contacts</h3><span class="pill">${DB.contacts.length}</span>
      <div class="spacer"></div>
      <div class="search" style="max-width:250px">${ICON.search}<input type="text" placeholder="Name, email or phone"></div>
      <button class="btn btn-sm">More actions ${ICON.chev}</button>
      <button class="btn btn-sm btn-primary">${ICON.plus} Create contact</button></div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Name</th><th>Where from</th><th>Tags</th><th class="num">Trips</th>
        <th class="num">Booked</th><th>Last booking</th><th>Source</th></tr></thead>
      <tbody>${DB.contacts.map(c=>`<tr>
        <td><div style="display:flex;align-items:center;gap:9px"><span class="av av-sm">${initials(c.name)}</span>
          <div><button class="linky" onclick="go('contact',{contactId:'${c.id}'})">${esc(c.name)}</button>
            <div style="font-size:11.5px;color:var(--muted)">${esc(c.email)}</div></div></div></td>
        <td>${esc(c.country)}</td>
        <td>${c.tags.map(t=>`<span class="pill" style="margin-right:4px">${esc(t)}</span>`).join('')}</td>
        <td class="num tnum">${c.trips||'—'}</td>
        <td class="num tnum">${c.booked?money0(c.booked,'USD'):'—'}</td>
        <td>${c.lastBooking?fmtShort(c.lastBooking):'<span style="color:var(--muted)">Never</span>'}</td>
        <td style="font-size:12px;color:var(--muted)">${esc(c.source)}</td></tr>`).join('')}</tbody></table></div></div>`;
}

function viewContact(){
  const c = contact(S.contactId);
  const bs = DB.bookings.filter(b=>b.email===c.email);
  const os = DB.opportunities.filter(o=>o.contact===c.id);
  const acts = [
    ...bs.map(b=>({d:b.booked, t:'Booked', s:`${trip(b.trip).name} — ${money0(bookingTotal(b),trip(b.trip).cur)}`})),
    ...bs.flatMap(b=>b.sched.filter(r=>r.status==='paid').map(r=>({d:r.paidOn,t:'Paid',s:`${r.label} — ${money(r.amount,trip(b.trip).cur)}`}))),
    ...os.map(o=>({d:o.lastAct, t:'Enquiry', s:o.title})),
  ].sort((a,b)=>a.d<b.d?1:-1);

  return topbar([{t:'CRM',go:"go('crm')"},{t:'Contacts',go:"go('crm',{crmTab:'contacts'})"},{t:c.name}]) + `<div class="view">
    <button class="btn btn-ghost btn-sm" style="margin-bottom:12px" onclick="go('crm',{crmTab:'contacts'})">${ICON.back} All contacts</button>
    <div style="display:flex;gap:16px;align-items:center;margin-bottom:18px;flex-wrap:wrap">
      <span class="av av-lg">${initials(c.name)}</span>
      <div style="flex:1;min-width:200px"><h1 style="font-size:21px;font-weight:700">${esc(c.name)}</h1>
        <div style="color:var(--muted);font-size:13px;margin-top:4px">${esc(c.email)} · ${esc(c.phone)} · ${esc(c.country)}</div>
        <div style="margin-top:8px">${c.tags.map(t=>`<span class="pill pill-accent" style="margin-right:5px">${esc(t)}</span>`).join('')}</div></div>
      <button class="btn btn-primary">Send an email</button>
    </div>
    <div class="grid-4" style="margin-bottom:18px">
      ${statCard('Trips booked', c.trips||0, c.trips?'Across all time':'Never booked')}
      ${statCard('Total booked', money0(c.booked,'USD'), 'Lifetime value')}
      ${statCard('Last booking', c.lastBooking?fmtShort(c.lastBooking):'—', c.lastBooking?relDays(c.lastBooking):'No bookings')}
      ${statCard('First heard from', esc(c.source), 'How they found you')}
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><h3>Activity</h3></div><div class="card-pad">
        ${acts.length?acts.map(a=>`<div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)">
          <span class="pill ${a.t==='Paid'?'pill-ok':a.t==='Booked'?'pill-accent':''}" style="flex:none">${esc(a.t)}</span>
          <div style="flex:1;font-size:13px">${esc(a.s)}</div>
          <span style="font-size:12px;color:var(--muted);white-space:nowrap">${fmtShort(a.d)}</span></div>`).join('')
          :'<div class="empty"><p>There hasn\'t been any activity yet on this contact.</p></div>'}
      </div></div>
      <div>
        <div class="card"><div class="card-head"><h3>Trips</h3></div><div class="card-pad">
          ${bs.length?bs.map(b=>{const t=trip(b.trip);return `
            <div style="display:flex;gap:11px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line)">
              <div class="trip-thumb" style="width:52px;height:38px;background:${t.art}"></div>
              <div style="flex:1"><b style="font-size:13px">${esc(t.name)}</b>
                <div style="font-size:12px;color:var(--muted)">${fmtRange(t.start,t.end)}</div></div>
              <span class="pill pill-${bookingStatus(b).k}">${bookingStatus(b).t}</span></div>`;}).join('')
            :'<div style="font-size:13px;color:var(--muted)">No bookings yet.</div>'}
        </div></div>
        ${c.notes?`<div class="card" style="margin-top:16px"><div class="card-head"><h3>Notes</h3></div>
          <div class="card-pad"><p style="margin:0;font-size:13px;color:var(--text-2);line-height:1.6">${esc(c.notes)}</p></div></div>`:''}
      </div>
    </div>
  </div>`;
}

function crmFields(){
  const fields = [
    ['Surf level','Dropdown','Contacts + Opportunities'],['Home break','Text Answer','Contacts'],
    ['Board volume','Number','Contacts'],['How they heard about us','Dropdown','Opportunities'],
    ['Group size','Number','Opportunities'],
  ];
  return `<div class="card"><div class="card-head"><h3>Fields</h3><div class="spacer"></div>
      <button class="btn btn-sm btn-primary">${ICON.plus} Add contact field</button></div>
    <div class="tbl-wrap"><table><thead><tr><th>Field</th><th>Type</th><th>Shows on</th><th></th></tr></thead>
      <tbody>${fields.map(([n,t,w])=>`<tr><td><b>${esc(n)}</b></td><td>${esc(t)}</td>
        <td style="color:var(--muted)">${esc(w)}</td>
        <td class="num"><button class="icon-btn">${ICON.dots}</button></td></tr>`).join('')}</tbody></table></div></div>
  <div class="note" style="margin-top:16px">Forms are assembled by dragging these fields in. You cannot
    write a new question from inside a form — the field has to exist here first. One contact form and one
    trip enquiry form per account, shared by every trip.</div>`;
}

function crmTemplates(){
  const tpl = [['Deposit received','Thanks — you are on the Bali trip'],
               ['Two weeks out','Packing list and arrival details'],
               ['Payment failed','Your card was declined — here is a new link'],
               ['Post-trip','How was it? And a photo link']];
  return `<div class="card"><div class="card-head"><h3>Email Templates</h3><div class="spacer"></div>
    <button class="btn btn-sm btn-primary">${ICON.plus} Create template</button></div>
    <div class="tbl-wrap"><table><thead><tr><th>Template</th><th>Subject</th><th></th></tr></thead>
      <tbody>${tpl.map(([n,s])=>`<tr><td><b>${esc(n)}</b></td><td style="color:var(--muted)">${esc(s)}</td>
        <td class="num"><button class="icon-btn">${ICON.dots}</button></td></tr>`).join('')}</tbody></table></div></div>
  <div class="note" style="margin-top:16px">Templates take a small set of dynamic fields — recipient name,
    trip name, dates — and that set is fixed. Everything the platform sends automatically (receipts,
    reminders, the waiver request) is <b>not</b> editable at all.</div>`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   INVENTORY · NETWORK · ITINERARIES · SETTINGS
   ═══════════════════════════════════════════════════════════════════════════ */
function viewInventory(){
  const res = [
    ['Bingin Beach Villas','Accommodation','12 beds','Sep 12–19','8 assigned'],
    ['Camp vans','Transport','2 × 8-seat','Sep 12–19','Both in use'],
    ['Soft-tops','Boards','10','Sep 12–19','6 out on rental'],
    ['Performance shortboards','Boards','8','Sep 12–19','3 out'],
  ];
  return topbar([{t:'Inventory'}]) + `<div class="view">
    <div class="view-head"><div><h1>Inventory</h1>
      <p>The things a trip consumes that are not spots: beds, vans and boards.</p></div></div>
    <div class="card"><div class="tbl-wrap"><table>
      <thead><tr><th>Resource</th><th>Kind</th><th>Capacity</th><th>Held for</th><th>Status</th></tr></thead>
      <tbody>${res.map(([a,b,c,d,e])=>`<tr><td><b>${esc(a)}</b></td><td>${esc(b)}</td>
        <td class="tnum">${esc(c)}</td><td>${esc(d)}</td><td><span class="pill pill-accent">${esc(e)}</span></td></tr>`).join('')}
      </tbody></table></div></div></div>`;
}

function viewNetwork(){
  return topbar([{t:'Network'}]) + `<div class="view">
    <div class="view-head"><div><h1>Network</h1>
      <p>Other operators and suppliers on the platform. Useful when you need a villa in a town you have never worked in.</p></div></div>
    <div class="grid-3">
      ${[['Casa do Mar Ericeira','Accommodation · Portugal','Verified'],
         ['Bukit Transfers','Transport · Bali','Verified'],
         ['Taghazout Surf House','Accommodation · Morocco','Not connected']].map(([n,d,s])=>`
        <div class="card"><div class="card-pad">
          <span class="av av-lg" style="margin-bottom:11px">${initials(n)}</span>
          <h3 style="font-size:14.5px">${esc(n)}</h3>
          <div style="font-size:12.5px;color:var(--muted);margin-top:4px">${esc(d)}</div>
          <div style="margin-top:11px;display:flex;gap:8px;align-items:center">
            <span class="pill ${s==='Verified'?'pill-ok':''}">${esc(s)}</span>
            <button class="btn btn-sm" style="margin-left:auto">Message</button></div>
        </div></div>`).join('')}
    </div></div>`;
}

function viewItineraries(){
  return topbar([{t:'Itineraries'}]) + `<div class="view">
    <div class="view-head"><div><h1>Itineraries</h1>
      <p>Day-by-day documents you can send before anyone has booked anything.</p></div></div>
    <div class="card empty"><h4>Itineraries live apart from trips</h4>
      <p>They are proposals: a shareable day-by-day plan with no packages, no prices and no checkout.
      Operators regularly ask for the two to be merged, because maintaining the same week in two places is
      how the two drift apart.</p></div></div>`;
}

function viewSettings(){
  const tabs = [['fees','Fees'],['discounts','Discounts'],['team','Team'],['brand','Branding'],['integrations','Integrations']];
  const body = { fees:setFees, discounts:setDiscounts, team:setTeam, brand:setBrand, integrations:setIntegrations }[S.settingsTab]();
  return topbar([{t:'Business settings'},{t:tabs.find(x=>x[0]===S.settingsTab)[1]}]) + `<div class="view">
    <div class="view-head"><div><h1>Business settings</h1>
      <p>Account-wide defaults. Anything set on a trip beats what is set here.</p></div></div>
    <div class="tabs">${tabs.map(([id,l])=>`<button class="tab" aria-selected="${S.settingsTab===id}"
      onclick="S.settingsTab='${id}';render()">${l}</button>`).join('')}</div>
    ${body}</div>`;
}

function setFees(){
  const f = FEES.USD;
  return `<div class="card"><div class="card-head"><h3>What it costs to take a payment</h3></div>
    <div class="tbl-wrap"><table><thead><tr><th>Method</th><th class="num">USD trips</th><th class="num">EUR trips</th><th>Clears in</th></tr></thead>
      <tbody>
        <tr><td>${ICON.bank} Bank transfer (ACH, SEPA)</td><td class="num"><b style="color:var(--ok)">0%</b></td><td class="num"><b style="color:var(--ok)">0%</b></td><td>5–7 business days</td></tr>
        <tr><td>${ICON.card} Visa / Mastercard</td><td class="num tnum">${f.card}%</td><td class="num tnum">${FEES.EUR.card}%</td><td>Instantly</td></tr>
        <tr><td>${ICON.card} American Express</td><td class="num tnum">${f.amex}%</td><td class="num tnum">${FEES.EUR.amex}%</td><td>Instantly</td></tr>
        <tr><td>Apple Pay / Google Pay</td><td class="num tnum">${f.wallet}%</td><td class="num tnum">${FEES.EUR.wallet}%</td><td>Instantly</td></tr>
        <tr><td>Card issued outside the region</td><td class="num tnum">${f.intl}%</td><td class="num tnum">${FEES.EUR.intl}%</td><td>Instantly</td></tr>
        <tr><td>Wire transfer</td><td class="num tnum">$${f.wire} flat</td><td class="num tnum">€${FEES.EUR.wire} flat</td><td>3–5 business days</td></tr>
      </tbody></table></div></div>

  <div class="grid-2" style="margin-top:16px">
    <div class="card"><div class="card-head"><h3>Platform fee</h3></div><div class="card-pad">
      <div class="field"><label>Rate</label>
        <div style="display:flex;gap:9px;align-items:center">
          <input type="number" step="0.1" value="${DB.settings.platformFeePct}" style="max-width:100px"
            onchange="DB.settings.platformFeePct=parseFloat(this.value)||0;render();toast('Platform fee set to <b>'+DB.settings.platformFeePct+'%</b>. Every total on the site just moved.')">
          <span style="font-size:13px;color:var(--muted)">% per transaction, minimum ${money(DB.settings.platformFeeMin,'USD')}</span></div>
        <div class="hint">Shown to travellers as a <b>service fee</b>, and to you as the platform fee.
          Never charged on wire transfers, on payment plans, or on cash you record yourself.</div></div>
      <div class="note" style="margin-bottom:0">In the real product this percentage is not published
        anywhere — only the ${money(1.5,'USD')} minimum is. It is left editable here so you can see what
        different rates do to a booking.</div>
    </div></div>
    <div class="card"><div class="card-head"><h3>Default fee treatment</h3></div><div class="card-pad">
      <div class="field"><label>Processing fees paid by</label>
        <div style="display:grid;gap:6px">
          <label class="radio-row ${DB.settings.paymentFeesPaidBy==='organizer'?'on':''}"><input type="radio" name="gpf" ${DB.settings.paymentFeesPaidBy==='organizer'?'checked':''} onchange="setFee('paymentFeesPaidBy','organizer')"> You absorb them</label>
          <label class="radio-row ${DB.settings.paymentFeesPaidBy==='participant'?'on':''}"><input type="radio" name="gpf" ${DB.settings.paymentFeesPaidBy==='participant'?'checked':''} onchange="setFee('paymentFeesPaidBy','participant')"> The traveller pays them</label>
        </div></div>
      <div class="field"><label>Platform fee paid by</label>
        <div style="display:grid;gap:6px">
          <label class="radio-row ${DB.settings.wtFeePaidBy==='organizer'?'on':''}"><input type="radio" name="gwf" ${DB.settings.wtFeePaidBy==='organizer'?'checked':''} onchange="setFee('wtFeePaidBy','organizer')"> You absorb it</label>
          <label class="radio-row ${DB.settings.wtFeePaidBy==='participant'?'on':''}"><input type="radio" name="gwf" ${DB.settings.wtFeePaidBy==='participant'?'checked':''} onchange="setFee('wtFeePaidBy','participant')"> The traveller pays it</label>
        </div></div>
    </div></div>
  </div>`;
}

function setDiscounts(){
  return `<div class="card"><div class="card-head"><h3>Discount codes</h3><div class="spacer"></div>
    <button class="btn btn-sm btn-primary">${ICON.plus} Create discount</button></div>
    <div class="tbl-wrap"><table><thead><tr><th>Code</th><th>Value</th><th>Applies to</th><th class="num">Used</th><th>Runs until</th></tr></thead>
      <tbody>${DB.discounts.map(d=>`<tr>
        <td><b style="font-family:var(--mono);font-size:12.5px">${esc(d.code)}</b></td>
        <td>${d.type==='percentage'?d.amount+'% off':money0(d.amount,'USD')+' off'}</td>
        <td style="color:var(--muted)">${esc(d.scope)}</td>
        <td class="num tnum">${d.used}${d.cap?' / '+d.cap:''}</td>
        <td>${fmtShort(d.until)}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="note" style="margin-top:16px">A discount comes off the <b>balance</b>, never the deposit —
    so the traveller pays the same amount today and less later. One code per booking, no stacking.</div>`;
}

function setTeam(){
  return `<div class="card"><div class="card-head"><h3>Team</h3><span class="pill pill-accent">No per-seat charge</span>
    <div class="spacer"></div><button class="btn btn-sm btn-primary">${ICON.plus} Invite</button></div>
    <div class="tbl-wrap"><table><thead><tr><th>Person</th><th>Role</th><th>Can do</th><th></th></tr></thead>
      <tbody>${DB.team.map(m=>`<tr>
        <td><div style="display:flex;align-items:center;gap:9px"><span class="av av-sm">${initials(m.name)}</span>
          <div><b>${esc(m.name)}</b><div style="font-size:11.5px;color:var(--muted)">${esc(m.email)}</div></div></div></td>
        <td><span class="pill ${m.role==='Owner'?'pill-accent':''}">${esc(m.role)}</span></td>
        <td style="color:var(--muted)">${esc(m.perms)}</td>
        <td class="num"><button class="icon-btn">${ICON.dots}</button></td></tr>`).join('')}</tbody></table></div></div>`;
}

function setBrand(){
  return `<div class="card"><div class="card-head"><h3>Branding</h3></div><div class="card-pad">
    <div class="field"><label>Your booking address</label>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="text" value="${DB.operator.subdomain}" style="max-width:220px">
        <span style="font-family:var(--mono);font-size:13px;color:var(--muted)">.swellyo.com</span></div>
      <div class="hint">A subdomain, not your own domain. Booking pages, the traveller's account and every
        automated email carry your name instead of the platform's.</div></div>
    <label class="switch"><input type="checkbox" checked><span><span class="sw-l">Use my logo on emails and checkout</span></span></label>
    <label class="switch"><input type="checkbox" checked><span><span class="sw-l">Link my own terms in checkout</span>
      <span class="sw-d">Travellers agree to them by clicking Confirm — there is no separate tick box.</span></span></label>
  </div></div>`;
}

function setIntegrations(){
  const rows = [['Analytics','A tag ID, pasted in','Connected'],
    ['Ad pixel','A snippet for your own site, not this one','Not set up'],
    ['Accounting','A CSV export, not a live sync','CSV only'],
    ['Automations','Trigger-only — this platform starts flows, never receives them','Connected'],
    ['Webhooks','booking.created, payment.created, trip.published','3 endpoints'],
    ['API','Read and write trips, orders, plans and questions','Key issued']];
  return `<div class="card"><div class="card-head"><h3>Integrations</h3><span class="pill pill-accent">Pro</span></div>
    <div class="tbl-wrap"><table><thead><tr><th>What</th><th>How it actually works</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map(([a,b,c])=>`<tr><td><b>${esc(a)}</b></td><td style="color:var(--muted)">${esc(b)}</td>
        <td><span class="pill ${c==='Connected'?'pill-ok':''}">${esc(c)}</span></td>
        <td class="num"><button class="btn btn-sm">Manage</button></td></tr>`).join('')}</tbody></table></div></div>
  <div class="note" style="margin-top:16px">Worth reading the middle column. There is no live accounting
    sync and no way for an outside system to push a booking in — every integration points outward.</div>`;
}
