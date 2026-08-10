-- Bring every existing operator trip onto the FIXED onboarding set.
--
-- Operators used to choose which requirements existed and which were mandatory.
-- They no longer do (Ohad, 10 Aug): every operator trip asks for the same seven
-- things, split the same way. Client source of truth:
-- ONBOARDING_REQUIREMENT_SPEC in src/services/trips/tripDocumentsService.ts
--
--   required  : waiver, medical, deposit
--   optional  : insurance (30d), passport (30d), flights (14d), visa (21d)
--
-- TWO KINDS ARE DELIBERATELY CONDITIONAL, and skipping them is not a bug:
--
--  · `deposit` is only inserted on a trip with payment_mode = 'managed'.
--    enforce_pay_requires_managed_trip RAISES otherwise, which would abort this
--    whole DO block. An offline trip takes money outside the app; there is
--    nothing here to pay.
--
--  · `waiver` is only made must_have on a trip that already has a waiver PDF.
--    operator_trip_my_requirements only counts an acknowledgement whose
--    operator_document_id matches the CURRENT waiver document. With no
--    document the waiver is stuck at 'not_started' forever — and as a
--    must_have that means NOBODY CAN EVER JOIN THAT TRIP. Marking it required
--    on a live PDF-less trip would silently close it. Those trips get the
--    waiver row as `skippable` instead, and `publishWaiverPdf` promotes it to
--    must_have the moment the operator uploads one.
--
-- must_have carries NO deadline and skippable MUST carry one, or
-- organized_trip_req_deadline_rule raises 23514.
--
-- ⚠️ REFERENCE COPY — applied BY HAND (2026-08-10), never `db push`.
-- Idempotent: safe to re-run.

do $$
declare
  t record;
  v_has_waiver boolean;
begin
  for t in
    select id, payment_mode from public.group_trips where hosting_style = 'C'
  loop
    select exists (
      select 1 from public.organized_trip_operator_documents od
       where od.trip_id = t.id and od.kind = 'waiver'
    ) into v_has_waiver;

    -- ── The required ones (waiver conditional, see header).
    insert into public.organized_trip_requirements
      (trip_id, kind, req_type, title, help_text, skip_at_onboarding,
       deadline_days_before, sort_order, is_active)
    values
      (t.id, 'waiver', 'acknowledge', 'Waiver', 'Read and agree to the trip waiver.',
       case when v_has_waiver then 'must_have' else 'skippable' end,
       case when v_has_waiver then null else 30 end, 10, true),
      (t.id, 'medical', 'upload', 'Medical info', 'Allergies, diet, injuries and medication.',
       'must_have', null, 20, true)
    on conflict (trip_id, kind) where kind <> 'custom' do update
      set skip_at_onboarding   = excluded.skip_at_onboarding,
          deadline_days_before = excluded.deadline_days_before,
          is_active            = true;

    -- ── The four optional ones.
    insert into public.organized_trip_requirements
      (trip_id, kind, req_type, title, help_text, skip_at_onboarding,
       deadline_days_before, sort_order, is_active)
    values
      (t.id, 'insurance', 'upload', 'Travel insurance', 'Your policy document or confirmation.',
       'skippable', 30, 40, true),
      (t.id, 'passport', 'upload', 'Passport', 'So your organiser can book your flights.',
       'skippable', 30, 50, true),
      (t.id, 'flights', 'upload', 'Flight details',
       'Your ticket or booking confirmation, so the pickup can be planned.',
       'skippable', 14, 60, true),
      (t.id, 'visa', 'upload', 'Visa', 'Proof of your visa or entry permit for this destination.',
       'skippable', 21, 70, true)
    on conflict (trip_id, kind) where kind <> 'custom' do update
      set skip_at_onboarding   = excluded.skip_at_onboarding,
          deadline_days_before = excluded.deadline_days_before,
          is_active            = true;

    -- ── Deposit: managed trips only, or the pay trigger aborts everything.
    if t.payment_mode = 'managed' then
      insert into public.organized_trip_requirements
        (trip_id, kind, req_type, title, help_text, skip_at_onboarding,
         deadline_days_before, sort_order, is_active)
      values
        (t.id, 'deposit', 'pay', 'Deposit', 'Pay your deposit to confirm your place.',
         'must_have', null, 30, true)
      on conflict (trip_id, kind) where kind <> 'custom' do update
        set skip_at_onboarding   = 'must_have',
            deadline_days_before = null,
            is_active            = true;
    end if;
  end loop;
end $$;
