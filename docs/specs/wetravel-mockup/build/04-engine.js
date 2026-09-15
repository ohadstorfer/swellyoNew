/* ═══════════════════════════════════════════════════════════════════════════
   DERIVATIONS — everything on screen is computed, nothing is hard-coded twice
   ═══════════════════════════════════════════════════════════════════════════ */

const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
const esc = s => String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const trip    = id => DB.trips.find(t=>t.id===id);
const pkgOf   = (t,id) => t.packages.find(p=>p.id===id);
const contact = id => DB.contacts.find(c=>c.id===id);
const bookingsOf = id => DB.bookings.filter(b=>b.trip===id);

function money(n, cur='USD', dp=2){
  const c = CUR[cur] || CUR.USD;
  return c.s + Number(n).toLocaleString('en-US',{minimumFractionDigits:dp, maximumFractionDigits:dp});
}
const money0 = (n,cur) => money(n,cur,0);

function fmtDate(d){
  if(!d || d==='booking') return 'Due at booking';
  return new Date(d+'T00:00:00Z').toLocaleDateString('en-US',{month:'short', day:'numeric', year:'numeric', timeZone:'UTC'});
}
function fmtShort(d){
  return new Date(d+'T00:00:00Z').toLocaleDateString('en-US',{month:'short', day:'numeric', timeZone:'UTC'});
}
function fmtRange(a,b){
  const A=new Date(a+'T00:00:00Z'), B=new Date(b+'T00:00:00Z');
  const m=d=>d.toLocaleDateString('en-US',{month:'short',timeZone:'UTC'}), n=d=>d.getUTCDate();
  return m(A)===m(B) ? `${m(A)} ${n(A)}–${n(B)}, ${B.getUTCFullYear()}`
                     : `${m(A)} ${n(A)} – ${m(B)} ${n(B)}, ${B.getUTCFullYear()}`;
}
function daysFrom(d){
  if(!d || d==='booking') return 0;
  return Math.round((new Date(d+'T00:00:00Z') - TODAY) / 86400000);
}
function relDays(d){
  const n = daysFrom(d);
  if(n === 0)  return 'today';
  if(n === 1)  return 'tomorrow';
  if(n > 0)    return `in ${n} days`;
  if(n === -1) return '1 day ago';
  return `${-n} days ago`;
}
const initials = n => n.split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase();

/* ── Booking money ─────────────────────────────────────────────────────── */
function bookingTotal(b){
  const t = trip(b.trip), p = pkgOf(t, b.pkg);
  const base = (p ? p.price : 0) * b.qty;
  const add  = (b.addons||[]).reduce((s,id)=>{
    const a = t.addons.find(x=>x.id===id);
    return s + (a ? a.price * b.qty : 0);
  },0);
  return base + add;
}
const bookingPaid    = b => b.sched.filter(r=>r.status==='paid').reduce((s,r)=>s+r.amount,0);
const bookingBalance = b => bookingTotal(b) - bookingPaid(b);
const bookingPastDue = b => b.sched.filter(r=>r.status==='pastdue').reduce((s,r)=>s+r.amount,0);
const bookingDueNow  = b => b.sched.filter(r=>r.status==='due'||r.status==='pastdue').reduce((s,r)=>s+r.amount,0);
const bookingLater   = b => b.sched.filter(r=>r.status==='scheduled').reduce((s,r)=>s+r.amount,0);
const bookingFailed  = b => b.sched.filter(r=>r.status==='failed').reduce((s,r)=>s+r.amount,0);
const headcount      = b => b.participants.length;

function bookingStatus(b){
  if(bookingFailed(b))            return { k:'danger', t:'Payment failed' };
  if(bookingPastDue(b))           return { k:'danger', t:'Past due' };
  if(bookingBalance(b) === 0)     return { k:'ok',     t:'Paid in full' };
  if(b.sched.some(r=>r.status==='due')) return { k:'warn', t:'Due now' };
  return { k:'wait', t:'On plan' };
}

/* ── Trip roll-ups ─────────────────────────────────────────────────────── */
function tripStats(t){
  const bs = bookingsOf(t.id);
  const s = {
    bookings: bs.length,
    going: bs.reduce((n,b)=>n+headcount(b),0),
    cap: t.cap,
    expected: bs.reduce((n,b)=>n+bookingTotal(b),0),
    paid: bs.reduce((n,b)=>n+bookingPaid(b),0),
    pastDue: bs.reduce((n,b)=>n+bookingPastDue(b),0),
    dueNow: bs.reduce((n,b)=>n+bookingDueNow(b),0),
    later: bs.reduce((n,b)=>n+bookingLater(b),0),
    failed: bs.reduce((n,b)=>n+bookingFailed(b),0),
  };
  s.balance = s.expected - s.paid;
  /* paperwork */
  const ps = bs.flatMap(b=>b.participants);
  s.people = ps.length;
  s.signed = ps.filter(p=>p.signed).length;
  s.unsigned = s.people - s.signed;
  s.checkoutDone = ps.filter(p=>questionsComplete(t,p)).length;
  s.tasksDone = ps.filter(p=>tasksComplete(t,p)).length;
  return s;
}

function questionsComplete(t,p){
  return t.questions.filter(q=>q.req).every(q => (p.answers?.[q.id]||'').trim() !== '');
}
function tasksComplete(t,p){
  const req = t.tasks.flatMap(tk=>tk.questions.filter(q=>q.req));
  if(!req.length) return true;
  return req.every(q => (p.task?.[q.id]||'').trim() !== '');
}

/* ── Fees ──────────────────────────────────────────────────────────────── */
function platformFee(amount){
  return Math.max(DB.settings.platformFeeMin, amount * DB.settings.platformFeePct / 100);
}
function processingFee(amount, cur, method='card'){
  const f = FEES[cur] || FEES.USD;
  if(method === 'bank') return 0;
  if(method === 'wire') return f.wire;
  return amount * (f[method] ?? f.card) / 100;
}
/* What the traveller is asked to pay on top, given the "Who pays the fees?" setting */
function travellerAddOn(amount, cur, method){
  let add = 0;
  if(DB.settings.wtFeePaidBy === 'participant')      add += platformFee(amount);
  if(DB.settings.paymentFeesPaidBy === 'participant') add += processingFee(amount, cur, method);
  return Math.round(add*100)/100;
}

/* ── Portfolio roll-up ─────────────────────────────────────────────────── */
function portfolio(cur='USD'){
  const ts = DB.trips.filter(t=>t.cur===cur && t.status!=='draft');
  const acc = { expected:0, paid:0, pastDue:0, dueNow:0, later:0, failed:0, going:0, unsigned:0, incomplete:0 };
  ts.forEach(t=>{
    const s = tripStats(t);
    acc.expected+=s.expected; acc.paid+=s.paid; acc.pastDue+=s.pastDue;
    acc.dueNow+=s.dueNow; acc.later+=s.later; acc.failed+=s.failed;
    acc.going+=s.going; acc.unsigned+=s.unsigned;
    acc.incomplete += s.people - s.checkoutDone;
  });
  acc.balance = acc.expected - acc.paid;
  return acc;
}

/* Upcoming payments, bucketed by month — the one forward-looking view */
function upcomingByMonth(cur='USD'){
  const buckets = new Map();
  DB.bookings.forEach(b=>{
    const t = trip(b.trip);
    if(t.cur !== cur) return;
    b.sched.forEach(r=>{
      if(r.status==='paid' || r.due==='booking') return;
      const key = r.due.slice(0,7);
      if(!buckets.has(key)) buckets.set(key,{due:0,past:0});
      const bk = buckets.get(key);
      if(r.status==='pastdue') bk.past += r.amount; else bk.due += r.amount;
    });
  });
  return [...buckets.entries()].sort((a,b)=>a[0]<b[0]?-1:1)
    .map(([k,v])=>({ month:k, label:new Date(k+'-01T00:00:00Z').toLocaleDateString('en-US',{month:'short',timeZone:'UTC'}), ...v }));
}

/* Ledger — synthesised from every paid row plus the recorded payouts */
function ledger(cur='USD'){
  const rows = [];
  DB.bookings.forEach(b=>{
    const t = trip(b.trip);
    if(t.cur !== cur) return;
    b.sched.forEach((r,i)=>{
      if(r.status !== 'paid') return;
      const pf = processingFee(r.amount, cur, r.method||'card');
      const wf = platformFee(r.amount);
      rows.push({
        date:r.paidOn, type:'Payment', method:r.method||'card', amount:r.amount,
        fee: DB.settings.paymentFeesPaidBy==='organizer' ? pf : 0,
        wt:  DB.settings.wtFeePaidBy==='organizer' ? wf : 0,
        desc:`${b.buyer} — ${t.name}`, cur, id:`${b.id}-${i}`,
      });
      if(r.status==='failed') rows.push({date:r.failedOn,type:'Failed',method:r.method||'card',amount:0,fee:0,wt:0,desc:`${b.buyer} — declined`,cur,id:`${b.id}-f${i}`});
    });
  });
  DB.payouts.filter(p=>p.cur===cur).forEach(p=>{
    rows.push({ date:p.date, type:p.kind, method:'', amount:-p.amount, fee:p.fee, wt:0, desc:p.to, cur, id:p.id });
  });
  return rows.sort((a,b)=> a.date<b.date ? 1 : -1);
}

/* ═══════════════════════════════════════════════════════════════════════════
   APP STATE + shell
   ═══════════════════════════════════════════════════════════════════════════ */
const S = {
  view:'trips', tripTab:'bookings', builderStep:'packages', reportTab:'upcoming',
  crmTab:'opportunities', payTab:'balance', settingsTab:'fees',
  tripId:'t1', bookingId:null, contactId:'c1', tripFilter:'upcoming', cur:'USD',
  co:{ open:false, step:0, pkg:'p2', addons:[], plan:'plan', qty:1,
       buyer:{first:'',last:'',email:''}, answers:{}, signed:false, method:'card' },
  travellerView:'trip', navOpen:{trips:true},
};

function toast(html){
  let host = $('.toasts');
  if(!host){ host = document.createElement('div'); host.className='toasts'; document.body.appendChild(host); }
  const el = document.createElement('div');
  el.className='toast'; el.innerHTML = html;
  host.appendChild(el);
  setTimeout(()=>{ el.classList.add('out'); setTimeout(()=>el.remove(), 220); }, 3400);
}

let modalEl = null;
function openModal(html){
  closeModal();
  modalEl = document.createElement('div');
  modalEl.className = 'scrim';
  modalEl.innerHTML = html;
  modalEl.addEventListener('mousedown', e=>{ if(e.target===modalEl) closeModal(); });
  document.body.appendChild(modalEl);
  document.addEventListener('keydown', escClose);
  const f = modalEl.querySelector('input,select,textarea,button');
  if(f) f.focus();
}
function closeModal(){
  if(modalEl){ modalEl.remove(); modalEl = null; document.removeEventListener('keydown', escClose); }
}
function escClose(e){ if(e.key==='Escape') closeModal(); }

function go(view, opts={}){
  Object.assign(S, {view}, opts);
  render();
  window.scrollTo({top:0, behavior:'instant'});
}
