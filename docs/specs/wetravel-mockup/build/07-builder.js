/* ═══════════════════════════════════════════════════════════════════════════
   TRIP BUILDER
   ═══════════════════════════════════════════════════════════════════════════ */
const STEPS = [
  ['basics','Trip Basics'], ['page','Trip Page'], ['packages','Packages'], ['addons','Add-ons'],
  ['info','Participant Info'], ['esign','eSignature'], ['settings','Settings'],
];

function viewBuilder(){
  const t = trip(S.tripId);
  const done = { basics:true, page:true, packages:true, addons:true, info:true, esign:t.esign.on, settings:true };
  const body = { basics:stBasics, page:stPage, packages:stPackages, addons:stAddons,
                 info:stInfo, esign:stEsign, settings:stSettings }[S.builderStep](t);

  return topbar([{t:'Trips',go:"go('trips')"},{t:t.name,go:`go('trip',{tripId:'${t.id}'})`},{t:'Edit'}],
    `<button class="btn btn-sm" onclick="go('traveller')">${ICON.eye} Preview</button>
     <button class="btn btn-sm btn-primary" onclick="toast('Changes published. Travellers see them on their next visit.')">Publish changes</button>`)
  + `<div class="view">
    <div class="view-head"><div><h1>${esc(t.name)}</h1>
      <p>Seven steps, always in this order. The trip stays a draft until you publish.</p></div></div>
    <div class="builder">
      <nav class="builder-nav">
        ${STEPS.map(([id,label],i)=>`<button aria-current="${S.builderStep===id?'step':'false'}"
          class="${done[id]&&S.builderStep!==id?'done':''}" onclick="S.builderStep='${id}';render()">
          <span class="step-n">${done[id]&&S.builderStep!==id?'✓':i+1}</span>${label}</button>`).join('')}
      </nav>
      <div>${body}</div>
    </div>
  </div>`;
}

function stBasics(t){
  return `<div class="card"><div class="card-head"><h3>Trip Basics</h3></div><div class="card-pad">
    <div class="grid-2">
      <div class="field"><label>Trip name</label><input type="text" value="${esc(t.name)}"></div>
      <div class="field"><label>Trip ID</label><input type="text" value="${esc(t.tripId)}" style="font-family:var(--mono)"></div>
    </div>
    <div class="grid-2">
      <div class="field"><label>Destination</label><input type="text" value="${esc(t.dest)}"></div>
      <div class="field"><label>Country</label><input type="text" value="${esc(t.country)}"></div>
    </div>
    <div class="grid-3">
      <div class="field"><label>Start date</label><input type="date" value="${t.start}"></div>
      <div class="field"><label>End date</label><input type="date" value="${t.end}"></div>
      <div class="field"><label>Currency</label><select><option ${t.cur==='USD'?'selected':''}>USD</option><option ${t.cur==='EUR'?'selected':''}>EUR</option><option>GBP</option><option>AUD</option></select>
        <div class="hint">Priced in one currency. Travellers may still pay in theirs.</div></div>
    </div>
    <div class="field"><label>Maximum group size</label><input type="number" value="${t.cap}" style="max-width:140px"></div>
    <label class="switch"><input type="checkbox" checked><span><span class="sw-l">Offer a waitlist when a package sells out</span>
      <span class="sw-d">Collects a name, an email and how many spots they want.</span></span></label>
  </div></div>`;
}

function stPage(t){
  return `<div class="card"><div class="card-head"><h3>Trip Page</h3><div class="spacer"></div>
      <button class="btn btn-sm" onclick="go('traveller')">${ICON.eye} Preview</button></div><div class="card-pad">
    <div class="field"><label>About your trip</label><textarea rows="4">${esc(t.blurb)}</textarea></div>
    <div class="grid-2">
      <div><h4 style="font-size:13px;margin-bottom:9px">What's included</h4>
        ${t.included.map(([a,b])=>`<div style="display:flex;gap:10px;padding:8px 10px;border:1px solid var(--line);border-radius:var(--r-sm);margin-bottom:6px">
          <span class="grip">${ICON.grip}</span>
          <div style="flex:1"><b style="font-size:11.5px;letter-spacing:.04em">${esc(a)}</b>
            <div style="font-size:12px;color:var(--muted)">${esc(b)}</div></div></div>`).join('')}
      </div>
      <div><h4 style="font-size:13px;margin-bottom:9px">What's not included</h4>
        ${t.excluded.map(([a,b])=>`<div style="display:flex;gap:10px;padding:8px 10px;border:1px solid var(--line);border-radius:var(--r-sm);margin-bottom:6px">
          <span class="grip">${ICON.grip}</span>
          <div style="flex:1"><b style="font-size:11.5px;letter-spacing:.04em">${esc(a)}</b>
            <div style="font-size:12px;color:var(--muted)">${esc(b)}</div></div></div>`).join('')}
      </div>
    </div>
    <h4 style="font-size:13px;margin:18px 0 9px">Itinerary</h4>
    ${t.itinerary.map(([d,h,p])=>`<div style="display:flex;gap:11px;padding:11px;border:1px solid var(--line);border-radius:var(--r-sm);margin-bottom:7px">
      <span class="grip">${ICON.grip}</span>
      <div style="flex:1"><b style="font-size:12.5px">${esc(d)} — ${esc(h)}</b>
        <div style="font-size:12.5px;color:var(--muted);margin-top:3px;line-height:1.5">${esc(p)}</div></div></div>`).join('')}
    <div class="note" style="margin-top:14px;margin-bottom:0">These are free-text blocks you drag around,
      not a structured day-and-time model. It is why itineraries look however the operator types them —
      flexible, and impossible to query later.</div>
  </div></div>`;
}

/* ── Packages: the payment plan lives here ─────────────────────────────── */
function stPackages(t){
  return `<div class="card"><div class="card-head"><h3>Packages</h3><div class="spacer"></div>
      <button class="btn btn-sm btn-primary">${ICON.plus} Add package</button></div><div class="card-pad">
    ${t.packages.map(p=>{
      const plan = t.plan;
      const perInst = plan.installments ? (p.price - p.deposit) / plan.installments : 0;
      return `<div class="pkg">
        <div class="pkg-top">
          <span class="grip">${ICON.grip}</span>
          <h4 style="flex:1">${esc(p.name)}</h4>
          <span class="pill ${p.spots-p.sold<=1?'pill-warn':''}">${p.spots-p.sold} of ${p.spots} left</span>
        </div>
        <div style="font-size:12.5px;color:var(--muted);margin:6px 0 0 25px">${esc(p.desc)}</div>
        <div class="grid-3" style="margin-top:11px">
          <div class="field" style="margin:0"><label>Full price per person</label>
            <div class="money-in"><span>${CUR[t.cur].s}</span><input type="number" value="${p.price}"></div></div>
          <div class="field" style="margin:0"><label>Deposit</label>
            <div class="money-in"><span>${CUR[t.cur].s}</span><input type="number" value="${p.deposit}"></div></div>
          <div class="field" style="margin:0"><label>Spots</label><input type="number" value="${p.spots}"></div>
        </div>
        <div class="pkg-plan">
          <span style="font-weight:600">Payment plan</span>
          <span>${money0(p.deposit,t.cur)} deposit, then <b>${plan.installments} × ${money(perInst,t.cur)}</b></span>
          ${plan.autoBill?'<span class="pill pill-accent">Auto-billing on</span>':'<span class="pill">Reminders only</span>'}
          <span style="margin-left:auto"></span>
          <button class="btn btn-sm" onclick="planModal('${t.id}','${p.id}')">${ICON.edit} Edit plan</button>
        </div>
      </div>`;
    }).join('')}
    <div class="note" style="margin-bottom:0">A payment plan belongs to a <b>package</b>, not to the trip.
      Book two packages and the schedules merge into one — same dates add up, different dates become more
      installments.</div>
  </div></div>`;
}

function stAddons(t){
  return `<div class="card"><div class="card-head"><h3>Add-ons</h3><div class="spacer"></div>
      <button class="btn btn-sm btn-primary">${ICON.plus} Add an add-on</button></div>
    <div class="tbl-wrap"><table><thead><tr><th></th><th>Name</th><th>Charged</th><th class="num">Price</th><th class="num">Sold</th><th></th></tr></thead>
    <tbody>${t.addons.map(a=>{
      const sold = DB.bookings.filter(b=>b.trip===t.id && b.addons.includes(a.id)).reduce((n,b)=>n+b.qty,0);
      return `<tr><td style="width:30px"><span class="grip">${ICON.grip}</span></td>
        <td><b>${esc(a.name)}</b></td><td style="color:var(--muted)">Per ${esc(a.per)}</td>
        <td class="num tnum">${money(a.price,t.cur)}</td>
        <td class="num tnum">${sold||'—'}</td>
        <td class="num"><button class="icon-btn">${ICON.dots}</button></td></tr>`;
    }).join('')}</tbody></table></div></div>`;
}

/* ── Participant Info: the form builder ────────────────────────────────── */
const QTYPES = ['Text Answer','Checkboxes','Multiple Choice','Dropdown','Date','Phone Number','Country','File Upload'];
const TYPEMAP = { text:'Text Answer', checkbox:'Checkboxes', radio:'Multiple Choice', dropdown:'Dropdown',
                  date:'Date', phone:'Phone Number', country:'Country', file:'File Upload' };

function qRow(q, ctx){
  return `<div class="qrow">
    <span class="grip" title="Drag to reorder">${ICON.grip}</span>
    <input type="text" value="${esc(q.q)}" onchange="renameQ('${ctx}','${q.id}',this.value)">
    <select onchange="toast('Question type is locked once a question is saved — the real product makes you delete and recreate it.')">
      ${QTYPES.map(x=>`<option ${TYPEMAP[q.type]===x?'selected':''}>${x}</option>`).join('')}
    </select>
    <label class="req"><input type="checkbox" ${q.req?'checked':''} onchange="toggleReq('${ctx}','${q.id}')"> Required</label>
    <button class="icon-btn" title="Delete" onclick="delQ('${ctx}','${q.id}')">${ICON.x}</button>
  </div>`;
}

function stInfo(t){
  return `<div class="card"><div class="card-head"><h3>Participant Info</h3><div class="spacer"></div>
      <span class="pill">${t.questions.length + t.tasks.reduce((n,k)=>n+k.questions.length,0)} questions</span></div>
    <div class="card-pad">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <h4 style="font-size:13.5px">Checkout Info</h4>
        <span class="pill">Asked before payment</span>
        <div style="margin-left:auto"></div>
        <button class="btn btn-sm">Set lock date</button>
        <button class="btn btn-sm btn-primary" onclick="addQ('checkout')">${ICON.plus} Add question</button>
      </div>
      ${t.questions.map(q=>qRow(q,'checkout')).join('') || '<div class="empty" style="padding:22px"><p>No checkout questions yet.</p></div>'}

      <div style="height:22px"></div>
      ${t.tasks.map(tk=>`<div class="task-block">
        <div class="task-head"><h4>${esc(tk.name)}</h4>
          <span class="pill pill-accent">Due ${esc(tk.dueLabel)}</span>
          ${tk.reminders?'<span class="pill pill-ok">Reminders on</span>':''}
          <div style="margin-left:auto"></div>
          <button class="btn btn-sm btn-primary" onclick="addQ('${tk.id}')">${ICON.plus} Add question</button></div>
        ${tk.questions.map(q=>qRow(q,tk.id)).join('')}
        <div style="font-size:12px;color:var(--muted);margin-top:8px">
          Reminders go out 7 days before, 3 days before, on the day, and 2 days late — to the buyer only.</div>
      </div>`).join('')}
      <button class="btn" onclick="toast('A task groups questions behind one due date and one reminder schedule.')">${ICON.plus} Add task</button>

      <div class="note" style="margin-top:18px;margin-bottom:0">Two things worth knowing about this screen.
        There is <b>no conditional logic</b> — it is a flat list, so everyone answers everything. And only
        the <b>buyer</b> can fill it in, for themselves and for everyone they booked; participants never get
        a login.</div>
    </div></div>`;
}

function stEsign(t){
  const s = tripStats(t);
  return `<div class="card"><div class="card-head"><h3>eSignature</h3><span class="pill pill-accent">Pro</span></div>
    <div class="card-pad">
      <label class="switch"><input type="checkbox" ${t.esign.on?'checked':''} onchange="t=0;toast('The waiver is the one document the trip refuses to start without.')">
        <span><span class="sw-l">Require a signed document</span>
        <span class="sw-d">One PDF per trip. Combine your waiver and terms into a single file before uploading.</span></span></label>

      ${t.esign.on?`
      <div style="display:flex;align-items:center;gap:12px;padding:13px;border:1px solid var(--line);border-radius:var(--r);margin:13px 0;background:var(--panel)">
        <span style="color:var(--ok)">${ICON.file}</span>
        <div style="flex:1"><b style="font-size:13px">${esc(t.esign.file)}</b>
          <div style="font-size:12px;color:var(--muted)">${esc(t.esign.size)} · scanned and ready</div></div>
        <span class="pill pill-ok">${ICON.check} Ready</span>
        <button class="btn btn-sm">Replace</button>
      </div>
      <div class="grid-2">
        <div class="field"><label>Who should sign the document</label>
          <select><option>Everyone (buyer and all participants)</option><option>Buyer only</option></select></div>
        <div class="field"><label>&nbsp;</label>
          <label class="switch" style="padding-top:4px"><input type="checkbox" ${t.esign.mandatory?'checked':''}>
            <span><span class="sw-l">Required before payment</span>
            <span class="sw-d">Blocks the buyer at checkout. Others sign afterwards by email link.</span></span></label></div>
      </div>
      <div class="grid-4" style="margin-top:6px">
        ${statCard('Signed', `${s.signed}/${s.people}`, s.unsigned?'Chase the rest':'Everyone', s.unsigned?'var(--warn)':'var(--ok)')}
        ${statCard('Reminder cadence','2h · 2d','After booking, then again')}
        ${statCard('Fields on the PDF','0','Type your name at the bottom')}
        ${statCard('Review step','None','Signed or not signed')}
      </div>
      <div class="note" style="margin-top:16px;margin-bottom:0">There is no approval workflow here — a document
        is signed or it isn't. Nothing is ever <b>pending review</b>, <b>approved</b> or <b>rejected</b>, which
        matters if what you actually need to check is a passport rather than a signature.</div>
      `:''}
    </div></div>`;
}

function stSettings(t){
  const st = DB.settings;
  return `<div class="card"><div class="card-head"><h3>Who pays the fees?</h3></div><div class="card-pad">
      <div class="grid-2">
        <div>
          <div class="field"><label>Payment fees (when applicable) are paid by</label>
            <div style="display:grid;gap:6px">
              <label class="radio-row ${st.paymentFeesPaidBy==='organizer'?'on':''}">
                <input type="radio" name="pf" ${st.paymentFeesPaidBy==='organizer'?'checked':''} onchange="setFee('paymentFeesPaidBy','organizer')"> Organizer</label>
              <label class="radio-row ${st.paymentFeesPaidBy==='participant'?'on':''}">
                <input type="radio" name="pf" ${st.paymentFeesPaidBy==='participant'?'checked':''} onchange="setFee('paymentFeesPaidBy','participant')"> Participant</label>
            </div></div>
        </div>
        <div>
          <div class="field"><label>Platform fee is paid by</label>
            <div style="display:grid;gap:6px">
              <label class="radio-row ${st.wtFeePaidBy==='organizer'?'on':''}">
                <input type="radio" name="wf" ${st.wtFeePaidBy==='organizer'?'checked':''} onchange="setFee('wtFeePaidBy','organizer')"> Organizer</label>
              <label class="radio-row ${st.wtFeePaidBy==='participant'?'on':''}">
                <input type="radio" name="wf" ${st.wtFeePaidBy==='participant'?'checked':''} onchange="setFee('wtFeePaidBy','participant')"> Participant</label>
            </div></div>
        </div>
      </div>
      ${feePreview(t)}
      <div class="note" style="margin-top:16px;margin-bottom:0">Flip either of these and the traveller's
        checkout changes — go and look. Note what happens when they pay by <b>bank transfer</b>: the
        processing fee is genuinely zero, so the line disappears rather than showing ${money(0,t.cur)}.</div>
    </div></div>

    <div class="card" style="margin-top:16px"><div class="card-head"><h3>Cancellation policy</h3></div>
      <div class="card-pad">
        <div class="field"><label>Policy shown to travellers</label>
          <textarea rows="4">More than 60 days before departure: full refund less a ${money0(150,t.cur)} administration fee.
30–60 days: 50% refund. Inside 30 days: the deposit is non-refundable and no refund is available on the balance.</textarea>
          <div class="hint">Free text. Nothing here is enforced by the platform, calculated at checkout,
            or applied automatically when you cancel someone.</div></div>
      </div></div>`;
}

function feePreview(t){
  const p = t.packages[0] || {price:1000, deposit:200};
  const amt = p.deposit;
  const card = travellerAddOn(amt, t.cur, 'card');
  const bank = travellerAddOn(amt, t.cur, 'bank');
  return `<div class="card" style="box-shadow:none;background:var(--panel);margin-top:14px">
    <div class="card-head" style="border-color:var(--line)"><h3>What a traveller sees on a ${money0(amt,t.cur)} deposit</h3></div>
    <div class="card-pad"><div class="grid-2">
      <div><div class="stat-l" style="margin-bottom:7px">${ICON.card} Paying by card</div>
        <div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0"><span style="color:var(--muted)">Deposit</span><b class="tnum">${money(amt,t.cur)}</b></div>
        ${card?`<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0"><span style="color:var(--muted)">Service fee</span><b class="tnum">${money(card,t.cur)}</b></div>`:''}
        <div style="display:flex;justify-content:space-between;font-size:14px;padding:7px 0 0;border-top:1px solid var(--line);margin-top:5px"><b>Due at booking</b><b class="tnum">${money(amt+card,t.cur)}</b></div></div>
      <div><div class="stat-l" style="margin-bottom:7px">${ICON.bank} Paying by bank transfer</div>
        <div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0"><span style="color:var(--muted)">Deposit</span><b class="tnum">${money(amt,t.cur)}</b></div>
        ${bank?`<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0"><span style="color:var(--muted)">Service fee</span><b class="tnum">${money(bank,t.cur)}</b></div>`:''}
        <div style="display:flex;justify-content:space-between;font-size:14px;padding:7px 0 0;border-top:1px solid var(--line);margin-top:5px"><b>Due at booking</b><b class="tnum">${money(amt+bank,t.cur)}</b></div></div>
    </div></div></div>`;
}
