/* ═══════════════════════════════════════════════════════════════════════════
   TRIPS
   ═══════════════════════════════════════════════════════════════════════════ */
function viewTrips(filter){
  const map = { trips:'upcoming', past:'past', draft:'draft', archived:'archived',
                deactivated:'deactivated', joined:'joined' };
  const want = map[filter] || 'upcoming';
  const title = { upcoming:'Upcoming Trips', past:'Past Trips', draft:'Draft Trips',
                  archived:'Archived Trips', deactivated:'Deactivated Trips', joined:'Trips I Joined' }[want];
  const list = DB.trips.filter(t=>t.status===want);
  const p = portfolio(S.cur);
  const nCur = DB.trips.filter(t=>t.status==='upcoming' && t.cur===S.cur).length;

  const rows = list.length ? list.map(t=>{
    const s = tripStats(t);
    const pct = Math.round(s.going / t.cap * 100);
    const flags = [];
    if(s.pastDue) flags.push(`<span class="pill pill-danger"><span class="dot"></span>${money0(s.pastDue,t.cur)} past due</span>`);
    if(s.failed)  flags.push(`<span class="pill pill-danger">${ICON.warn} Payment failed</span>`);
    if(s.unsigned)flags.push(`<span class="pill pill-warn">${s.unsigned} unsigned</span>`);
    return `<div class="trip-row">
      <div class="trip-thumb" style="background:${t.art}"></div>
      <div class="trip-meta">
        <h3>${esc(t.name)} ${t.tags.map(g=>`<span class="pill pill-accent">${esc(g)}</span>`).join('')}</h3>
        <div class="trip-facts">
          <span>${ICON.cal}${fmtRange(t.start,t.end)}</span>
          <span>${ICON.pin}${esc(t.dest)}</span>
          <span>${ICON.users}${s.going}/${t.cap} going</span>
          <span style="font-family:var(--mono);font-size:11.5px">${esc(t.tripId)}</span>
        </div>
        <div class="trip-money">
          <div><span class="l">Expected</span><b>${money0(s.expected,t.cur)}</b></div>
          <div><span class="l">Collected</span><b style="color:var(--ok)">${money0(s.paid,t.cur)}</b></div>
          <div><span class="l">Outstanding</span><b style="color:${s.pastDue?'var(--danger)':'var(--text)'}">${money0(s.balance,t.cur)}</b></div>
          <div style="flex:1;min-width:110px"><span class="l">Filled</span>
            <div class="fill" style="margin-top:6px"><i class="${pct>85?'hot':''}" style="width:${pct}%"></i></div></div>
        </div>
        ${flags.length?`<div style="display:flex;gap:6px;margin-top:9px;flex-wrap:wrap">${flags.join('')}</div>`:''}
      </div>
      <div class="trip-act">
        <div style="display:flex;gap:2px">
          <button class="icon-btn" title="Edit trip" onclick="go('builder',{tripId:'${t.id}'})">${ICON.edit}</button>
          <button class="icon-btn" title="View public page" onclick="go('traveller')">${ICON.eye}</button>
          <button class="icon-btn" title="More">${ICON.dots}</button>
        </div>
        <button class="btn btn-primary" onclick="go('trip',{tripId:'${t.id}',tripTab:'bookings'})">Manage Trip</button>
      </div>
    </div>`;
  }).join('') : `<div class="card empty"><h4>Nothing here yet</h4>
      <p>${want==='draft'?'Drafts are trips you have started building but not published.'
        :want==='joined'?'Trips somebody else is running that you booked onto yourself.'
        :'When a trip moves into this state it will show up here.'}</p></div>`;

  return topbar([{t:'Trips'},{t:title}]) + `<div class="view">
    <div class="view-head">
      <div><h1>${title}</h1>
        <p>Everything Uluwatu Surf Collective is running, and what each one is owed.</p></div>
      <div class="spacer"></div>
      <div class="seg">${['USD','EUR'].map(c=>`<button aria-pressed="${S.cur===c}" onclick="S.cur='${c}';render()">${c}</button>`).join('')}</div>
      <div class="seg">
        <button aria-pressed="true">List</button>
        <button aria-pressed="false" onclick="toast('Calendar view is out of scope for this mockup.')">Calendar</button>
      </div>
    </div>

    ${want==='upcoming' ? `<div class="grid-4" style="margin-bottom:18px">
      ${statCard('Expected', money0(p.expected,S.cur), `${p.going} travellers · ${nCur} ${S.cur} trip${nCur===1?'':'s'}`,'', 'Everything booked on trips priced in this currency, paid or not. Money never mixes across currencies.')}
      ${statCard('Collected', money0(p.paid,S.cur), p.expected?`${Math.round(p.paid/p.expected*100)}% of expected`:'—', 'var(--ok)')}
      ${statCard('Past due', money0(p.pastDue,S.cur), p.pastDue?'Chase these first':'Nothing overdue', p.pastDue?'var(--danger)':'var(--muted)', 'Installments whose date has passed and are still unpaid.')}
      ${statCard('Waiting on you', p.unsigned + p.incomplete, `${p.unsigned} unsigned waivers · ${p.incomplete} incomplete forms`, 'var(--warn)')}
    </div>` : ''}

    <div class="toolbar">
      <div class="search">${ICON.search}<input type="text" placeholder="Search for participants and trips"></div>
      <button class="btn">Filters ${ICON.chev}</button>
      <button class="btn">Date created: Latest ${ICON.chev}</button>
    </div>
    ${rows}
  </div>`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   MANAGE TRIP
   ═══════════════════════════════════════════════════════════════════════════ */
const TRIP_TABS = [
  ['bookings','Bookings'], ['participants','Participants'], ['rooming','Rooming Lists'],
  ['waitlist','Waitlist'], ['messages','Messages'], ['promote','Promote'], ['opps','Opportunities'],
];

function viewTrip(){
  const t = trip(S.tripId), s = tripStats(t), bs = bookingsOf(t.id);
  const counts = { bookings:bs.length, participants:s.people, waitlist:2, opps:DB.opportunities.filter(o=>o.trip===t.id&&o.stage!=='Booked').length };

  const body = {
    bookings:tabBookings, participants:tabParticipants, rooming:tabRooming,
    waitlist:tabWaitlist, messages:tabMessages, promote:tabPromote, opps:tabOpps,
  }[S.tripTab](t);

  return topbar([{t:'Trips',go:"go('trips')"},{t:t.name}],
      `<button class="btn btn-sm" onclick="go('builder',{tripId:'${t.id}'})">${ICON.edit} Edit trip</button>`) + `
  <div class="view">
    <button class="btn btn-ghost btn-sm" style="margin-bottom:12px" onclick="go('trips')">${ICON.back} All trips</button>
    <div class="trip-head">
      <div class="trip-thumb" style="background:${t.art}"></div>
      <div>
        <h1>${esc(t.name)}</h1>
        <div class="sub">
          <span>${ICON.cal} ${fmtRange(t.start,t.end)}</span>
          <span>${ICON.pin} ${esc(t.dest)}</span>
          <span style="font-family:var(--mono);font-size:12px">${esc(t.tripId)}</span>
        </div>
        <div class="sub" style="margin-top:9px">
          <span class="pill pill-accent">${s.going}/${t.cap} going</span>
          ${s.pastDue?`<span class="pill pill-danger"><span class="dot"></span>${money0(s.pastDue,t.cur)} past due</span>`:''}
          ${s.unsigned?`<span class="pill pill-warn">${s.unsigned} waivers unsigned</span>`:''}
          ${s.failed?`<span class="pill pill-danger">${money0(s.failed,t.cur)} failed</span>`:''}
        </div>
      </div>
      <div class="headstats">
        <div class="headstat"><span class="l">Expected amount <button class="q" title="Everything booked, whether paid or not.">?</button></span><span class="v">${money(s.expected,t.cur)}</span></div>
        <div class="headstat"><span class="l">Amount paid <button class="q" title="Cleared payments only.">?</button></span><span class="v" style="color:var(--ok)">${money(s.paid,t.cur)}</span></div>
        <div class="headstat"><span class="l">Outstanding</span><span class="v">${money(s.balance,t.cur)}</span></div>
        <div class="headstat"><span class="l">Past due</span><span class="v" style="color:${s.pastDue?'var(--danger)':'var(--muted)'}">${money(s.pastDue,t.cur)}</span></div>
        <button class="btn btn-sm" style="margin-top:6px" onclick="go('reports',{reportTab:'upcoming'})">Go to Payments ${ICON.arrow}</button>
      </div>
    </div>

    <div class="tabs" role="tablist">
      ${TRIP_TABS.map(([id,label])=>`<button class="tab" role="tab" aria-selected="${S.tripTab===id}"
        onclick="S.tripTab='${id}';render()">${label}${counts[id]?`<span class="count">${counts[id]}</span>`:''}</button>`).join('')}
    </div>
    ${body}
  </div>`;
}

/* ── Bookings ──────────────────────────────────────────────────────────── */
function tabBookings(t){
  const bs = bookingsOf(t.id);
  const rows = bs.map(b=>{
    const st = bookingStatus(b), bal = bookingBalance(b), p = pkgOf(t,b.pkg);
    const next = b.sched.find(r=>r.status==='pastdue') || b.sched.find(r=>r.status==='due') || b.sched.find(r=>r.status==='scheduled');
    return `<tr>
      <td><div style="display:flex;align-items:center;gap:9px">
          <span class="av av-sm">${initials(b.buyer)}</span>
          <div><button class="linky" onclick="openBooking('${b.id}')">${esc(b.buyer)}</button>
            <div style="font-size:11.5px;color:var(--muted)">${esc(b.email)}</div></div>
        </div></td>
      <td>${headcount(b)} going</td>
      <td>${esc(p?p.name:'—')}${b.addons.length?`<div style="font-size:11.5px;color:var(--muted)">${b.addons.length} add-on${b.addons.length>1?'s':''}</div>`:''}</td>
      <td class="num tnum">${money(bookingTotal(b),t.cur)}</td>
      <td class="num tnum" style="color:${bal?'var(--text)':'var(--ok)'}">${money(bal,t.cur)}</td>
      <td><span class="pill pill-${st.k}">${st.k==='danger'?'<span class="dot"></span>':''}${st.t}</span>
        ${next&&next.status!=='paid'?`<div style="font-size:11.5px;color:var(--muted);margin-top:3px">${esc(next.label)} ${next.due==='booking'?'':relDays(next.due)}</div>`:''}</td>
      <td>${b.signed?`<span class="pill pill-ok">${ICON.check} Signed</span>`:`<span class="pill">Not signed</span>`}</td>
      <td class="num"><button class="icon-btn" onclick="openBooking('${b.id}')" title="Booking actions">${ICON.dots}</button></td>
    </tr>`;
  }).join('');

  return `<div class="card">
    <div class="card-head">
      <h3>Bookings</h3>
      <span class="pill">${bs.length} booking${bs.length>1?'s':''}</span>
      <div class="spacer"></div>
      <button class="btn btn-sm">Filters ${ICON.chev}</button>
      <button class="btn btn-sm">${ICON.down} Download</button>
      <button class="btn btn-sm btn-primary" onclick="addParticipant('${t.id}')">${ICON.plus} Add Participant</button>
    </div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Buyer</th><th>Participants</th><th>Package</th><th class="num">Trip price</th>
        <th class="num">Balance due</th><th>Payment status</th><th>eSignature</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>
  </div>
  <div class="note" style="margin-top:14px"><b>Worth noticing:</b> payment state lives only here.
    The Participants tab beside it carries seventeen columns and not one of them is money — the two
    tables answer different questions and never overlap.</div>`;
}

/* ── Participants ──────────────────────────────────────────────────────── */
function tabParticipants(t){
  const rows = bookingsOf(t.id).flatMap(b=>b.participants.map(p=>({b,p})));
  const body = rows.map(({b,p})=>{
    const qDone = questionsComplete(t,p), tDone = tasksComplete(t,p);
    return `<tr>
      <td><button class="linky" onclick="openParticipant('${b.id}','${esc(p.name)}')">${esc(p.name.split(' ')[0])}</button></td>
      <td>${esc(p.name.split(' ').slice(1).join(' '))}</td>
      <td>${esc(b.buyer)}</td>
      <td style="font-size:12px;color:var(--muted)">${esc(p.email)}</td>
      <td>${esc(pkgOf(t,b.pkg)?.name||'—')}</td>
      <td>${p.signed?`<span class="pill pill-ok">${ICON.check} Signed</span>`
                    :`<button class="pill" style="border:0" onclick="signFor('${b.id}','${esc(p.name)}')">Document not signed</button>`}</td>
      <td>${qDone?'<span class="pill pill-ok">Complete</span>':'<span class="pill pill-warn">Incomplete</span>'}</td>
      <td>${t.tasks.length ? (tDone?'<span class="pill pill-ok">Complete</span>':'<span class="pill pill-warn">Outstanding</span>') : '<span class="pill">—</span>'}</td>
      <td style="font-size:12px">${esc(p.answers?.[t.questions[0]?.id]||'—')}</td>
    </tr>`;
  }).join('');

  const s = tripStats(t);
  return `<div class="grid-4" style="margin-bottom:16px">
      ${statCard('On the trip', s.people, `${s.going} of ${t.cap} spots`)}
      ${statCard('Waivers signed', `${s.signed}/${s.people}`, s.unsigned?`${s.unsigned} still to chase`:'All done', s.unsigned?'var(--warn)':'var(--ok)')}
      ${statCard('Checkout info', `${s.checkoutDone}/${s.people}`, 'Answered at booking')}
      ${statCard('Before-you-fly tasks', `${s.tasksDone}/${s.people}`, t.tasks.length?`Due ${fmtShort(t.tasks[0].due)}`:'No tasks set', s.tasksDone<s.people?'var(--warn)':'var(--ok)')}
    </div>
  <div class="card">
    <div class="card-head"><h3>Participants</h3><div class="spacer"></div>
      <button class="btn btn-sm">Filters ${ICON.chev}</button>
      <button class="btn btn-sm">Edit Columns</button>
      <button class="btn btn-sm btn-primary">${ICON.down} Export</button></div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>First name</th><th>Last name</th><th>Buyer</th><th>Email</th><th>Package</th>
        <th>eSignature</th><th>Checkout Info</th><th>Tasks</th><th>${esc(t.questions[0]?.q||'—')}</th></tr></thead>
      <tbody>${body}</tbody></table></div>
  </div>
  ${s.unsigned?`<div style="display:flex;gap:9px;margin-top:14px;align-items:center;flex-wrap:wrap">
    <button class="btn btn-primary" onclick="chase('${t.id}','signature')">${ICON.sign} Request the ${s.unsigned} missing signature${s.unsigned>1?'s':''}</button>
    <button class="btn" onclick="chase('${t.id}','info')">Request missing information</button>
    <span style="font-size:12.5px;color:var(--muted)">Both send to exactly the people who are missing it.</span>
  </div>`:''}`;
}

/* ── Rooming ───────────────────────────────────────────────────────────── */
function tabRooming(t){
  const people = bookingsOf(t.id).flatMap(b=>b.participants.map(p=>({p, pkg:pkgOf(t,b.pkg)?.name})));
  const rooms = [
    { name:'Bungalow 1', cap:2, pkg:'Private Bungalow', who:people.filter(x=>x.pkg==='Private Bungalow').slice(0,2) },
    { name:'Twin A', cap:2, pkg:'Twin Room', who:people.filter(x=>x.pkg==='Twin Room').slice(0,2) },
    { name:'Twin B', cap:2, pkg:'Twin Room', who:people.filter(x=>x.pkg==='Twin Room').slice(2,4) },
    { name:'Dorm', cap:4, pkg:'Shared Dorm', who:people.filter(x=>x.pkg==='Shared Dorm') },
  ];
  return `<div class="card">
    <div class="card-head"><h3>Rooming Lists</h3><span class="pill pill-accent">Pro</span><div class="spacer"></div>
      <button class="btn btn-sm">Hide full rooms</button>
      <button class="btn btn-sm btn-primary">${ICON.plus} Create List</button></div>
    <div class="card-pad"><div class="grid-4">
      ${rooms.map(r=>`<div class="card" style="box-shadow:none">
        <div class="card-head" style="padding:11px 13px"><h3 style="font-size:13px">${r.name}</h3>
          <div class="spacer"></div>
          <span class="pill ${r.who.length>r.cap?'pill-warn':''}">${r.who.length}/${r.cap}</span></div>
        <div class="card-pad" style="padding:11px 13px;display:grid;gap:7px">
          ${r.who.length?r.who.map(x=>`<div style="display:flex;align-items:center;gap:8px;font-size:12.5px">
            <span class="av av-sm">${initials(x.p.name)}</span>${esc(x.p.name)}</div>`).join('')
            :'<div style="font-size:12px;color:var(--muted)">Unassigned</div>'}
          <div style="font-size:11px;color:var(--muted);margin-top:3px">${esc(r.pkg)}</div>
        </div></div>`).join('')}
    </div></div>
  </div>
  <div class="note" style="margin-top:14px">Capacity is shown but never enforced — you can put five people
    in a four-bed dorm and the product will let you, on the grounds that you probably know something it doesn't.</div>`;
}

/* ── Waitlist ──────────────────────────────────────────────────────────── */
function tabWaitlist(t){
  const wl = [
    { name:'Sofia Marchetti', email:'sofia.m@libero.it', qty:1, pkg:'Twin Room', joined:'2026-08-12', note:'Flexible on dates if September is full.' },
    { name:'Daniel Okafor', email:'d.okafor@gmail.com', qty:2, pkg:"I don't have a preference", joined:'2026-08-20', note:'' },
  ];
  return `<div class="card">
    <div class="card-head"><h3>Waitlist</h3><span class="pill">${wl.length} waiting</span><div class="spacer"></div>
      <button class="btn btn-sm">${ICON.down} Export</button></div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Name</th><th>Wants</th><th>Package</th><th>Joined</th><th>Note</th><th></th></tr></thead>
      <tbody>${wl.map(w=>`<tr>
        <td><div style="display:flex;align-items:center;gap:9px"><span class="av av-sm">${initials(w.name)}</span>
          <div><b>${esc(w.name)}</b><div style="font-size:11.5px;color:var(--muted)">${esc(w.email)}</div></div></div></td>
        <td>${w.qty} spot${w.qty>1?'s':''}</td>
        <td>${esc(w.pkg)}</td>
        <td>${fmtShort(w.joined)}</td>
        <td style="color:var(--muted);font-size:12.5px;max-width:280px">${esc(w.note||'—')}</td>
        <td class="num"><button class="btn btn-sm btn-primary" onclick="toast('Invite sent to <b>${esc(w.name)}</b>. The link is good for 48 hours.')">Invite</button></td>
      </tr>`).join('')}</tbody></table></div>
  </div>
  <div class="note" style="margin-top:14px">An invite from here writes a link that bypasses the sold-out
    state and expires in <b>48 hours</b> — which is the whole point: it re-opens one seat for one person,
    not the trip for everybody.</div>`;
}

/* ── Messages ──────────────────────────────────────────────────────────── */
function tabMessages(t){
  const s = tripStats(t);
  const sent = [
    { subj:'Your Bali packing list is here', to:'Everyone on this trip', when:'2026-08-10', n:s.people },
    { subj:'Two weeks out — flight details please', to:'Everyone with incomplete required questions', when:'2026-08-18', n:s.people-s.checkoutDone },
  ];
  return `<div class="grid-2">
    <div class="card">
      <div class="card-head"><h3>New Message</h3></div>
      <div class="card-pad">
        <div class="field"><label>Send To</label>
          <select id="msg-to" onchange="msgCount()">
            <option>Everyone on this trip (${s.people})</option>
            <option>Everyone with a specific package or add-on</option>
            <option>Everyone with payments past due (${bookingsOf(t.id).filter(b=>bookingPastDue(b)).length})</option>
            <option>Everyone with incomplete required questions (${s.people-s.checkoutDone})</option>
            <option>Everyone with missing signatures (${s.unsigned})</option>
            <option>Specific recipients</option>
          </select>
          <div class="hint" id="msg-n">Goes to all ${s.people} travellers.</div></div>
        <div class="field"><label>Subject line</label><input type="text" placeholder="What is this about?"></div>
        <div class="field"><label>Message</label><textarea rows="5" placeholder="Write to your travellers…"></textarea></div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-primary" onclick="sendMessage('${t.id}')">Send Now</button>
          <button class="btn" onclick="toast('Scheduled sends go out between 19:00 and 20:30 UTC.')">Schedule</button>
          <button class="btn btn-sm">Save as Draft</button>
          <span style="margin-left:auto"></span>
          <button class="btn btn-sm">Attach</button>
          <button class="btn btn-sm">Templates</button>
        </div>
        <div class="note" style="margin-top:14px;margin-bottom:0">The three counted options are the useful ones:
          they resolve to <b>exactly the people who are missing something</b>, and the email carries the
          right link — to the payment, the form or the waiver — without you assembling a list.</div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Sent</h3></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Subject</th><th>Audience</th><th class="num">Sent to</th><th>When</th></tr></thead>
        <tbody>${sent.map(m=>`<tr><td><b>${esc(m.subj)}</b></td>
          <td style="font-size:12px;color:var(--muted)">${esc(m.to)}</td>
          <td class="num tnum">${m.n}</td><td>${fmtShort(m.when)}</td></tr>`).join('')}</tbody></table></div>
    </div>
  </div>`;
}

/* ── Promote ───────────────────────────────────────────────────────────── */
function tabPromote(t){
  const url = `https://${DB.operator.subdomain}.swellyo.com/trips/${t.tripId.toLowerCase()}`;
  const widgets = [
    ['Book Now button','A button that opens checkout in an overlay, without sending anyone off your site.'],
    ['Packages widget','Lists the rooms with live prices and spot counts.'],
    ['Direct link','A plain URL for Instagram, email or a QR code.'],
    ['Brochure button','Trades a PDF for an email address, and writes the lead into CRM.'],
    ['Trip inquiry form','Inline or popup, built from your Fields.'],
  ];
  return `<div class="grid-2">
    <div class="card">
      <div class="card-head"><h3>Your booking page</h3></div>
      <div class="card-pad">
        <div class="field"><label>Public URL</label>
          <div style="display:flex;gap:8px">
            <input type="text" readonly value="${url}" style="font-family:var(--mono);font-size:12px">
            <button class="btn" onclick="toast('Link copied.')">Copy</button></div>
          <div class="hint">Your own subdomain, your logo, no platform badge in the footer.</div></div>
        <button class="btn btn-primary" onclick="go('traveller')">${ICON.eye} Preview the traveller view</button>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Embed on your own site</h3></div>
      <div class="card-pad" style="display:grid;gap:9px">
        ${widgets.map(([n,d])=>`<div style="display:flex;gap:12px;align-items:flex-start;padding:10px;border:1px solid var(--line);border-radius:var(--r-sm)">
          <div style="flex:1"><b style="font-size:13px">${esc(n)}</b><div style="font-size:12px;color:var(--muted);margin-top:2px">${esc(d)}</div></div>
          <button class="btn btn-sm" onclick="toast('HTML copied to the clipboard.')">Copy HTML</button></div>`).join('')}
      </div>
    </div>
  </div>`;
}

/* ── Opportunities on the trip ─────────────────────────────────────────── */
function tabOpps(t){
  const os = DB.opportunities.filter(o=>o.trip===t.id);
  return `<div class="card">
    <div class="card-head"><h3>Opportunities</h3><div class="spacer"></div>
      <button class="btn btn-sm" onclick="go('crm',{crmTab:'opportunities'})">Open the pipeline ${ICON.arrow}</button></div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Opportunity</th><th>Contact</th><th>Stage</th><th>Source</th><th class="num">Value</th><th>Last activity</th></tr></thead>
      <tbody>${os.map(o=>{ const c=contact(o.contact); const st=DB.stages.find(x=>x.name===o.stage);
        return `<tr><td><b>${esc(o.title)}</b><div style="font-size:12px;color:var(--muted);max-width:340px">${esc(o.msg)}</div></td>
        <td><div style="display:flex;align-items:center;gap:8px"><span class="av av-sm">${initials(c.name)}</span>${esc(c.name)}</div></td>
        <td><span class="pill" style="background:${st.color}18;color:${st.color}">${esc(o.stage)}</span></td>
        <td style="font-size:12px;color:var(--muted)">${esc(o.source)}</td>
        <td class="num tnum">${money0(o.value,t.cur)}</td>
        <td>${relDays(o.lastAct)}</td></tr>`;}).join('')}</tbody></table></div>
  </div>`;
}
