/* ═══════════════════════════════════════════════════════════════════════════
   TRAVELLER — everything inside the phone
   ═══════════════════════════════════════════════════════════════════════════ */
const CO_STEPS = ['Package','Add-ons','Participant info','Sign','Payment'];

function viewTraveller(){
  const t = trip(S.tripId.startsWith('t') && trip(S.tripId).status!=='draft' ? S.tripId : 't1');
  const views = [['trip','Trip page'],['checkout','Checkout'],['booking','After booking']];
  const screen = { trip:phTrip, checkout:phCheckout, booking:phBooking }[S.travellerView](t);
  const caps = {
    trip:['The page a traveller lands on','Sections are a list the operator drags into order. The price and the deposit sit in a widget that floats over the hero, and the button label is theirs to choose.'],
    checkout:['Five steps, and only the ones you configured','Watch the money at the bottom. The service fee appears and disappears with the payment method, because bank transfer genuinely costs nothing to process.'],
    booking:['Where a traveller lives afterwards','A countdown, a list of what they still owe you, and every document they have not signed. No cancel button — that is a message to you.'],
  }[S.travellerView];

  return `<div class="topbar">
      <div class="crumb"><b>Traveller view</b><span class="sep">/</span>
        <span style="color:var(--muted)">${esc(t.name)}</span></div>
      <div class="topbar-right">
        <div class="seg">${views.map(([id,l])=>`<button aria-pressed="${S.travellerView===id}"
          onclick="S.travellerView='${id}';${id==='checkout'?'S.co.step=0;':''}render()">${l}</button>`).join('')}</div>
        <button class="btn btn-sm" onclick="go('trip',{tripId:'${t.id}'})">${ICON.back} Back to the dashboard</button>
      </div>
    </div>
    <div class="view" style="max-width:none">
      <div class="stage">
        <div>
          <div class="phone"><div class="notch"></div><div class="phone-screen">
            <div class="status-bar"><span>9:41</span><span>${I('<path d="M2 20h.01M6 20v-4M10 20v-8M14 20v-12M18 20v-16"/>',15)}</span></div>
            ${screen}
          </div></div>
          <div class="phone-cap"><b>${caps[0]}</b>${caps[1]}</div>
        </div>
      </div>
    </div>`;
}

/* ── Trip page ─────────────────────────────────────────────────────────── */
function phTrip(t){
  const cheapest = [...t.packages].sort((a,b)=>a.price-b.price)[0];
  return `<div class="phone-scroll">
    <div class="t-hero" style="background:${t.art}">
      <div class="t-nav"><span class="av">${initials(DB.operator.name)}</span>
        <b>${esc(DB.operator.name)}</b></div>
    </div>
    <div class="t-body">
      <div class="t-title">${esc(t.name)}</div>
      <div class="t-dest">${esc(t.dest)}</div>
      <div class="t-dates">${fmtRange(t.start,t.end)} · ${t.days} days</div>

      <div class="t-sec"><h4>About this trip</h4><p>${esc(t.blurb)}</p></div>

      <div class="t-sec"><h4>What's included</h4>
        <div class="t-inc">${t.included.map(([a,b])=>`<div>
          <span style="color:var(--app-ok);flex:none;margin-top:1px">${ICON.check}</span>
          <div><b>${esc(a)}</b><span>${esc(b)}</span></div></div>`).join('')}</div></div>

      <div class="t-sec"><h4>Not included</h4>
        <div class="t-inc">${t.excluded.map(([a,b])=>`<div>
          <span style="color:var(--app-muted);flex:none;margin-top:1px">${ICON.x}</span>
          <div><b>${esc(a)}</b><span>${esc(b)}</span></div></div>`).join('')}</div></div>

      <div class="t-sec"><h4>Rooms</h4>
        ${t.packages.map(p=>{ const left = p.spots-p.sold; return `<div class="t-pkg ${left<=0?'off':''}">
          <div class="t-pkg-top"><b>${esc(p.name)}</b>
            <div style="text-align:right"><div class="price">${money0(p.price,t.cur)}</div>
              <div class="dep">Deposit ${money0(p.deposit,t.cur)}</div></div></div>
          <div style="font-size:12px;color:var(--app-muted);margin-top:6px">${esc(p.desc)}</div>
          <div style="margin-top:8px">${left<=0?'<span class="t-pill bad">Sold out</span>'
            :left<=2?`<span class="t-pill warn">Only ${left} left</span>`
            :`<span class="t-pill ok">${left} left</span>`}</div>
        </div>`;}).join('')}</div>

      <div class="t-sec"><h4>Your week</h4>
        ${t.itinerary.map(([d,h,p],i)=>`<div class="t-day"><span class="n">${i+1}</span>
          <div><b>${esc(h)}</b><p>${esc(p)}</p>
            <div style="font-size:11px;color:var(--app-muted);margin-top:4px;font-weight:600">${esc(d)}</div></div></div>`).join('')}</div>

      <div class="t-sec"><h4>Your host</h4>
        <div style="display:flex;gap:11px;align-items:center;padding:12px;border:1px solid var(--app-border);border-radius:12px">
          <span class="av av-lg">${initials(DB.operator.name)}</span>
          <div><b style="font-size:13.5px">${esc(DB.operator.name)}</b>
            <div style="font-size:12px;color:var(--app-muted);margin-top:2px">
              <span class="t-pill ok" style="margin-right:5px">Verified</span>4.9 · 61 reviews</div></div></div></div>

      <div class="t-sec"><h4>If you need to cancel</h4>
        <p style="font-size:12.5px;color:var(--app-muted)">More than 60 days before departure: full refund
          less a ${money0(150,t.cur)} administration fee. 30–60 days: 50%. Inside 30 days: the deposit is
          non-refundable.</p>
        <div style="font-size:11.5px;color:var(--app-muted);margin-top:9px;font-style:italic">
          Free text the operator typed. Nothing here is calculated at checkout or applied automatically.</div></div>

      <div style="text-align:center;font-size:11px;color:var(--app-muted);margin-top:26px;padding-top:16px;border-top:1px solid var(--app-hair)">
        © 2026 ${esc(DB.operator.name)} · Terms · Privacy</div>
    </div>
  </div>
  <div class="t-dock">
    <div class="p"><b>${money0(cheapest.price,t.cur)}</b><span>Deposit ${money0(cheapest.deposit,t.cur)}</span></div>
    <button class="t-cta" onclick="S.travellerView='checkout';S.co.step=0;render()">See availability</button>
  </div>`;
}

/* ── Checkout ──────────────────────────────────────────────────────────── */
function phCheckout(t){
  const co = S.co;
  const p = pkgOf(t, co.pkg) || t.packages[0];
  const addTotal = co.addons.reduce((s,id)=>s+(t.addons.find(a=>a.id===id)?.price||0),0) * co.qty;
  const total = p.price*co.qty + addTotal;
  const deposit = p.deposit*co.qty;
  const dueNow = co.plan==='full' ? total : deposit;
  const fee = travellerAddOn(dueNow, t.cur, co.method);
  const inst = t.plan.installments;
  const perInst = (total - deposit) / inst;

  const body = [
    /* 0 — package */ ()=>`
      <h3>Choose your room</h3>
      <p class="lede">${fmtRange(t.start,t.end)} · ${t.days} days in ${esc(t.dest)}</p>
      ${t.packages.map(x=>{ const left=x.spots-x.sold; return `
        <label class="co-opt ${co.pkg===x.id?'on':''}" ${left<=0?'style="opacity:.45;pointer-events:none"':''}>
          <input type="radio" name="pk" ${co.pkg===x.id?'checked':''} ${left<=0?'disabled':''} onchange="S.co.pkg='${x.id}';render()">
          <div style="flex:1"><b>${esc(x.name)}</b><div class="d">${esc(x.desc)}</div>
            <div style="margin-top:6px">${left<=0?'<span class="t-pill bad">Sold out</span>'
              :left<=2?`<span class="t-pill warn">Only ${left} left</span>`:`<span class="t-pill ok">${left} left</span>`}</div></div>
          <div style="text-align:right"><b class="tnum" style="font-family:var(--display)">${money0(x.price,t.cur)}</b>
            <div style="font-size:11px;color:var(--app-muted)">Deposit ${money0(x.deposit,t.cur)}</div></div>
        </label>`;}).join('')}
      <div class="co-f" style="margin-top:14px"><label>How many of you?</label>
        <select onchange="S.co.qty=parseInt(this.value);render()">
          ${[1,2,3].map(n=>`<option value="${n}" ${co.qty===n?'selected':''}>${n} ${n>1?'people':'person'}</option>`).join('')}</select></div>`,

    /* 1 — add-ons */ ()=>`
      <h3>Anything else?</h3>
      <p class="lede">All optional. Charged per person.</p>
      ${t.addons.map(a=>`<label class="co-opt ${co.addons.includes(a.id)?'on':''}">
        <input type="checkbox" ${co.addons.includes(a.id)?'checked':''} onchange="toggleAddon('${a.id}')">
        <div style="flex:1"><b>${esc(a.name)}</b></div>
        <b class="tnum">${money0(a.price,t.cur)}</b></label>`).join('')}`,

    /* 2 — participant info */ ()=>`
      <h3>Who is coming</h3>
      <p class="lede">You answer for everyone on this booking — the others never get a login.</p>
      <div class="co-f"><label>First name <span class="star">*</span></label>
        <input type="text" value="${esc(co.buyer.first)}" oninput="S.co.buyer.first=this.value" placeholder="Maya"></div>
      <div class="co-f"><label>Last name <span class="star">*</span></label>
        <input type="text" value="${esc(co.buyer.last)}" oninput="S.co.buyer.last=this.value" placeholder="Lindqvist"></div>
      <div class="co-f"><label>Email <span class="star">*</span></label>
        <input type="text" value="${esc(co.buyer.email)}" oninput="S.co.buyer.email=this.value" placeholder="you@example.com"></div>
      <div style="height:6px"></div>
      ${t.questions.map(q=>`<div class="co-f"><label>${esc(q.q)} ${q.req?'<span class="star">*</span>':''}</label>
        ${q.type==='dropdown'||q.type==='radio'
          ? `<select onchange="S.co.answers['${q.id}']=this.value">
               <option value="">Select…</option>
               ${q.opts.map(o=>`<option ${co.answers[q.id]===o?'selected':''}>${esc(o)}</option>`).join('')}
               ${q.other?'<option>Other</option>':''}</select>`
          : `<input type="text" value="${esc(co.answers[q.id]||'')}" oninput="S.co.answers['${q.id}']=this.value"
               placeholder="${q.type==='phone'?'Name and number':'Your answer'}">`}
      </div>`).join('')}
      <div class="note" style="margin:14px 0 0;border-left-color:var(--app-accent);background:var(--app-wait-bg);font-size:11.5px">
        A flat list — every traveller answers everything. There is no branching, so a beginner and a pro get
        the same eight questions.</div>`,

    /* 3 — sign */ ()=>`
      <h3>Sign the waiver</h3>
      <p class="lede">Please read and sign the document before completing your booking.</p>
      <div style="border:1px solid var(--app-border);border-radius:12px;padding:14px;display:flex;gap:11px;align-items:center">
        <span style="color:var(--app-teal)">${ICON.file}</span>
        <div style="flex:1"><b style="font-size:13px">${esc(t.esign.file)}</b>
          <div style="font-size:11.5px;color:var(--app-muted)">${esc(t.esign.size)} · PDF</div></div>
      </div>
      ${co.signed
        ? `<div style="margin-top:14px;text-align:center"><span class="t-pill ok" style="font-size:12px;padding:7px 13px">${ICON.check} Document signed</span>
             <div style="font-size:11.5px;color:var(--app-muted);margin-top:9px">Signed as ${esc(co.buyer.first||'you')} · ${fmtShort('2026-08-25')}</div></div>`
        : `<div class="co-f" style="margin-top:14px"><label>Type your full name to sign</label>
             <input type="text" placeholder="${esc((co.buyer.first+' '+co.buyer.last).trim()||'Your full name')}" id="sig"></div>
           <button class="t-cta t-cta-2" style="width:100%" onclick="signNow()">${ICON.sign} Sign document</button>`}
      <div class="note" style="margin:16px 0 0;border-left-color:var(--app-accent);background:var(--app-wait-bg);font-size:11.5px">
        This is a hard gate — payment will not open until it is signed. There are no fields on the PDF and
        no review afterwards: it is signed, or it is not.</div>`,

    /* 4 — payment */ ()=>`
      <h3>How you'd like to pay</h3>
      <p class="lede">Your room is held as soon as the deposit clears.</p>
      <label class="co-opt ${co.plan==='plan'?'on':''}">
        <input type="radio" name="pl" ${co.plan==='plan'?'checked':''} onchange="S.co.plan='plan';render()">
        <div style="flex:1"><b>Pay ${money0(deposit,t.cur)} now</b>
          <div class="d">Then ${inst} payments of ${money(perInst,t.cur)}</div>
          <div class="co-sched">
            <div><span>Deposit, due at booking</span><b>${money(deposit,t.cur)}</b></div>
            ${t.plan.dates.map((d,i)=>`<div><span>${i===inst-1?'Final':(i+1)+(i===0?'st':i===1?'nd':'rd')} payment, ${fmtShort(d)}</span><b>${money(perInst,t.cur)}</b></div>`).join('')}
          </div>
          <div style="font-size:11.5px;color:var(--app-muted);margin-top:8px">
            ${t.plan.autoBill?'We will charge this card automatically on the dates above.'
                             :'You will get an email with a link when each payment is due.'}</div>
        </div></label>
      <label class="co-opt ${co.plan==='full'?'on':''}">
        <input type="radio" name="pl" ${co.plan==='full'?'checked':''} onchange="S.co.plan='full';render()">
        <div style="flex:1"><b>Pay all ${money0(total,t.cur)} now</b>
          <div class="d">Nothing else to think about</div></div></label>

      <div style="height:8px"></div>
      <label style="font-size:12px;font-weight:600;display:block;margin-bottom:6px">Payment method</label>
      ${[['card','Card',ICON.card,`${FEES[t.cur].card}% processing`],
         ['bank','Bank transfer',ICON.bank,'No processing fee · clears in 5–7 days'],
         ['wallet','Apple Pay',ICON.phone,`${FEES[t.cur].wallet}% processing`]].map(([id,l,ic,note])=>`
        <label class="co-opt ${co.method===id?'on':''}" style="padding:11px">
          <input type="radio" name="pm" ${co.method===id?'checked':''} onchange="S.co.method='${id}';render()">
          <span style="color:var(--app-muted)">${ic}</span>
          <div style="flex:1"><b style="font-size:13px">${l}</b><div class="d" style="font-size:11.5px">${note}</div></div>
        </label>`).join('')}

      <div class="co-sum">
        <div class="r"><span>${esc(p.name)} × ${co.qty}</span><b>${money(p.price*co.qty,t.cur)}</b></div>
        ${co.addons.length?`<div class="r"><span>${co.addons.length} add-on${co.addons.length>1?'s':''}</span><b>${money(addTotal,t.cur)}</b></div>`:''}
        <div class="r"><span>Trip total</span><b>${money(total,t.cur)}</b></div>
        ${fee?`<div class="r"><span>Service fee</span><b>${money(fee,t.cur)}</b></div>`:''}
        <div class="r tot"><b>Due today</b><b>${money(dueNow+fee,t.cur)}</b></div>
        ${co.plan==='plan'?`<div class="r" style="padding-top:6px"><span>Due later</span><b>${money(total-deposit,t.cur)}</b></div>`:''}
      </div>
      ${fee===0?`<div style="font-size:11.5px;color:var(--app-ok);margin-top:9px;text-align:center;font-weight:600">
        No service fee on bank transfer — it costs nothing to process.</div>`:''}
      <p class="co-legal">By tapping Confirm booking you agree to
        <a href="#" onclick="return false">${esc(DB.operator.name)}'s terms and cancellation policy</a>.</p>`,

    /* 5 — done */ ()=>`
      <div style="text-align:center;padding:16px 0">
        <div style="width:62px;height:62px;border-radius:50%;background:var(--app-ok-bg);color:var(--app-ok);display:grid;place-items:center;margin:0 auto 14px">
          ${I('<path d="M20 6L9 17l-5-5"/>',30)}</div>
        <h3>You have booked your trip</h3>
        <p class="lede">Your receipt and booking details are on their way to
          <b style="color:var(--app-ink)">${esc(co.buyer.email||'your inbox')}</b>.</p>
      </div>
      <div class="mb-card" style="background:var(--app-wait-bg);border-color:transparent">
        <h4>A note from ${esc(DB.operator.name)}</h4>
        <p style="font-size:12.5px;color:var(--app-ink);margin:0;line-height:1.55">
          Stoked to have you. Bring reef boots and a rash vest — the Bukit is shallow and the sun is
          not subtle. We'll send the packing list two weeks out.</p></div>
      <div style="margin-top:8px">
        ${[['Complete the remaining info','Before you fly · due '+fmtShort(t.tasks[0]?.due||t.start)],
           ['Pay the outstanding balance', money0(total-dueNow,t.cur)+' left']].map(([a,b])=>`
          <div class="mb-row"><div class="g"><b style="font-weight:600">${a}</b><div class="s">${b}</div></div>
            <span style="color:var(--app-muted)">${ICON.chev}</span></div>`).join('')}
      </div>
      <button class="t-cta" style="width:100%;margin-top:16px" onclick="S.travellerView='booking';render()">View my booking</button>
      <button class="t-cta t-cta-2" style="width:100%;margin-top:8px;background:none;color:var(--app-teal);border:1px solid var(--app-border)"
        onclick="go('trip',{tripId:'${t.id}',tripTab:'bookings'})">See it land in the dashboard ${ICON.arrow}</button>`,
  ][co.step]();

  const canNext = [
    ()=>true,
    ()=>true,
    ()=>co.buyer.first && co.buyer.last && co.buyer.email && t.questions.filter(q=>q.req).every(q=>co.answers[q.id]),
    ()=>co.signed,
    ()=>true,
  ][co.step];

  return `<div class="co-head">
      <button class="icon-btn" onclick="${co.step?'S.co.step--':"S.travellerView='trip'"};render()">${ICON.back}</button>
      <b>${co.step>=5?'Booked':esc(t.name)}</b>
      <button class="icon-btn" onclick="S.travellerView='trip';S.co.step=0;render()">${ICON.x}</button>
    </div>
    ${co.step<5?`<div class="co-steps">${CO_STEPS.map((s,i)=>
      `<i class="${i<co.step?'done':i===co.step?'on':''}" title="${s}"></i>`).join('')}</div>`:''}
    <div class="phone-scroll"><div class="co-body">${body}</div></div>
    ${co.step<5?`<div class="t-dock">
      ${co.step===4?`<div class="p"><b>${money(dueNow+fee,t.cur)}</b><span>due today</span></div>`:''}
      <button class="t-cta" ${canNext()?'':'disabled'} onclick="${co.step===4?'confirmBooking()':'S.co.step++;render()'}">
        ${co.step===4?'Confirm booking':'Continue'}</button>
    </div>`:''}`;
}

/* ── Manage booking ────────────────────────────────────────────────────── */
function phBooking(t){
  const b = DB.bookings.find(x=>x.id===(S.bookingId||'b1')) || DB.bookings[0];
  const bt = trip(b.trip), total = bookingTotal(b), paid = bookingPaid(b);
  const next = b.sched.find(r=>r.status==='pastdue') || b.sched.find(r=>r.status==='due') || b.sched.find(r=>r.status==='scheduled');
  const dleft = daysFrom(bt.start);
  const todo = [];
  if(bookingDueNow(b)) todo.push(['Make a payment', money(bookingDueNow(b),bt.cur), bookingPastDue(b)?'Past due':'Due']);
  if(!b.signed) todo.push(['Sign your document','Liability waiver','Missing']);
  if(!tasksComplete(bt,b.participants[0])) todo.push(['Complete your info','Before you fly','Due soon']);

  return `<div class="co-head"><button class="icon-btn">${ICON.back}</button><b>Manage booking</b></div>
  <div class="phone-scroll"><div class="co-body">
    <div class="t-banner">
      <h4>${dleft>0?`${dleft} days until your trip`:'We hope you enjoyed it'}</h4>
      <p>${esc(bt.name)} · ${fmtRange(bt.start,bt.end)}</p>
      ${todo.length?`<div style="font-size:11.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;opacity:.85;margin-bottom:7px">Let's get you prepared</div>
        ${todo.map(([a,b2,c])=>`<div class="t-task">${a}<span class="t-pill">${c}</span></div>`).join('')}`
      :`<div class="t-task">${ICON.check} You are all set</div>`}
    </div>

    <div class="mb-card"><h4>Your booking</h4>
      <div class="mb-row"><div class="g"><b style="font-weight:600">${esc(pkgOf(bt,b.pkg)?.name)}</b>
        <div class="s">${headcount(b)} traveller${headcount(b)>1?'s':''}</div></div>
        <b>${money(pkgOf(bt,b.pkg).price*b.qty,bt.cur)}</b></div>
      ${b.addons.map(id=>{const a=bt.addons.find(x=>x.id===id);return `
        <div class="mb-row"><div class="g">${esc(a.name)}</div><b>${money(a.price*b.qty,bt.cur)}</b></div>`;}).join('')}
      <div class="mb-row"><div class="g"><b>Booking total</b></div><b>${money(total,bt.cur)}</b></div>
    </div>

    <div class="mb-card"><h4>Payments
      ${bookingPastDue(b)?'<span class="t-pill bad">Past due</span>':bookingBalance(b)===0?'<span class="t-pill ok">Paid in full</span>':''}</h4>
      ${b.sched.map(r=>`<div class="mb-row">
        <div class="g"><b style="font-weight:600">${esc(r.label)}</b>
          <div class="s">${r.due==='booking'?'Due at booking':fmtShort(r.due)+' · '+relDays(r.due)}</div></div>
        <div style="text-align:right"><b>${money(r.amount,bt.cur)}</b>
          <div style="margin-top:3px">${
            r.status==='paid'?'<span class="t-pill ok">Paid</span>'
            :r.status==='pastdue'?'<span class="t-pill bad">Past due</span>'
            :r.status==='failed'?'<span class="t-pill bad">Failed</span>'
            :r.status==='due'?'<span class="t-pill warn">Due now</span>'
            :'<span class="t-pill">Scheduled</span>'}</div></div></div>`).join('')}
      <div style="display:flex;gap:8px;margin-top:11px">
        ${bookingBalance(b)?`<button class="t-cta" style="flex:1;font-size:13px;padding:11px" onclick="payFromPhone('${b.id}')">Make a payment</button>`:''}
        <button class="t-cta t-cta-2" style="flex:1;font-size:13px;padding:11px;background:none;color:var(--app-teal);border:1px solid var(--app-border)">View plan</button>
      </div>
      ${b.autoBill?`<div style="font-size:11.5px;color:var(--app-muted);margin-top:9px;text-align:center">
        Auto-billing is on — we charge the card on file on each date.</div>`:''}
    </div>

    <div class="mb-card"><h4>Your details</h4>
      ${bt.questions.slice(0,3).map(q=>`<div class="mb-row"><div class="g">${esc(q.q)}</div>
        <span style="font-size:12.5px;color:var(--app-muted);max-width:130px;text-align:right">${esc(b.participants[0].answers?.[q.id]||'—')}</span></div>`).join('')}
      <div class="mb-row"><div class="g">Liability waiver</div>
        ${b.signed?'<span class="t-pill ok">Signed</span>':`<button class="t-pill warn" style="border:0" onclick="signFor('${b.id}','${esc(b.participants[0].name)}')">Sign now</button>`}</div>
    </div>

    <div class="mb-card"><h4>Need to change something?</h4>
      <p style="font-size:12.5px;color:var(--app-muted);margin:0 0 11px;line-height:1.55">
        For anything about the trip, or to cancel, message ${esc(DB.operator.name)} directly.</p>
      <button class="t-cta t-cta-2" style="width:100%;font-size:13px;padding:11px">Message the organiser</button>
      <div style="font-size:11px;color:var(--app-muted);margin-top:10px;text-align:center;font-style:italic">
        There is no cancel button anywhere in here, by design.</div>
    </div>
  </div></div>`;
}
