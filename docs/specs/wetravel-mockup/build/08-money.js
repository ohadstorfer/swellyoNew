/* ═══════════════════════════════════════════════════════════════════════════
   PAYMENTS
   ═══════════════════════════════════════════════════════════════════════════ */
function viewPayments(){
  const tabs = [['balance','Balance'],['payouts','Payout Accounts'],['recipients','Recipients'],['requests','Payment Requests']];
  const body = { balance:payBalance, payouts:payPayouts, recipients:payRecipients, requests:payRequests }[S.payTab]();
  return topbar([{t:'Payments'},{t:tabs.find(x=>x[0]===S.payTab)[1]}]) + `<div class="view">
    <div class="view-head"><div><h1>Payments</h1>
      <p>What has cleared, what is still on its way to you, and who you owe.</p></div></div>
    <div class="tabs">${tabs.map(([id,l])=>`<button class="tab" aria-selected="${S.payTab===id}"
      onclick="S.payTab='${id}';render()">${l}</button>`).join('')}</div>
    ${body}</div>`;
}

function payBalance(){
  const p = portfolio('USD'), pe = portfolio('EUR');
  const clearing = 2450;
  return `<div class="grid-4" style="margin-bottom:18px">
      ${statCard('Available now', money0(DB.operator.balance.USD,'USD'), 'Withdraw whenever you want','var(--ok)',
        'Money that has cleared. There is no hold until departure.')}
      ${statCard('Clearing', money0(clearing,'USD'), 'Bank payments, 5–7 business days','var(--wait)')}
      ${statCard('Still to collect', money0(p.balance,'USD'), `${money0(p.pastDue,'USD')} of it past due`, p.pastDue?'var(--warn)':'')}
      ${statCard('EUR wallet', money0(DB.operator.balance.EUR,'EUR'), 'Held separately, converts free')}
    </div>

  <div class="grid-2">
    <div class="card"><div class="card-head"><h3>Move money</h3></div><div class="card-pad" style="display:grid;gap:9px">
      ${[['Pay out to your bank','Local transfer, 1–3 business days, no fee','Transfer'],
         ['Pay a supplier','Instant, free, both sides verified','Send'],
         ['Convert currency','USD to EUR at the daily rate, no fee','Convert'],
         ['International wire','3–5 business days, $15','Wire']].map(([a,b,c])=>
        `<div style="display:flex;gap:12px;align-items:center;padding:11px;border:1px solid var(--line);border-radius:var(--r-sm)">
          <div style="flex:1"><b style="font-size:13px">${a}</b><div style="font-size:12px;color:var(--muted);margin-top:2px">${b}</div></div>
          <button class="btn btn-sm" onclick="toast('${c} — not wired up in the mockup.')">${c}</button></div>`).join('')}
    </div></div>

    <div class="card"><div class="card-head"><h3>Recent movements</h3><div class="spacer"></div>
        <button class="btn btn-sm" onclick="go('reports',{reportTab:'transactions'})">Full ledger ${ICON.arrow}</button></div>
      <div class="tbl-wrap"><table><thead><tr><th>Type</th><th>Description</th><th class="num">Amount</th><th>Date</th></tr></thead>
        <tbody>${ledger('USD').slice(0,7).map(r=>`<tr>
          <td>${r.amount<0?`<span class="pill pill-wait">${esc(r.type)}</span>`:`<span class="pill pill-ok">Payment</span>`}</td>
          <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.desc)}</td>
          <td class="num tnum" style="color:${r.amount<0?'var(--muted)':'var(--ok)'}">${r.amount<0?'−':''}${money(Math.abs(r.amount),'USD')}</td>
          <td>${fmtShort(r.date)}</td></tr>`).join('')}</tbody></table></div>
    </div>
  </div>
  <div class="note" style="margin-top:16px">Payouts are <b>manual and immediate</b> — nothing is escrowed
    until the trip runs. That is the single thing operators care most about, and the thing they complain
    loudest about when it stops being true.</div>`;
}

function payPayouts(){
  return `<div class="card"><div class="card-head"><h3>Payout Accounts</h3><div class="spacer"></div>
      <button class="btn btn-sm btn-primary">${ICON.plus} Add local payout account</button></div>
    <div class="card-pad"><div class="grid-2">
      ${[['USD','Chase ••4471','United States','Local · free · 1–3 days'],
         ['EUR','Revolut ••8820','Ireland (SEPA)','Local · free · 1–3 days'],
         ['IDR','BCA ••0193','Indonesia','International wire · $15 · 3–5 days']].map(([c,acct,where,how])=>
        `<div class="card" style="box-shadow:none"><div class="card-pad">
          <div style="display:flex;align-items:center;gap:10px"><span class="pill pill-accent">${c}</span>
            <b style="font-size:13.5px">${acct}</b></div>
          <div style="font-size:12.5px;color:var(--muted);margin-top:6px">${where}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">${how}</div>
          <button class="btn btn-sm" style="margin-top:11px">Transfer</button></div></div>`).join('')}
    </div></div></div>
  <div class="card" style="margin-top:16px"><div class="card-head"><h3>Payout history</h3></div>
    <div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Kind</th><th>To</th><th class="num">Amount</th><th class="num">Fee</th><th>Status</th></tr></thead>
      <tbody>${DB.payouts.map(p=>`<tr><td>${fmtShort(p.date)}</td><td>${esc(p.kind)}</td><td>${esc(p.to)}</td>
        <td class="num tnum">${money(p.amount,p.cur)}</td><td class="num tnum">${p.fee?money(p.fee,p.cur):'—'}</td>
        <td><span class="pill pill-ok">${esc(p.status)}</span></td></tr>`).join('')}</tbody></table></div></div>`;
}

function payRecipients(){
  const tone = s => s==='Verified'?'pill-ok':s==='Invite Pending'?'pill-warn':'pill-wait';
  return `<div class="card"><div class="card-head"><h3>Recipients</h3><div class="spacer"></div>
      <button class="btn btn-sm btn-primary">${ICON.plus} Add recipient</button></div>
    <div class="tbl-wrap"><table><thead><tr><th>Supplier</th><th>What they do</th><th>Currency</th><th>Status</th><th></th></tr></thead>
      <tbody>${DB.recipients.map(r=>`<tr>
        <td><div style="display:flex;align-items:center;gap:9px"><span class="av av-sm">${initials(r.name)}</span>
          <div><b>${esc(r.name)}</b><div style="font-size:11.5px;color:var(--muted)">${esc(r.email)}</div></div></div></td>
        <td style="color:var(--muted)">${esc(r.note)}</td><td>${esc(r.cur)}</td>
        <td><span class="pill ${tone(r.status)}">${esc(r.status)}</span></td>
        <td class="num">${r.status==='Verified'
          ? `<button class="btn btn-sm" onclick="toast('Transfers between two verified accounts land in seconds, free.')">Transfer</button>`
          : `<span style="font-size:12px;color:var(--muted)">Can't be paid yet</span>`}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="note" style="margin-top:16px">Supplier payments only work between two independently verified
    accounts — which is why the villa in Bali has to finish its own onboarding before you can pay it,
    however long you have been working together.</div>`;
}

function payRequests(){
  return `<div class="card"><div class="card-head"><h3>Payment Requests</h3><div class="spacer"></div>
    <button class="btn btn-sm btn-primary">${ICON.plus} New request</button></div>
    <div class="card-pad"><div class="empty"><h4>No open requests</h4>
      <p>A payment request is the B2B invoice: a title, an amount, a due date and an attached invoice,
      sent to a business rather than a traveller. It can carry its own installments, a minimum of seven
      days apart.</p></div></div></div>`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   REPORTS
   ═══════════════════════════════════════════════════════════════════════════ */
function viewReports(){
  const tabs = [['upcoming','Upcoming Payments'],['payments','Payments'],['transactions','Transactions'],['cash','Cash Flow']];
  const body = { upcoming:repUpcoming, payments:repPayments, transactions:repTx, cash:repCash }[S.reportTab]();
  return topbar([{t:'Reports'},{t:tabs.find(x=>x[0]===S.reportTab)[1]}]) + `<div class="view">
    <div class="view-head"><div><h1>Reports</h1>
      <p>Three of these look backwards. Only the first one looks forwards.</p></div>
      <div class="spacer"></div>
      <div class="seg">${['USD','EUR'].map(c=>`<button aria-pressed="${S.cur===c}" onclick="S.cur='${c}';render()">${c}</button>`).join('')}</div>
    </div>
    <div class="tabs">${tabs.map(([id,l])=>`<button class="tab" aria-selected="${S.reportTab===id}"
      onclick="S.reportTab='${id}';render()">${l}</button>`).join('')}</div>
    ${body}</div>`;
}

function repUpcoming(){
  const data = upcomingByMonth(S.cur);
  const max = Math.max(1, ...data.map(d=>d.due+d.past));
  const totalDue = data.reduce((n,d)=>n+d.due,0), totalPast = data.reduce((n,d)=>n+d.past,0);
  return `<div class="grid-3" style="margin-bottom:16px">
      ${statCard('Scheduled to arrive', money0(totalDue,S.cur), 'Installments not yet due','var(--cyan-dark)')}
      ${statCard('Past due', money0(totalPast,S.cur), totalPast?'Already chaseable':'Nothing overdue', totalPast?'var(--danger)':'var(--muted)')}
      ${statCard('Bookings on a plan', DB.bookings.filter(b=>trip(b.trip).cur===S.cur && b.sched.length>1).length, 'Paying in installments')}
    </div>
  <div class="card"><div class="card-head"><h3>Upcoming Payments</h3><div class="spacer"></div>
      <div class="legend"><span><i style="background:var(--cyan)"></i>Due</span><span><i style="background:var(--danger)"></i>Past due</span></div></div>
    <div class="card-pad">
      ${data.length?`<div class="chart">${data.map(d=>`
        <div class="bar-wrap">
          <div class="bar-stack">
            ${d.due?`<div class="bar bar-due" style="height:${d.due/max*150}px" title="${money0(d.due,S.cur)} due"></div>`:''}
            ${d.past?`<div class="bar bar-past" style="height:${d.past/max*150}px" title="${money0(d.past,S.cur)} past due"></div>`:''}
          </div>
          <div class="bar-x">${d.label}</div>
          <div class="bar-x tnum" style="font-weight:600;color:var(--text)">${money0(d.due+d.past,S.cur)}</div>
        </div>`).join('')}</div>`
      :'<div class="empty"><p>Nothing scheduled in this currency.</p></div>'}
    </div></div>

  <div class="card" style="margin-top:16px"><div class="card-head"><h3>What is due, and from whom</h3></div>
    <div class="tbl-wrap"><table><thead><tr><th>Traveller</th><th>Trip</th><th>Installment</th><th>Due</th><th class="num">Amount</th><th>Status</th><th></th></tr></thead>
      <tbody>${DB.bookings.filter(b=>trip(b.trip).cur===S.cur).flatMap(b=>
        b.sched.filter(r=>r.status==='due'||r.status==='pastdue'||r.status==='failed').map((r,i)=>{
          const t = trip(b.trip);
          return `<tr><td><div style="display:flex;align-items:center;gap:9px"><span class="av av-sm">${initials(b.buyer)}</span>
              <button class="linky" onclick="openBooking('${b.id}')">${esc(b.buyer)}</button></div></td>
            <td style="color:var(--muted)">${esc(t.name)}</td><td>${esc(r.label)}</td>
            <td>${fmtShort(r.due)} <span style="color:var(--muted)">· ${relDays(r.due)}</span></td>
            <td class="num tnum">${money(r.amount,t.cur)}</td>
            <td>${r.status==='pastdue'?'<span class="pill pill-danger"><span class="dot"></span>Past due</span>'
                 :r.status==='failed'?'<span class="pill pill-danger">Failed</span>'
                 :b.autoBill?'<span class="pill pill-wait">Auto-billing</span>':'<span class="pill pill-warn">Reminder only</span>'}</td>
            <td class="num"><button class="btn btn-sm" onclick="takePayment('${b.id}',${b.sched.indexOf(r)})">Record payment</button></td></tr>`;
        })).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:26px">Nothing outstanding.</td></tr>'}
      </tbody></table></div></div>
  <div class="note" style="margin-top:16px">Record a payment here and watch it land: the trip header, the
    cash-flow report, the traveller's own booking page and the bar above all move together, because they
    are all reading the same schedule.</div>`;
}

function repPayments(){
  const rows = ledger(S.cur).filter(r=>r.amount>0);
  return `<div class="card"><div class="card-head"><h3>Payments Reporting</h3><div class="spacer"></div>
      <button class="btn btn-sm">Filters ${ICON.chev}</button>
      <button class="btn btn-sm btn-primary">${ICON.down} Export</button></div>
    <div class="tbl-wrap"><table><thead><tr><th>Amount</th><th>Customer</th><th>Trip</th><th>Method</th><th>Date</th></tr></thead>
      <tbody>${rows.map(r=>`<tr>
        <td><div style="display:flex;align-items:center;gap:8px">
          <span style="color:var(--muted)">${r.method==='bank'?ICON.bank:ICON.card}</span>
          <b class="tnum">${money(r.amount,r.cur)}</b></div></td>
        <td>${esc(r.desc.split(' — ')[0])}</td>
        <td style="color:var(--muted)">${esc(r.desc.split(' — ')[1]||'')}</td>
        <td style="text-transform:capitalize;color:var(--muted)">${esc(r.method)}</td>
        <td>${fmtShort(r.date)}</td></tr>`).join('')}</tbody></table></div></div>`;
}

function repTx(){
  const rows = ledger(S.cur);
  let run = 0;
  const withRun = [...rows].reverse().map(r=>{ run += r.amount - r.fee - r.wt; return {...r, run}; }).reverse();
  return `<div class="card"><div class="card-head"><h3>Transaction Reporting</h3><div class="spacer"></div>
      <button class="btn btn-sm">Filters ${ICON.chev}</button>
      <button class="btn btn-sm">Accounting CSV</button>
      <button class="btn btn-sm btn-primary">${ICON.down} Export</button></div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Type</th><th>Description</th><th class="num">Gross</th><th class="num">Processing</th>
        <th class="num">Platform</th><th class="num">Net</th><th class="num">Balance</th><th>Date</th></tr></thead>
      <tbody>${withRun.map(r=>`<tr>
        <td>${r.amount<0?`<span class="pill pill-wait">${esc(r.type)}</span>`:'<span class="pill pill-ok">Payment</span>'}</td>
        <td style="max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.desc)}</td>
        <td class="num tnum">${r.amount<0?'−':''}${money(Math.abs(r.amount),r.cur)}</td>
        <td class="num tnum" style="color:var(--muted)">${r.fee?'−'+money(r.fee,r.cur):'—'}</td>
        <td class="num tnum" style="color:var(--muted)">${r.wt?'−'+money(r.wt,r.cur):'—'}</td>
        <td class="num tnum"><b>${r.amount<0?'−':''}${money(Math.abs(r.amount)-r.fee-r.wt,r.cur)}</b></td>
        <td class="num tnum" style="color:var(--muted)">${money(r.run,r.cur)}</td>
        <td>${fmtShort(r.date)}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="note" style="margin-top:16px">Processing and platform columns show <b>${money(0,S.cur)}</b> on
    every row where the traveller is set to absorb them — go to a trip's Settings tab and switch who pays,
    and this ledger rewrites itself.</div>`;
}

function repCash(){
  const rows = ledger(S.cur);
  const collected = rows.filter(r=>r.amount>0).reduce((n,r)=>n+r.amount,0);
  const fees = rows.reduce((n,r)=>n+r.fee+r.wt,0);
  const paidOut = -rows.filter(r=>r.amount<0).reduce((n,r)=>n+r.amount,0);
  const p = portfolio(S.cur);
  const months = upcomingByMonth(S.cur);
  return `<div class="grid-4" style="margin-bottom:16px">
      ${statCard('Payments collected', money0(collected,S.cur), 'Gross, before anything comes off')}
      ${statCard('Fees paid', money0(fees,S.cur), fees?'Your share of processing':'Travellers absorb them', fees?'var(--warn)':'var(--ok)')}
      ${statCard('Paid out', money0(paidOut,S.cur), 'To your bank and suppliers')}
      ${statCard('Net collected', money0(collected-fees,S.cur), 'What you actually kept','var(--ok)')}
    </div>
  <div class="grid-2">
    <div class="card"><div class="card-head"><h3>Where the money went</h3></div><div class="card-pad">
      ${[['Collected from travellers', collected, 'var(--ok)'],
         ['Processing and platform fees', -fees, 'var(--warn)'],
         ['Paid to suppliers and to you', -paidOut, 'var(--wait)']].map(([l,v,c])=>`
        <div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--line)">
          <span style="flex:1;font-size:13px">${l}</span>
          <b class="tnum" style="color:${c};font-family:var(--display)">${v<0?'−':''}${money(Math.abs(v),S.cur)}</b></div>`).join('')}
      <div style="display:flex;align-items:center;gap:12px;padding:13px 0 0">
        <span style="flex:1;font-size:14px;font-weight:600">Sitting in your balance</span>
        <b class="tnum" style="font-family:var(--display);font-size:17px">${money(DB.operator.balance[S.cur],S.cur)}</b></div>
      <div class="note" style="margin:16px 0 0">This report is historical only. Nothing here knows about the
        ${money0(p.balance,S.cur)} still to come — that lives in Upcoming Payments, on its own.</div>
    </div></div>
    <div class="card"><div class="card-head"><h3>Still to arrive</h3></div><div class="card-pad">
      <div class="chart" style="height:150px">${months.map(d=>{
        const max = Math.max(1,...months.map(m=>m.due+m.past));
        return `<div class="bar-wrap"><div class="bar-stack">
          ${d.due?`<div class="bar bar-due" style="height:${d.due/max*110}px"></div>`:''}
          ${d.past?`<div class="bar bar-past" style="height:${d.past/max*110}px"></div>`:''}
        </div><div class="bar-x">${d.label}</div></div>`;}).join('')}</div>
      <div style="text-align:center;margin-top:10px"><button class="btn btn-sm" onclick="S.reportTab='upcoming';render()">Open Upcoming Payments ${ICON.arrow}</button></div>
    </div></div>
  </div>`;
}
