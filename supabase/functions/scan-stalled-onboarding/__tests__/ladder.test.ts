// The ladder repeats forever, which makes an off-by-one here a person getting
// two pushes a day instead of one, for as long as they stay stuck. Every case
// below is one way that could happen.
//
//   deno test supabase/functions/scan-stalled-onboarding/__tests__/ladder.test.ts

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { dueStage, effectiveLastStage, stageKey } from "../ladder.ts";

Deno.test("nothing is due before the four-hour mark", () => {
  assertEquals(dueStage(0), null);
  assertEquals(dueStage(3.9), null);
});

Deno.test("the first rung opens exactly at four hours, not after", () => {
  // `>=`, not `>`. On an hourly cron the run that lands at 4.0 is the one that
  // should send; making it wait costs an hour for nothing.
  assertEquals(dueStage(4), 0);
  assertEquals(dueStage(23.9), 0);
});

Deno.test("day one starts at 24 hours and each day is its own rung", () => {
  assertEquals(dueStage(24), 1);
  assertEquals(dueStage(47.9), 1);
  assertEquals(dueStage(48), 2);
  assertEquals(dueStage(168), 7);
});

Deno.test("a rung is a whole day wide, so an hourly cron sends once per day", () => {
  // The real regression risk: 24 runs land inside day 3, and exactly one of
  // them may send. They all compute the same stage, and stage > lastStage is
  // true for only the first.
  const sent = [];
  let lastStage = 2;
  for (let h = 72; h < 96; h++) {
    const stage = dueStage(h)!;
    if (stage > lastStage) {
      sent.push(h);
      lastStage = stage;
    }
  }
  assertEquals(sent, [72]);
});

Deno.test("someone found already stale gets one message, not one per day missed", () => {
  // 8 days stale on first sight is stage 8. The next send is day 9 — it does
  // not walk up through 1..8 on eight consecutive runs.
  assertEquals(dueStage(8 * 24), 8);
  assertEquals(effectiveLastStage(null, null, "2026-08-11T00:00:00Z"), -1);
});

Deno.test("copy has three voices: first, one day in, and the repeat", () => {
  assertEquals(stageKey(0), "4h");
  assertEquals(stageKey(1), "24h");
  assertEquals(stageKey(2), "repeat");
  assertEquals(stageKey(9), "repeat");
});

Deno.test("a stage counts while its anchor still matches", () => {
  const t = "2026-08-19T09:00:00Z";
  assertEquals(effectiveLastStage(3, t, t), 3);
  // Same instant, different serialisation — compared by value, not by string.
  assertEquals(effectiveLastStage(3, "2026-08-19T09:00:00+00:00", t), 3);
});

Deno.test("acting restarts the ladder instead of buying permanent silence", () => {
  // The bug this guards: traveler nudged on day 3, then uploads something. The
  // stored stage of 3 must NOT suppress their next 4-hour nudge.
  const oldAnchor = "2026-08-16T09:00:00Z";
  const afterUpload = "2026-08-19T09:00:00Z";
  const lastStage = effectiveLastStage(3, oldAnchor, afterUpload);
  assertEquals(lastStage, -1);
  assertEquals(dueStage(4)! > lastStage, true); // stage 0 sends again
});

Deno.test("stage 0 is a real rung, not a falsy one", () => {
  // -1 as the floor is load-bearing: if "nothing sent yet" were 0, the
  // four-hour nudge would never fire, because 0 > 0 is false.
  const t = "2026-08-19T09:00:00Z";
  assertEquals(effectiveLastStage(0, t, t), 0);
  assertEquals(dueStage(4)! > effectiveLastStage(null, null, t), true);
  assertEquals(dueStage(4)! > effectiveLastStage(0, t, t), false);
});
