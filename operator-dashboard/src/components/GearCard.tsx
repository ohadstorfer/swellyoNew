import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addGearItem,
  decideGearRequest,
  fetchGearItems,
  fetchGearRequests,
  fetchPackingSuggestions,
  removeGearItem,
  setPackingSuggestions,
  type GearRequest,
} from '../services/gear';
import { fetchProfiles } from '../services/travelers';
import { friendlyError } from '../lib/errors';
import { plural } from '../lib/format';

/**
 * Gear, in one card, because the three lists are one job.
 *
 * Product Specs lists "group gear", "personal gear (for self)" and "Edit
 * personal gear — admin suggestions" separately, and an operator does not think
 * of them separately: they think "what is everyone bringing".
 *
 *   · WHAT WE NEED — the group list. One tent, somebody brings it.
 *   · WHAT TO PACK — the suggestion list, which fans out into every traveler's
 *     own checklist through a database trigger.
 *   · REQUESTS — travelers asking to add something.
 *
 * Requests come FIRST when there are any: they are the only part with a person
 * waiting on an answer. Silent otherwise.
 *
 * Editing is `trip.edit`. Without it the card still renders, read-only — a
 * guide has every reason to know what the group is bringing.
 */
export function GearCard({ tripId, canEdit }: { tripId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [newItem, setNewItem] = useState('');
  const [newQty, setNewQty] = useState(1);
  const [packing, setPacking] = useState('');
  const [packingDirty, setPackingDirty] = useState(false);

  const items = useQuery({ queryKey: ['gear', tripId], queryFn: () => fetchGearItems(tripId) });
  const suggestions = useQuery({
    queryKey: ['packing', tripId],
    queryFn: () => fetchPackingSuggestions(tripId),
  });
  const requests = useQuery({
    queryKey: ['gearRequests', tripId],
    queryFn: () => fetchGearRequests(tripId),
  });

  const requesterIds = (requests.data ?? []).map(r => r.requesterId);
  const profiles = useQuery({
    queryKey: ['profiles', requesterIds],
    queryFn: () => fetchProfiles(requesterIds),
    enabled: requesterIds.length > 0,
  });

  // One textarea, one line per item — the shape the list actually is. Re-seeded
  // only when the STORED list changes, so a refetch cannot wipe what somebody
  // was halfway through typing.
  useEffect(() => {
    if (!suggestions.data) return;
    setPacking(suggestions.data.join('\n'));
    setPackingDirty(false);
  }, [suggestions.data]);

  const add = useMutation({
    mutationFn: () => addGearItem(tripId, newItem, newQty),
    onMutate: () => setError(null),
    onSuccess: () => {
      setNewItem('');
      setNewQty(1);
      void qc.invalidateQueries({ queryKey: ['gear', tripId] });
    },
    onError: e => setError(friendlyError(e)),
  });

  const remove = useMutation({
    mutationFn: (itemId: string) => removeGearItem(itemId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['gear', tripId] }),
    onError: e => setError(friendlyError(e)),
  });

  const savePacking = useMutation({
    mutationFn: () => setPackingSuggestions(tripId, packing.split('\n')),
    onMutate: () => setError(null),
    onSuccess: () => {
      setPackingDirty(false);
      void qc.invalidateQueries({ queryKey: ['packing', tripId] });
    },
    onError: e => setError(friendlyError(e)),
  });

  const decide = useMutation({
    mutationFn: (args: { request: GearRequest; decision: 'approved' | 'declined' }) =>
      decideGearRequest({ tripId, request: args.request, decision: args.decision }),
    onMutate: () => setError(null),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['gearRequests', tripId] });
      void qc.invalidateQueries({ queryKey: ['gear', tripId] });
    },
    onError: e => setError(friendlyError(e)),
  });

  const rows = items.data ?? [];
  const asks = requests.data ?? [];

  return (
    <div className="card enter">
      <div className="card-head">
        <h2>Gear</h2>
        {rows.length > 0 && <span className="muted small">{plural(rows.length, 'item')}</span>}
      </div>

      <div className="card-body stack">
        {error && (
          <div className="banner" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}

        {/* ── Requests ──────────────────────────────────────────────────── */}
        {canEdit && asks.length > 0 && (
          <div className="stack" style={{ gap: 8 }}>
            <strong className="small">
              {plural(asks.length, 'request')} from your travelers
            </strong>
            {asks.map(r => (
              <div key={r.id} className="row-between" style={{ gap: 12 }}>
                <span className="small" style={{ minWidth: 0 }}>
                  <strong>{r.itemName}</strong>
                  <span className="muted">
                    {' '}
                    · {profiles.data?.get(r.requesterId)?.name ?? 'A traveler'}
                    {r.neededQty > 1 ? ` · wants ${r.neededQty}` : ''}
                  </span>
                  {r.note && (
                    <span className="muted small" style={{ display: 'block' }}>
                      {r.note}
                    </span>
                  )}
                </span>
                <span className="row" style={{ gap: 8, flexShrink: 0 }}>
                  <button
                    className="btn btn-sm"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ request: r, decision: 'declined' })}
                  >
                    No
                  </button>
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ request: r, decision: 'approved' })}
                  >
                    Add it
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ── The group list ────────────────────────────────────────────── */}
        <div className="stack" style={{ gap: 8 }}>
          <strong className="small">What the group needs</strong>
          {items.isPending ? (
            <span className="muted small">Loading…</span>
          ) : rows.length === 0 ? (
            <span className="muted small">
              Nothing on the list. This is for things one person brings for everybody.
            </span>
          ) : (
            rows.map(i => (
              <div key={i.id} className="row-between" style={{ gap: 12 }}>
                <span className="small" style={{ minWidth: 0 }}>
                  {i.name}
                  <span className="muted">
                    {' '}
                    · {i.claimedQty}/{i.neededQty}
                    {i.contributors.length > 0 ? ` · ${i.contributors.join(', ')}` : ''}
                  </span>
                </span>
                {canEdit && (
                  <button
                    className="btn btn-sm btn-ghost"
                    style={{ flexShrink: 0 }}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(i.id)}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))
          )}

          {canEdit && (
            <div className="row" style={{ gap: 8, marginTop: 4 }}>
              <input
                value={newItem}
                onChange={e => setNewItem(e.target.value.slice(0, 80))}
                placeholder="First aid kit"
                style={{ flex: 1 }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newItem.trim()) add.mutate();
                }}
              />
              <input
                type="number"
                min={1}
                max={99}
                value={newQty}
                onChange={e => setNewQty(Number(e.target.value))}
                style={{ width: 68 }}
                aria-label="How many"
              />
              <button
                className="btn btn-sm"
                disabled={!newItem.trim() || add.isPending}
                onClick={() => add.mutate()}
              >
                Add
              </button>
            </div>
          )}
        </div>

        {/* ── Packing suggestions ───────────────────────────────────────── */}
        <div className="stack" style={{ gap: 8 }}>
          <strong className="small">What everyone should pack</strong>
          <span className="muted small">
            One per line. This becomes a checklist on every traveler's own phone — editing it
            keeps the boxes they have already ticked.
          </span>
          {canEdit ? (
            <>
              <textarea
                value={packing}
                rows={5}
                onChange={e => {
                  setPacking(e.target.value);
                  setPackingDirty(true);
                }}
                placeholder={'Reef booties\nRash guard\nSun cream'}
              />
              <div className="row" style={{ gap: 8 }}>
                <button
                  className="btn btn-sm"
                  disabled={!packingDirty || savePacking.isPending}
                  onClick={() => savePacking.mutate()}
                >
                  {savePacking.isPending ? 'Saving…' : 'Save the list'}
                </button>
              </div>
            </>
          ) : (suggestions.data ?? []).length === 0 ? (
            <span className="muted small">Nothing suggested yet.</span>
          ) : (
            <span className="small">{(suggestions.data ?? []).join(' · ')}</span>
          )}
        </div>
      </div>
    </div>
  );
}
