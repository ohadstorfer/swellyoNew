import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { formatDate } from '../lib/format';

/**
 * What the trip has asked of YOU, and what of it has landed.
 *
 * Product Specs lists "Travel wallet — see status (approved or not)" and
 * "Open/pending tasks — to do's" in the crew and manager columns, and its rule
 * is that every function exists on both surfaces. The site assumed whoever
 * signed in was running the trip; a Manager is also ON it, with their own
 * paperwork to hand in.
 *
 * ── Read-only, deliberately ────────────────────────────────────────────────
 * Status here, uploading in the app. SPEC.md §2 keeps one rule absolute: this
 * site never writes into `<trip_id>/`, where every traveler document lives.
 * The waiver carve-out added on 5 Sep 2026 is the operator's OWN document at
 * `<trip_id>/operator/`, which is a different prefix and a different policy.
 * Widening it to personal documents would mean the browser writing into the
 * folder that holds other people's passports, which is not a convenience worth
 * having.
 *
 * So the card answers "what do I still owe, and by when" — the question you
 * ask at a desk — and names where to do it.
 *
 * ── The deadline is the travelers' ─────────────────────────────────────────
 * `staff_my_requirements` reads it through from the traveler requirement of the
 * same kind (20260904000200), so crew see the same date the travelers were
 * given and it moves when theirs does. It is FLAGGED, never gated: nothing here
 * blocks anybody.
 *
 * Renders nothing for someone with no crew row, which is most people.
 */
type MyRequirement = {
  requirementId: string;
  kind: string;
  title: string;
  helpText: string | null;
  fulfilled: boolean;
  deadlineDaysBefore: number | null;
  dueDate: string | null;
};

async function fetchMine(tripId: string): Promise<MyRequirement[]> {
  const { data, error } = await supabase.rpc('staff_my_requirements', { p_trip_id: tripId });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    requirementId: r.requirement_id as string,
    kind: r.kind as string,
    title: (r.title as string) ?? '',
    helpText: (r.help_text as string | null) ?? null,
    fulfilled: !!r.fulfilled,
    deadlineDaysBefore: (r.deadline_days_before as number | null) ?? null,
    dueDate: (r.due_date as string | null) ?? null,
  }));
}

export function MyPaperworkCard({ tripId }: { tripId: string }) {
  const mine = useQuery({
    queryKey: ['myPaperwork', tripId],
    queryFn: () => fetchMine(tripId),
  });

  const rows = mine.data ?? [];
  if (mine.isPending || rows.length === 0) return null;

  const today = new Date().toISOString().slice(0, 10);
  const outstanding = rows.filter(r => !r.fulfilled);
  const done = rows.filter(r => r.fulfilled);

  return (
    <div className="card enter">
      <div className="card-head">
        <h2>Your paperwork</h2>
        <span className="muted small">
          {done.length} of {rows.length} sent
        </span>
      </div>
      <div className="card-body stack" style={{ gap: 8 }}>
        {outstanding.map(r => {
          const late = !!r.dueDate && r.dueDate < today;
          return (
            <div key={r.requirementId} className="row-between" style={{ gap: 12 }}>
              <span className="small" style={{ minWidth: 0 }}>
                <strong>{r.title}</strong>
                {r.helpText && (
                  <span className="muted small" style={{ display: 'block' }}>
                    {r.helpText}
                  </span>
                )}
              </span>
              <span className="row" style={{ gap: 8, flexShrink: 0 }}>
                {r.dueDate ? (
                  <span className={`tag ${late ? 'tag-danger' : 'tag-idle'}`}>
                    {late ? 'Late' : `Due ${formatDate(r.dueDate)}`}
                  </span>
                ) : r.deadlineDaysBefore != null ? (
                  // A months-only trip: the operator set a deadline, there is
                  // just no date to resolve it against yet.
                  <span className="tag tag-idle">
                    {r.deadlineDaysBefore} days before
                  </span>
                ) : null}
                <span className="tag tag-wait">Not sent</span>
              </span>
            </div>
          );
        })}

        {done.map(r => (
          <div key={r.requirementId} className="row-between" style={{ gap: 12 }}>
            <span className="small muted" style={{ minWidth: 0 }}>
              {r.title}
            </span>
            <span className="tag tag-ok">Sent</span>
          </div>
        ))}

        {outstanding.length > 0 && (
          <p className="muted small">
            Send these from the Swellyo app — your documents are uploaded from your phone, not
            from here. Nothing here blocks you from the trip.
          </p>
        )}
      </div>
    </div>
  );
}
