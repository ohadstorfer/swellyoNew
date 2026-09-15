/* ═══════════════════════════════════════════════════════════════════════════
   ACTIONS — the things that actually change the model
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Payment plan ──────────────────────────────────────────────────────── */
let PLAN = null;
function planModal(tripId, pkgId){
  const t = trip(tripId), p = pkgOf(t,pkgId);
  PLAN = { tripId, pkgId, n:t.plan.installments, deposit:p.deposit,
           dates:[...t.plan.dates], amounts:null,
           autoBill:t.plan.autoBill, partial:t.plan.partial, autoAdjust:t.plan.autoAdjust };
  rebuildPlan();
  drawPlan();
}
function rebuildPlan(){
  const t = trip(PLAN.tripId), p = pkgOf(t,PLAN.pkgId);
  const rest = p.price - PLAN.deposit;
  const each = Math.round(rest / PLAN.n * 100) / 100;
  PLAN.amounts = Array.from({length:PLAN.n},(_,i)=>
    i === PLAN.n-1 ? Math.round((rest - each*(PLAN.n-1))*100)/100 : each);
  /* monthly dates, ending a fortnight before departure */
  const end = new Date(t.start+'T00:00:00Z'); end.setUTCDate(end.getUTCDate()-14);
  PLAN.dates = Array.from({length:PLAN.n},(_,i)=>{
    const d = new Date(end); d.setUTCMonth(d.getUTCMonth() - (PLAN.n-1-i));
    return d.toISOString().slice(0,10);
  });
}
function drawPlan(){
  const t = trip(PLAN.tripId), p = pkgOf(t,PLAN.pkgId);
  const sum = PLAN.deposit + PLAN.amounts.reduce((a,b)=>a+b,0);
  const ok = Math.abs(sum - p.price) < 0.02;
  const label = i => i===PLAN.n-1 ? 'Final Payment'
    : `${i+1}${['st','nd','rd'][i]||'th'} Payment`;

  openModal(`<div class="modal" style="width:min(660px,100%)">
    <div class="modal-head"><div><h3>Payment plan</h3>
      <p>${esc(p.name)} · ${money(p.price,t.cur)} per person</p></div>
      <button class="x" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="field"><label>Number of payments</label>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
          <span style="font-size:13px;color:var(--muted)">Deposit plus</span></div>
        <div class="numgrid">${Array.from({length:24},(_,i)=>i+1).map(n=>
          `<button aria-pressed="${PLAN.n===n}" onclick="PLAN.n=${n};rebuildPlan();drawPlan()">${n}</button>`).join('')}</div>
      </div>

      <div class="field" style="margin-top:18px"><label>Payment dates</label></div>
      <div class="sched-row">
        <span class="lbl">Deposit</span>
        <span class="fixed">Due at booking</span>
        <div class="money-in"><span>${CUR[t.cur].s}</span>
          <input type="number" value="${PLAN.deposit}" onchange="PLAN.deposit=parseFloat(this.value)||0;rebuildPlan();drawPlan()"></div>
      </div>
      ${PLAN.amounts.map((a,i)=>`<div class="sched-row">
        <span class="lbl">${label(i)}</span>
        <input type="date" value="${PLAN.dates[i]}" onchange="PLAN.dates[${i}]=this.value;drawPlan()">
        <div class="money-in"><span>${CUR[t.cur].s}</span>
          <input type="number" value="${a}" onchange="PLAN.amounts[${i}]=parseFloat(this.value)||0;drawPlan()"></div>
      </div>`).join('')}
      <div class="sched-tot">
        <span style="color:var(--muted)">Must add up to ${money(p.price,t.cur)}</span>
        <b class="${ok?'':'mismatch'}">${money(sum,t.cur)}</b>
        ${ok?'<span class="pill pill-ok">Balances</span>':`<span class="pill pill-danger">Off by ${money(Math.abs(sum-p.price),t.cur)}</span>`}
      </div>

      <div style="border-top:1px solid var(--line);margin-top:16px;padding-top:8px">
        <label class="switch"><input type="checkbox" ${PLAN.partial?'checked':''} onchange="PLAN.partial=this.checked">
          <span><span class="sw-l">Allow partial payment</span>
          <span class="sw-d">Travellers can pay any amount they like — but only once the deposit is fully paid.</span></span></label>
        <label class="switch"><input type="checkbox" ${PLAN.autoBill?'checked':''} onchange="PLAN.autoBill=this.checked;drawPlan()">
          <span><span class="sw-l">Enable auto-billing</span>
          <span class="sw-d">${PLAN.autoBill?'Charges the card on file on each date, in one nightly batch. Cards and local bank only — never wire.'
            :'Off. Every installment becomes a reminder email and a link, and someone has to act on it.'}</span></span></label>
        <label class="switch"><input type="checkbox" ${PLAN.autoAdjust?'checked':''} onchange="PLAN.autoAdjust=this.checked">
          <span><span class="sw-l">Auto-adjust for late bookings</span>
          <span class="sw-d">If someone books after a date has passed, the missed amounts spread across what is left.</span></span></label>
      </div>
      <div class="note" style="margin:16px 0 0">There is no late fee anywhere in this product. A missed
        installment simply rolls into the next one.</div>
    </div>
    <div class="modal-foot">
      <span style="font-size:12.5px;color:var(--muted)">Applies to everyone who books from now on.</span>
      <div class="spacer"></div>
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" ${ok?'':'disabled'} onclick="savePlan()">Save plan</button>
    </div></div>`);
}
function savePlan(){
  const t = trip(PLAN.tripId);
  t.plan.installments = PLAN.n;
  t.plan.dates = [...PLAN.dates];
  t.plan.autoBill = PLAN.autoBill;
  t.plan.partial = PLAN.partial;
  t.plan.autoAdjust = PLAN.autoAdjust;
  const p = pkgOf(t,PLAN.pkgId); p.deposit = PLAN.deposit;
  closeModal(); render();
  toast(`Plan saved — <b>${PLAN.n} payment${PLAN.n>1?'s':''}</b> after a ${money0(PLAN.deposit,t.cur)} deposit. Checkout now shows this schedule.`);
}

/* ── Booking drawer ────────────────────────────────────────────────────── */
function openBooking(id){
  const b = DB.bookings.find(x=>x.id===id), t = trip(b.trip);
  const total = bookingTotal(b), paid = bookingPaid(b), bal = total-paid;
  const p = pkgOf(t,b.pkg);
  openModal(`<div class="modal" style="width:min(680px,100%)">
    <div class="modal-head">
      <span class="av av-lg">${initials(b.buyer)}</span>
      <div style="flex:1"><h3>${esc(b.buyer)}</h3>
        <p>${esc(b.email)} · ${headcount(b)} going · booked ${fmtShort(b.booked)}</p></div>
      <button class="x" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="grid-3" style="margin-bottom:16px">
        ${statCard('Booking total', money(total,t.cur),'')}
        ${statCard('Paid', money(paid,t.cur),'','var(--ok)')}
        ${statCard('Balance due', money(bal,t.cur), bookingPastDue(b)?money(bookingPastDue(b),t.cur)+' past due':'', bookingPastDue(b)?'var(--danger)':'')}
      </div>
      <h4 style="font-size:13px;margin-bottom:9px">Schedule</h4>
      <div class="tbl-wrap" style="border:1px solid var(--line)"><table>
        <tbody>${b.sched.map((r,i)=>`<tr>
          <td><b>${esc(r.label)}</b><div style="font-size:11.5px;color:var(--muted)">
            ${r.due==='booking'?'Due at booking':fmtShort(r.due)+' · '+relDays(r.due)}</div></td>
          <td class="num tnum">${money(r.amount,t.cur)}</td>
          <td>${r.status==='paid'?`<span class="pill pill-ok">Paid ${r.paidOn?fmtShort(r.paidOn):''}</span>`
            :r.status==='pastdue'?'<span class="pill pill-danger"><span class="dot"></span>Past due</span>'
            :r.status==='failed'?`<span class="pill pill-danger">Failed</span><div style="font-size:11px;color:var(--muted);margin-top:2px">${esc(r.reason||'')}</div>`
            :r.status==='due'?'<span class="pill pill-warn">Due now</span>':'<span class="pill">Scheduled</span>'}</td>
          <td class="num">${r.status==='paid'?'':
            `<button class="btn btn-sm" onclick="takePayment('${b.id}',${i})">${r.status==='failed'?'Retry':'Record payment'}</button>`}</td>
        </tr>`).join('')}</tbody></table></div>

      <h4 style="font-size:13px;margin:18px 0 9px">Paperwork</h4>
      <div style="display:grid;gap:7px">
        ${b.participants.map(pt=>`<div style="display:flex;align-items:center;gap:10px;padding:9px 11px;border:1px solid var(--line);border-radius:var(--r-sm)">
          <span class="av av-sm">${initials(pt.name)}</span>
          <b style="flex:1;font-size:13px">${esc(pt.name)}</b>
          ${questionsComplete(t,pt)?'<span class="pill pill-ok">Info complete</span>':'<span class="pill pill-warn">Info missing</span>'}
          ${pt.signed?'<span class="pill pill-ok">Signed</span>'
            :`<button class="btn btn-sm" onclick="signFor('${b.id}','${esc(pt.name)}')">Mark signed</button>`}
        </div>`).join('')}
      </div>
      ${b.note?`<div class="note" style="margin-top:16px"><b>Your note:</b> ${esc(b.note)}</div>`:''}
    </div>
    <div class="modal-foot">
      <button class="btn btn-sm" onclick="toast('Message sent to ${esc(b.buyer)}.')">Send message</button>
      <button class="btn btn-sm" onclick="planForBooking('${b.id}')">Edit payment plan</button>
      <div class="spacer"></div>
      <button class="btn btn-sm btn-danger" onclick="refundModal('${b.id}')">Cancel or refund</button>
    </div></div>`);
}
function planForBooking(id){
  const b = DB.bookings.find(x=>x.id===id);
  closeModal(); planModal(b.trip, b.pkg);
}

/* ── Taking money ──────────────────────────────────────────────────────── */
function takePayment(id, i){
  const b = DB.bookings.find(x=>x.id===id), t = trip(b.trip), r = b.sched[i];
  r.status = 'paid';
  r.paidOn = TODAY.toISOString().slice(0,10);
  r.method = r.method || 'card';
  closeModal(); render();
  const left = bookingBalance(b);
  toast(`${money(r.amount,t.cur)} recorded for <b>${esc(b.buyer)}</b>. ${left?money(left,t.cur)+' still outstanding.':'Paid in full.'}`);
}
function payFromPhone(id){
  const b = DB.bookings.find(x=>x.id===id);
  const i = b.sched.findIndex(r=>r.status==='pastdue');
  const j = i>=0 ? i : b.sched.findIndex(r=>r.status==='due');
  const k = j>=0 ? j : b.sched.findIndex(r=>r.status!=='paid');
  if(k<0) return;
  takePayment(id,k);
}

function refundModal(id){
  const b = DB.bookings.find(x=>x.id===id), t = trip(b.trip);
  const paid = bookingPaid(b);
  openModal(`<div class="modal">
    <div class="modal-head"><div><h3>Cancel or refund</h3>
      <p>${esc(b.buyer)} · ${money(paid,t.cur)} taken so far</p></div>
      <button class="x" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div style="display:grid;gap:8px">
        ${[['both','Cancel and refund','Take the spot back and send the money.'],
           ['cancel','Cancel only','Free the spot. Nothing moves financially — you settle up another way.'],
           ['refund','Refund only','Send money back but keep them on the trip.']].map(([v,a,d])=>`
          <label class="radio-row" onclick="this.parentNode.querySelectorAll('.radio-row').forEach(x=>x.classList.remove('on'));this.classList.add('on')">
            <input type="radio" name="rf" ${v==='both'?'checked':''}>
            <div><b style="font-size:13px">${a}</b><div style="font-size:12px;color:var(--muted);margin-top:2px">${d}</div></div></label>`).join('')}
      </div>
      <div class="field" style="margin-top:16px"><label>How much to send back</label>
        <div class="money-in"><span>${CUR[t.cur].s}</span><input type="number" value="${paid}" id="rfamt"></div>
        <div class="hint">Anything you hold back has to be accounted for — the product makes you say which.</div></div>
      <div style="display:grid;gap:8px">
        <label class="radio-row on"><input type="radio" name="diff" checked>
          <div><b style="font-size:13px">Keep the difference</b>
            <div style="font-size:12px;color:var(--muted)">It becomes a cancellation fee.</div></div></label>
        <label class="radio-row"><input type="radio" name="diff">
          <div><b style="font-size:13px">Apply the difference to the remaining balance</b>
            <div style="font-size:12px;color:var(--muted)">Only possible while something is still owed.</div></div></label>
      </div>
      <div class="note" style="margin-top:16px">The traveller always receives the full amount you type. The
        platform hands back its own fee — but the <b>card processing fee is gone for good</b> and comes out
        of your balance. Refunding a card payment always costs you something.</div>
    </div>
    <div class="modal-foot"><div class="spacer"></div>
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="doRefund('${b.id}')">Refund</button></div></div>`);
}
function doRefund(id){
  const b = DB.bookings.find(x=>x.id===id), t = trip(b.trip);
  const amt = parseFloat($('#rfamt').value)||0;
  const fee = processingFee(amt, t.cur, 'card');
  b.sched.forEach(r=>{ if(r.status==='paid'){ r.status='refunded'; } });
  b.sched = b.sched.filter(r=>r.status!=='refunded');
  b.sched.unshift({ label:'Refunded', due:TODAY.toISOString().slice(0,10), amount:0, status:'paid', paidOn:TODAY.toISOString().slice(0,10), method:'card' });
  closeModal(); render();
  toast(`${money(amt,t.cur)} refunded to <b>${esc(b.buyer)}</b>. The ${money(fee,t.cur)} processing fee came out of your balance.`);
}

/* ── Paperwork ─────────────────────────────────────────────────────────── */
function signFor(bid, name){
  const b = DB.bookings.find(x=>x.id===bid);
  const p = b.participants.find(x=>x.name===name);
  if(p) p.signed = true;
  b.signed = b.participants.every(x=>x.signed);
  closeModal(); render();
  toast(`Waiver marked signed for <b>${esc(name)}</b>.`);
}
function signNow(){
  const v = ($('#sig')||{}).value;
  S.co.signed = true; render();
  toast('Document signed.');
}
function chase(tripId, kind){
  const t = trip(tripId), s = tripStats(t);
  const n = kind==='signature' ? s.unsigned : s.people - s.checkoutDone;
  toast(`Sent to the <b>${n}</b> ${n===1?'person':'people'} missing it — with the right link attached.`);
}

/* ── Form builder ──────────────────────────────────────────────────────── */
function qList(t, ctx){ return ctx==='checkout' ? t.questions : t.tasks.find(k=>k.id===ctx).questions; }
function addQ(ctx){
  const t = trip(S.tripId);
  qList(t,ctx).push({ id:'q'+Math.round(performance.now()*1000), q:'New question', type:'text', req:false });
  render();
}
function delQ(ctx,id){
  const t = trip(S.tripId), l = qList(t,ctx);
  const i = l.findIndex(q=>q.id===id);
  if(i>=0) l.splice(i,1);
  render(); toast('Question removed. Any answers already given go with it.');
}
function toggleReq(ctx,id){
  const q = qList(trip(S.tripId),ctx).find(x=>x.id===id);
  q.req = !q.req; render();
}
function renameQ(ctx,id,v){
  const q = qList(trip(S.tripId),ctx).find(x=>x.id===id);
  q.q = v; render();
}

/* ── Settings ──────────────────────────────────────────────────────────── */
function setFee(key,val){
  DB.settings[key] = val; render();
  const who = val==='organizer' ? 'you' : 'the traveller';
  toast(`${key==='wtFeePaidBy'?'Platform fee':'Processing fees'} now paid by <b>${who}</b>. Checkout and the ledger both moved.`);
}

/* ── CRM ───────────────────────────────────────────────────────────────── */
function advanceOpp(id){
  const o = DB.opportunities.find(x=>x.id===id);
  const names = DB.stages.map(s=>s.name);
  o.stage = names[(names.indexOf(o.stage)+1) % names.length];
  o.lastAct = TODAY.toISOString().slice(0,10);
  render();
  toast(`<b>${esc(o.title)}</b> moved to ${esc(o.stage)}.`);
}

/* ── Checkout ──────────────────────────────────────────────────────────── */
function toggleAddon(id){
  const i = S.co.addons.indexOf(id);
  if(i>=0) S.co.addons.splice(i,1); else S.co.addons.push(id);
  render();
}
function confirmBooking(){
  const co = S.co, t = trip(S.tripId), p = pkgOf(t,co.pkg);
  const total = p.price*co.qty + co.addons.reduce((s,id)=>s+(t.addons.find(a=>a.id===id)?.price||0),0)*co.qty;
  const deposit = p.deposit*co.qty;
  const today = TODAY.toISOString().slice(0,10);
  const name = `${co.buyer.first} ${co.buyer.last}`.trim() || 'New Traveller';
  const inst = t.plan.installments;
  const per = Math.round((total-deposit)/inst*100)/100;

  /* Build the schedule. If dates have already passed — which they will for
     anyone booking late — `Auto-adjust for late bookings` drops those rows and
     spreads what they were worth across the dates that are left. With every
     date gone, the whole balance falls due at checkout. Without the setting,
     the missed installments simply land as past due on day one. */
  let sched;
  if(co.plan === 'full'){
    sched = [{ label:'Full payment', due:'booking', amount:total, status:'paid', paidOn:today, method:co.method }];
  } else {
    const deposited = { label:'Deposit', due:'booking', amount:deposit, status:'paid', paidOn:today, method:co.method };
    const future = t.plan.dates.filter(d => daysFrom(d) >= 0);
    if(t.plan.autoAdjust && future.length){
      const each = Math.round((total-deposit) / future.length * 100) / 100;
      sched = [deposited, ...future.map((d,i)=>({
        label: i===future.length-1 ? 'Final Payment' : `${i+1}${['st','nd','rd'][i]||'th'} Payment`,
        due:d,
        amount: i===future.length-1
          ? Math.round((total-deposit-each*(future.length-1))*100)/100 : each,
        status: daysFrom(d) <= 14 ? 'due' : 'scheduled' }))];
    } else if(t.plan.autoAdjust){
      sched = [deposited, { label:'Balance', due:today, amount:total-deposit, status:'due' }];
    } else {
      sched = [deposited, ...t.plan.dates.map((d,i)=>({
        label: i===inst-1 ? 'Final Payment' : `${i+1}${['st','nd','rd'][i]||'th'} Payment`,
        due:d, amount: i===inst-1 ? Math.round((total-deposit-per*(inst-1))*100)/100 : per,
        status: daysFrom(d) < 0 ? 'pastdue' : daysFrom(d) <= 14 ? 'due' : 'scheduled' }))];
    }
  }

  const id = 'b'+(DB.bookings.length+1)+Math.round(performance.now());
  DB.bookings.push({
    id, trip:t.id, buyer:name, email:co.buyer.email||'traveller@example.com',
    pkg:co.pkg, qty:co.qty, addons:[...co.addons], booked:today,
    autoBill:t.plan.autoBill, signed:co.signed, note:'Booked from the traveller view.',
    participants: Array.from({length:co.qty},(_,i)=>({
      name: i===0 ? name : `${name} — guest ${i+1}`,
      email: i===0 ? (co.buyer.email||'traveller@example.com') : '',
      signed: i===0 ? co.signed : false,
      answers:{...co.answers}, task:{} })),
    sched,
  });
  p.sold += co.qty;
  if(!DB.contacts.some(c=>c.email===co.buyer.email) && co.buyer.email){
    DB.contacts.push({ id:'c'+(DB.contacts.length+1), name, email:co.buyer.email, phone:'—',
      country:'—', tags:['New'], trips:1, lastBooking:today, booked:total, source:'Direct booking' });
  }
  S.bookingId = id;
  S.co.step = 5; render();
  toast(`Booked. <b>${esc(name)}</b> is now in the Bali trip's Bookings tab.`);
}

/* ── Odds and ends ─────────────────────────────────────────────────────── */
function openParticipant(bid,name){
  const b = DB.bookings.find(x=>x.id===bid), t = trip(b.trip);
  const p = b.participants.find(x=>x.name===name);
  const all = [...t.questions.map(q=>[q,p.answers?.[q.id],'Checkout']),
               ...t.tasks.flatMap(k=>k.questions.map(q=>[q,p.task?.[q.id],k.name]))];
  openModal(`<div class="modal">
    <div class="modal-head"><span class="av av-lg">${initials(p.name)}</span>
      <div style="flex:1"><h3>${esc(p.name)}</h3><p>${esc(p.email||'No email on file')} · booked by ${esc(b.buyer)}</p></div>
      <button class="x" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="tbl-wrap" style="border:1px solid var(--line)"><table>
        <thead><tr><th>Question</th><th>Answer</th><th>Asked</th></tr></thead>
        <tbody>${all.map(([q,a,where])=>`<tr>
          <td>${esc(q.q)}${q.req?' <span style="color:var(--danger)">*</span>':''}</td>
          <td>${a ? (q.type==='file'?`<span class="pill pill-ok">${ICON.file} ${esc(a)}</span>`:esc(a))
                  : '<span class="pill pill-warn">Missing</span>'}</td>
          <td style="color:var(--muted);font-size:12px">${esc(where)}</td></tr>`).join('')}</tbody></table></div>
      <div style="margin-top:14px;display:flex;gap:9px;align-items:center">
        ${p.signed?'<span class="pill pill-ok">Waiver signed</span>'
          :`<button class="btn btn-sm" onclick="signFor('${b.id}','${esc(p.name)}')">Mark waiver signed</button>`}
      </div>
    </div>
    <div class="modal-foot"><div class="spacer"></div>
      <button class="btn" onclick="closeModal()">Close</button></div></div>`);
}
function addParticipant(tripId){
  toast('In the real product this books somebody in by hand — and skips the questionnaire.');
}
function audienceFor(t, v){
  const s = tripStats(t);
  if(v.includes('past due'))   return bookingsOf(t.id).filter(b=>bookingPastDue(b)).flatMap(b=>b.participants).length;
  if(v.includes('incomplete')) return s.people - s.checkoutDone;
  if(v.includes('signature'))  return s.unsigned;
  return s.people;
}
function msgCount(){
  const t = trip(S.tripId), v = $('#msg-to').value, el = $('#msg-n');
  if(!el) return;
  if(v.includes('Specific')){ el.innerHTML = 'Pick the people yourself.'; return; }
  const n = audienceFor(t, v);
  el.innerHTML = n ? `Resolves to <b>${n}</b> ${n===1?'person':'people'} right now.`
                   : 'Nobody matches — which is the answer you want.';
}
function sendMessage(tripId){
  const t = trip(tripId), v = ($('#msg-to')||{value:'Everyone on this trip'}).value;
  const n = v.includes('Specific') ? 0 : audienceFor(t, v);
  toast(n ? `Sent to <b>${n}</b> ${n===1?'person':'people'}.` : 'Nobody matched that audience — nothing sent.');
}
