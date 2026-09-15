/* ═══════════════════════════════════════════════════════════════════════════
   DEMO MODEL
   A real in-page store. Every number rendered anywhere is derived from this,
   so editing a payment plan, taking a payment, signing a waiver or flipping
   who pays the fees moves the figures on every other screen.
   ═══════════════════════════════════════════════════════════════════════════ */

const ART = {
  uluwatu:'linear-gradient(160deg,#0b3d54 0%,#0d6d86 38%,#22a3ab 66%,#e8c27a 100%)',
  ericeira:'linear-gradient(160deg,#1b2f45 0%,#2f5f7a 40%,#5e9bb0 70%,#d9d3c2 100%)',
  nias:'linear-gradient(160deg,#123a2e 0%,#1d6b52 42%,#43a878 70%,#f0dfa8 100%)',
  taghazout:'linear-gradient(160deg,#4a2c17 0%,#9c5a2a 38%,#d2984c 68%,#f2ddb6 100%)',
};

const CUR = { USD:{s:'$',code:'USD'}, EUR:{s:'€',code:'EUR'} };

/* Processing fees, from WeTravel's published tables. The platform fee itself
   is deliberately unpublished — only the $1.50 minimum is public — so it is
   modelled as a configurable rate and labelled as such wherever it renders. */
const FEES = {
  USD:{ card:2.9, amex:3.9, bank:0, wallet:3.3, intl:3.9, wire:25 },
  EUR:{ card:1.5, amex:2.9, bank:0, wallet:2.0, intl:3.25, wire:25 },
};

const DB = {
  operator:{
    name:'Uluwatu Surf Collective', short:'USC', person:'Ohad Storfer',
    plan:'Pro', subdomain:'uluwatusurf', currency:'USD',
    balance:{ USD:18420.50, EUR:4310.00 },
  },

  settings:{
    paymentFeesPaidBy:'participant',   // "Who pays the fees?"
    wtFeePaidBy:'participant',
    platformFeePct:1.2,                // unpublished in the real product
    platformFeeMin:1.50,
    autoBillingDefault:true,
    abandonedCheckout:true,
  },

  trips:[
    { id:'t1', name:'Uluwatu Surf & Reset', dest:'Uluwatu, Bali', country:'Indonesia',
      start:'2026-09-12', end:'2026-09-19', days:8, cur:'USD', cap:12, art:ART.uluwatu,
      status:'upcoming', tags:['Surf','All-inclusive'], tripId:'ULU-26-09',
      blurb:'Seven nights on the Bukit peninsula. Two guided surfs a day across Padang Padang, Bingin and Impossibles, video analysis every afternoon, and yoga at dawn for anyone whose shoulders still work.',
      included:[
        ['ACCOMMODATION','7 nights, your chosen room, breakfast included'],
        ['SURF GUIDING','Two guided sessions daily, transport to the break'],
        ['VIDEO ANALYSIS','Filmed sessions reviewed each afternoon'],
        ['YOGA','Five sunrise classes'],
        ['ALL MEALS','Breakfast, lunch and dinner at the camp'],
        ['AIRPORT PICKUP','From Ngurah Rai on arrival day'],
      ],
      excluded:[['FLIGHTS','Not included'],['TRAVEL INSURANCE','Required, arranged by you'],['BOARD RENTAL','Available as an add-on'],['ALCOHOL','Not included']],
      itinerary:[
        ['Day 1','Arrival & sunset check','Pickup from Denpasar, room check-in, a gentle paddle at Padang Padang to shake off the flight, then dinner on the cliff.'],
        ['Day 2–3','Bukit rotation','Dawn patrol at Bingin, breakfast, video review at 3pm, second session wherever the tide is working. Yoga at 6.'],
        ['Day 4','Rest day or Nusa run','Optional boat to Nusa Lembongan for Shipwrecks, or a full day off with massages booked in.'],
        ['Day 5–7','Building the week','Impossibles and Uluwatu proper as the swell fills in. Coaching moves to individual goals set on Day 2.'],
        ['Day 8','Last surf & departure','A final dawn session, brunch, and transfers back to the airport.'],
      ],
      packages:[
        { id:'p1', name:'Shared Dorm', price:1890, deposit:400, spots:4, sold:3, desc:'Four-bed dorm, shared bathroom, garden side.' },
        { id:'p2', name:'Twin Room', price:2450, deposit:500, spots:5, sold:3, desc:'Twin share with ensuite and a partial ocean view.' },
        { id:'p3', name:'Private Bungalow', price:3180, deposit:650, spots:3, sold:2, desc:'Standalone bungalow, outdoor shower, cliff-facing deck.' },
      ],
      addons:[
        { id:'a1', name:'Airport transfer (return)', price:45, per:'person' },
        { id:'a2', name:'Extra night before the camp', price:95, per:'person' },
        { id:'a3', name:'Board rental for the week', price:120, per:'person' },
        { id:'a4', name:'Photo & video package', price:180, per:'person' },
        { id:'a5', name:'Private coaching session', price:70, per:'person' },
      ],
      /* Payment plan template, per package. Deposit is always due at booking. */
      /* The plan as it stands today. Bookings made months ago carry their own
         older schedules — a plan is copied onto a booking, never referenced. */
      plan:{ installments:3, dates:['2026-08-29','2026-09-03','2026-09-08'], autoBill:true, partial:false, autoAdjust:true },
      /* Checkout questions and post-booking tasks */
      questions:[
        { id:'q1', q:'Surf level', type:'dropdown', req:true, opts:['Beginner','Intermediate','Advanced','Pro'] },
        { id:'q2', q:'Board you ride most', type:'radio', req:true, opts:['Shortboard','Mid-length','Longboard','Soft-top'], other:true },
        { id:'q3', q:'Height and weight (for board sizing)', type:'text', req:true },
        { id:'q4', q:'Dietary requirements', type:'text', req:false },
        { id:'q5', q:'Emergency contact — name and phone', type:'phone', req:true },
      ],
      tasks:[
        { id:'tk1', name:'Before you fly', due:'2026-08-29', dueLabel:'14 days before the trip', reminders:true,
          questions:[
            { id:'q6', q:'Passport photo page', type:'file', req:true },
            { id:'q7', q:'Travel insurance policy number', type:'text', req:true },
            { id:'q8', q:'Arrival flight number and landing time', type:'text', req:true },
            { id:'q9', q:'Nationality', type:'country', req:true },
          ]},
      ],
      esign:{ on:true, file:'Uluwatu-Surf-Collective-Liability-Waiver-2026.pdf', who:'Everyone', mandatory:true, size:'318 KB' },
    },

    { id:'t2', name:'Ericeira Autumn Swell', dest:'Ericeira, Portugal', country:'Portugal',
      start:'2026-10-04', end:'2026-10-11', days:8, cur:'EUR', cap:10, art:ART.ericeira,
      status:'upcoming', tags:['Surf','Intermediate+'], tripId:'ERI-26-10',
      blurb:'A week in the only World Surfing Reserve in Europe. Ribeira d\'Ilhas when it is clean, Coxos when it is not.',
      included:[['ACCOMMODATION','7 nights in the surf house'],['SURF GUIDING','Daily, tide-led'],['BREAKFAST','Every morning']],
      excluded:[['FLIGHTS','Not included'],['DINNER','Not included']],
      itinerary:[['Day 1','Arrival','Check-in and an evening walk to Ribeira.'],['Day 2–7','Chasing the tide','Sessions called each morning by the forecast.'],['Day 8','Departure','Final surf and transfers.']],
      packages:[
        { id:'p4', name:'Shared Room', price:1290, deposit:300, spots:6, sold:2, desc:'Twin share in the surf house.' },
        { id:'p5', name:'Private Room', price:1790, deposit:400, spots:4, sold:1, desc:'Private double with sea view.' },
      ],
      addons:[{ id:'a6', name:'Wetsuit hire', price:60, per:'person' },{ id:'a7', name:'Airport transfer', price:40, per:'person' }],
      plan:{ installments:2, dates:['2026-09-05','2026-09-25'], autoBill:true, partial:false, autoAdjust:true },
      questions:[
        { id:'q10', q:'Surf level', type:'dropdown', req:true, opts:['Intermediate','Advanced','Pro'] },
        { id:'q11', q:'Wetsuit size', type:'dropdown', req:true, opts:['XS','S','M','L','XL'] },
      ],
      tasks:[], esign:{ on:true, file:'Ericeira-Waiver-2026.pdf', who:'Everyone', mandatory:true, size:'204 KB' },
    },

    { id:'t3', name:'Nias Longboard Week', dest:'Nias, Indonesia', country:'Indonesia',
      start:'2027-04-11', end:'2027-04-18', days:8, cur:'USD', cap:8, art:ART.nias,
      status:'draft', tags:['Longboard'], tripId:'NIA-27-04',
      blurb:'Right-hand point, one wave, all week.',
      included:[], excluded:[], itinerary:[], packages:[], addons:[],
      plan:{ installments:2, dates:[], autoBill:true, partial:false, autoAdjust:true },
      questions:[], tasks:[], esign:{ on:false },
    },

    { id:'t4', name:'Taghazout Winter Camp', dest:'Taghazout, Morocco', country:'Morocco',
      start:'2026-02-07', end:'2026-02-14', days:8, cur:'EUR', cap:14, art:ART.taghazout,
      status:'past', tags:['Surf'], tripId:'TAG-26-02',
      blurb:'Anchor Point when it turns on.',
      included:[], excluded:[], itinerary:[], packages:[
        { id:'p6', name:'Shared Room', price:990, deposit:250, spots:14, sold:14, desc:'' }],
      addons:[], plan:{ installments:2, dates:[], autoBill:true, partial:false, autoAdjust:true },
      questions:[], tasks:[], esign:{ on:true, file:'Taghazout-Waiver.pdf', who:'Everyone', mandatory:true, size:'198 KB' },
    },
  ],

  /* Bookings. `sched` rows carry their own status so the demo can move money
     around without inventing a ledger reconciliation engine. */
  bookings:[
    { id:'b1', trip:'t1', buyer:'Maya Lindqvist', email:'maya.lindqvist@hey.com', pkg:'p2', qty:1,
      addons:['a3','a4'], booked:'2026-05-02', autoBill:true, signed:true, note:'',
      participants:[{ name:'Maya Lindqvist', email:'maya.lindqvist@hey.com', signed:true,
        answers:{q1:'Intermediate',q2:'Shortboard',q3:'168cm / 61kg',q4:'Vegetarian',q5:'Erik Lindqvist +46 70 555 0182'},
        task:{q6:'maya-lindqvist-passport.pdf',q7:'WF-88213-SE',q8:'GA 866, 14:20',q9:'Sweden'} }],
      sched:[
        { label:'Deposit', due:'booking', amount:500, status:'paid', paidOn:'2026-05-02', method:'card' },
        { label:'1st Payment', due:'2026-06-15', amount:750, status:'paid', paidOn:'2026-06-15', method:'card' },
        { label:'2nd Payment', due:'2026-08-15', amount:750, status:'paid', paidOn:'2026-08-15', method:'card' },
        { label:'Final Payment', due:'2026-09-05', amount:750, status:'scheduled' },
      ] },

    { id:'b2', trip:'t1', buyer:'Tomás Ferreira', email:'tomas.f@outlook.pt', pkg:'p3', qty:1,
      addons:['a1'], booked:'2026-04-18', autoBill:false, signed:true, note:'Repeat guest — third camp.',
      participants:[{ name:'Tomás Ferreira', email:'tomas.f@outlook.pt', signed:true,
        answers:{q1:'Advanced',q2:'Shortboard',q3:'181cm / 78kg',q4:'',q5:'Inês Ferreira +351 91 244 0021'},
        task:{q6:'tomas-ferreira-passport.pdf',q7:'AXA-PT-99120',q8:'TP 24, 09:40',q9:'Portugal'} }],
      sched:[{ label:'Full payment', due:'booking', amount:3225, status:'paid', paidOn:'2026-04-18', method:'bank' }] },

    { id:'b3', trip:'t1', buyer:'Ruth Adeyemi', email:'ruth.adeyemi@gmail.com', pkg:'p1', qty:2,
      addons:['a1','a3'], booked:'2026-05-21', autoBill:false, signed:false, note:'Booking for herself and her sister.',
      participants:[
        { name:'Ruth Adeyemi', email:'ruth.adeyemi@gmail.com', signed:false,
          answers:{q1:'Beginner',q2:'Soft-top',q3:'165cm / 64kg',q4:'No pork',q5:'Femi Adeyemi +234 803 555 1190'}, task:{} },
        { name:'Grace Adeyemi', email:'grace.adeyemi@gmail.com', signed:false,
          answers:{q1:'Beginner',q2:'Soft-top',q3:'170cm / 68kg',q4:'',q5:''}, task:{} }],
      sched:[
        { label:'Deposit', due:'booking', amount:800, status:'paid', paidOn:'2026-05-21', method:'card' },
        { label:'1st Payment', due:'2026-08-19', amount:1155, status:'pastdue' },
        { label:'Final Payment', due:'2026-09-05', amount:1155, status:'scheduled' },
      ] },

    { id:'b4', trip:'t1', buyer:'Jonas Weber', email:'j.weber@posteo.de', pkg:'p2', qty:1,
      addons:[], booked:'2026-07-30', autoBill:true, signed:false, note:'',
      participants:[{ name:'Jonas Weber', email:'j.weber@posteo.de', signed:false,
        answers:{q1:'Intermediate',q2:'',q3:'',q4:'',q5:''}, task:{} }],
      sched:[
        { label:'Deposit', due:'booking', amount:500, status:'paid', paidOn:'2026-07-30', method:'card' },
        { label:'Final Payment', due:'2026-09-05', amount:1950, status:'scheduled' },
      ] },

    { id:'b5', trip:'t1', buyer:'Priya Raman', email:'priya.raman@fastmail.com', pkg:'p1', qty:1,
      addons:['a4'], booked:'2026-03-11', autoBill:false, signed:true, note:'',
      participants:[{ name:'Priya Raman', email:'priya.raman@fastmail.com', signed:true,
        answers:{q1:'Intermediate',q2:'Mid-length',q3:'160cm / 55kg',q4:'Vegan',q5:'Anil Raman +91 98455 21100'},
        task:{q7:'ICICI-TR-4420',q8:'SQ 942, 23:10',q9:'India'} }],
      sched:[{ label:'Full payment', due:'booking', amount:2070, status:'paid', paidOn:'2026-03-11', method:'bank' }] },

    { id:'b6', trip:'t1', buyer:'Callum Doyle', email:'callum.doyle@icloud.com', pkg:'p3', qty:1,
      addons:['a5'], booked:'2026-08-14', autoBill:true, signed:false, note:'',
      participants:[{ name:'Callum Doyle', email:'callum.doyle@icloud.com', signed:false,
        answers:{q1:'Advanced',q2:'Shortboard',q3:'176cm / 74kg',q4:'',q5:'Niamh Doyle +353 86 555 2201'}, task:{} }],
      sched:[
        { label:'Deposit', due:'booking', amount:650, status:'failed', failedOn:'2026-08-14', reason:'Card declined — insufficient funds' },
        { label:'Final Payment', due:'2026-09-05', amount:2600, status:'scheduled' },
      ] },

    { id:'b7', trip:'t2', buyer:'Ana Sofía Rivas', email:'ana.rivas@correo.es', pkg:'p5', qty:1,
      addons:['a6'], booked:'2026-06-09', autoBill:true, signed:true, note:'',
      participants:[{ name:'Ana Sofía Rivas', email:'ana.rivas@correo.es', signed:true,
        answers:{q10:'Advanced',q11:'M'}, task:{} }],
      sched:[
        { label:'Deposit', due:'booking', amount:400, status:'paid', paidOn:'2026-06-09', method:'bank' },
        { label:'1st Payment', due:'2026-07-20', amount:725, status:'paid', paidOn:'2026-07-20', method:'bank' },
        { label:'Final Payment', due:'2026-09-05', amount:725, status:'scheduled' },
      ] },

    { id:'b8', trip:'t2', buyer:'Mikkel Sørensen', email:'mikkel@sorensen.dk', pkg:'p4', qty:2,
      addons:['a7'], booked:'2026-07-02', autoBill:false, signed:false, note:'',
      participants:[
        { name:'Mikkel Sørensen', email:'mikkel@sorensen.dk', signed:false, answers:{q10:'Intermediate',q11:'L'}, task:{} },
        { name:'Freja Sørensen', email:'freja@sorensen.dk', signed:false, answers:{q10:'Intermediate',q11:'S'}, task:{} }],
      sched:[
        { label:'Deposit', due:'booking', amount:600, status:'paid', paidOn:'2026-07-02', method:'card' },
        { label:'Final Payment', due:'2026-08-20', amount:2060, status:'pastdue' },
      ] },
  ],

  contacts:[
    { id:'c1', name:'Maya Lindqvist', email:'maya.lindqvist@hey.com', phone:'+46 70 555 0182', country:'Sweden',
      tags:['Repeat','Intermediate'], trips:2, lastBooking:'2026-05-02', booked:4900, source:'Trip inquiry form',
      notes:'Came from the Ericeira 2025 camp. Asks good questions about board volume.' },
    { id:'c2', name:'Tomás Ferreira', email:'tomas.f@outlook.pt', phone:'+351 91 244 0021', country:'Portugal',
      tags:['Repeat','Advanced','VIP'], trips:3, lastBooking:'2026-04-18', booked:9140, source:'Referral',
      notes:'Third camp. Always books the bungalow and pays in full by bank transfer.' },
    { id:'c3', name:'Ruth Adeyemi', email:'ruth.adeyemi@gmail.com', phone:'+234 803 555 1190', country:'Nigeria',
      tags:['Beginner'], trips:1, lastBooking:'2026-05-21', booked:3390, source:'Instagram',
      notes:'Booked for two. Waiver still unsigned as of the August sweep.' },
    { id:'c4', name:'Jonas Weber', email:'j.weber@posteo.de', phone:'+49 151 555 2244', country:'Germany',
      tags:['Intermediate'], trips:1, lastBooking:'2026-07-30', booked:2450, source:'Brochure download' },
    { id:'c5', name:'Priya Raman', email:'priya.raman@fastmail.com', phone:'+91 98455 21100', country:'India',
      tags:['Intermediate','Vegan'], trips:1, lastBooking:'2026-03-11', booked:2070, source:'Trip inquiry form' },
    { id:'c6', name:'Callum Doyle', email:'callum.doyle@icloud.com', phone:'+353 86 555 2201', country:'Ireland',
      tags:['Advanced'], trips:1, lastBooking:'2026-08-14', booked:3250, source:'Ask a question' },
    { id:'c7', name:'Hannah Mbeki', email:'h.mbeki@gmail.com', phone:'+27 82 555 7781', country:'South Africa',
      tags:['Lead'], trips:0, lastBooking:null, booked:0, source:'Abandoned Checkout',
      notes:'Got as far as the payment step on the Bali camp and dropped out.' },
    { id:'c8', name:'Léa Moreau', email:'lea.moreau@free.fr', phone:'+33 6 55 21 88 03', country:'France',
      tags:['Lead'], trips:0, lastBooking:null, booked:0, source:'Brochure download' },
    { id:'c9', name:'Ana Sofía Rivas', email:'ana.rivas@correo.es', phone:'+34 655 210 447', country:'Spain',
      tags:['Advanced'], trips:1, lastBooking:'2026-06-09', booked:1850, source:'Trip inquiry form' },
  ],

  opportunities:[
    { id:'o1', title:'Bali September — 2 spots', contact:'c7', stage:'New', source:'Abandoned Checkout',
      trip:'t1', value:3780, lastAct:'2026-08-22', owner:'OS',
      msg:'Reached the payment step for two dorm beds and stopped. No email reply yet.' },
    { id:'o2', title:'Corporate retreat — 8 people', contact:'c8', stage:'Qualified', source:'Brochure download',
      trip:'t1', value:15120, lastAct:'2026-08-19', owner:'OS',
      msg:'Agency in Bordeaux asking whether we would run a private camp for a client in October.' },
    { id:'o3', title:'Ericeira October — private room', contact:'c9', stage:'Booked', source:'Trip inquiry form',
      trip:'t2', value:1850, lastAct:'2026-06-09', owner:'OS', msg:'Converted.' },
    { id:'o4', title:'Nias 2027 — waiting on dates', contact:'c2', stage:'Hold requested', source:'Referral',
      trip:'t3', value:2400, lastAct:'2026-08-11', owner:'OS',
      msg:'Wants to hold two spots for the longboard week once dates are published.' },
    { id:'o5', title:'Bali September — solo traveller', contact:'c4', stage:'Booked', source:'Brochure download',
      trip:'t1', value:2450, lastAct:'2026-07-30', owner:'OS', msg:'Converted.' },
  ],

  stages:[
    { name:'New', locked:true, color:'#5b5bb0' },
    { name:'Qualified', locked:false, color:'#066b8c' },
    { name:'Hold requested', locked:false, color:'#b8532b' },
    { name:'Booked', locked:true, color:'#1f7a4d' },
  ],

  recipients:[
    { id:'r1', name:'Bingin Beach Villas', email:'stay@binginvillas.id', status:'Verified', cur:'USD', note:'Accommodation — Bali' },
    { id:'r2', name:'Wayan Transport', email:'wayan@bukittransfer.id', status:'Verified', cur:'USD', note:'Airport transfers' },
    { id:'r3', name:'Casa do Mar Ericeira', email:'reservas@casadomar.pt', status:'Invite Pending', cur:'EUR', note:'Surf house — Portugal' },
    { id:'r4', name:'Ketut Surf Guiding', email:'ketut@uluwatuguides.id', status:'Verification in progress', cur:'USD', note:'Local guides' },
  ],

  payouts:[
    { id:'po1', date:'2026-08-18', amount:8200, cur:'USD', to:'Chase ••4471', kind:'Local payout', status:'Paid', fee:0 },
    { id:'po2', date:'2026-08-04', amount:3100, cur:'EUR', to:'Revolut ••8820', kind:'Local payout', status:'Paid', fee:0 },
    { id:'po3', date:'2026-07-22', amount:6400, cur:'USD', to:'Bingin Beach Villas', kind:'Supplier transfer', status:'Paid', fee:0 },
    { id:'po4', date:'2026-07-09', amount:2250, cur:'USD', to:'BCA Indonesia ••0193', kind:'International wire', status:'Paid', fee:15 },
  ],

  discounts:[
    { code:'EARLYBIRD26', type:'percentage', amount:10, scope:'Account-wide', used:7, cap:25, until:'2026-09-01' },
    { code:'REPEAT150', type:'amount', amount:150, scope:'Uluwatu Surf & Reset', used:3, cap:null, until:'2026-09-12' },
  ],

  team:[
    { name:'Ohad Storfer', role:'Owner', email:'ohad@uluwatusurf.co', perms:'Everything' },
    { name:'Eyal Cohen', role:'Manager', email:'eyal@uluwatusurf.co', perms:'Trips, bookings, messages — no payouts' },
    { name:'Ketut Wirawan', role:'Guide', email:'ketut@uluwatusurf.co', perms:'Participant info only' },
  ],
};



/* Live "today" for the demo world. Fixed so the story stays stable. */
const TODAY = new Date('2026-08-25T09:00:00Z');

/* Normalise every unpaid installment's status from its own date, so a row can
   never claim it is "due now" while its date sits ten days in the past. Paid,
   failed and deposit rows are left exactly as authored. */
function normaliseSchedules(){
  DB.bookings.forEach(b => b.sched.forEach(r => {
    if(r.status === 'paid' || r.status === 'failed' || r.due === 'booking') return;
    const n = Math.round((new Date(r.due+'T00:00:00Z') - TODAY) / 86400000);
    r.status = n < 0 ? 'pastdue' : n <= 14 ? 'due' : 'scheduled';
  }));
}
normaliseSchedules();
