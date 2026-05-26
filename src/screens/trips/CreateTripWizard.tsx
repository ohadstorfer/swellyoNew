import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { HostingStyle, GroupTrip } from '../../services/trips/groupTripsService';
import CreateTripFlowA from './CreateTripFlowA';
import CreateTripFlowC from './CreateTripFlowC';

interface CreateTripWizardProps {
  hostId: string | null;
  onCreated: () => void;
  onCancel: () => void;
  /** When provided, runs in edit mode — routes straight into the matching flow. */
  initialTrip?: GroupTrip;
}

const OPTIONS: { key: HostingStyle; title: string; desc: string }[] = [
  {
    key: 'A',
    title: 'A. Create a group with a general idea',
    desc: 'Loose & collaborative — many fields can stay fuzzy.',
  },
  {
    key: 'B',
    title: 'B. Lead on most topics, discuss some',
    desc: 'Semi-structured — real dates, destination required.',
  },
  {
    key: 'C',
    title: 'C. Create a full trip for others to join your vision',
    desc: 'Fully prescriptive — everything locked in.',
  },
];

/**
 * Entry point for trip creation. Shows the hosting-style chooser, then routes:
 *   - A → CreateTripFlowA (months/exact dates + AI budget)
 *   - B → CreateTripFlowA with hostingStyle='B' (same flow as A)
 *   - C → CreateTripFlowC (exact dates + fixed pricing + trip structure)
 * In edit mode the style is locked, so it routes straight into the matching flow
 * by the trip's hosting_style without showing the chooser.
 */
export default function CreateTripWizard({
  hostId,
  onCreated,
  onCancel,
  initialTrip,
}: CreateTripWizardProps) {
  const editMode = !!initialTrip;
  const [chosen, setChosen] = useState<HostingStyle | null>(initialTrip?.hosting_style ?? null);
  const [started, setStarted] = useState<boolean>(editMode);

  if (started && chosen) {
    // In edit mode the style can't change, so "back" cancels the whole wizard.
    const onBack = editMode ? onCancel : () => setStarted(false);
    if (chosen === 'A' || chosen === 'B') {
      // B reuses Flow A; hostingStyle keeps the row's hosting_style correct.
      return (
        <CreateTripFlowA
          hostId={hostId}
          onCreated={onCreated}
          onCancel={onBack}
          initialTrip={initialTrip}
          hostingStyle={chosen}
        />
      );
    }
    return (
      <CreateTripFlowC
        hostId={hostId}
        onCreated={onCreated}
        onCancel={onBack}
        initialTrip={initialTrip}
      />
    );
  }

  const handleNext = () => {
    if (!chosen) {
      Alert.alert('Hold on', 'Please pick a trip type.');
      return;
    }
    setStarted(true);
  };

  return (
    <View style={styles.root}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.heading}>Do you want to…</Text>
        {OPTIONS.map(opt => {
          const active = chosen === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              style={[styles.optionCard, active && styles.optionCardActive]}
              onPress={() => setChosen(opt.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.optionTitle, active && styles.optionTitleActive]}>{opt.title}</Text>
              <Text style={[styles.optionDesc, active && styles.optionDescActive]}>{opt.desc}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.backBtnBar} onPress={onCancel}>
          <Text style={styles.backBtnText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primaryBtn} onPress={handleNext}>
          <Text style={styles.primaryBtnText}>Next</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  heading: { fontSize: 18, fontWeight: '600', color: '#222B30', marginBottom: 16 },

  optionCard: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  optionCardActive: { borderColor: '#0788B0', backgroundColor: '#E6F4F8' },
  optionTitle: { fontSize: 15, fontWeight: '600', color: '#222B30', marginBottom: 4 },
  optionTitleActive: { color: '#066b8c' },
  optionDesc: { fontSize: 13, color: '#7B7B7B' },
  optionDescActive: { color: '#3a8aa3' },

  footer: {
    flexDirection: 'row',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#EEE',
    gap: 10,
  },
  backBtnBar: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: '#F2F2F2',
  },
  backBtnText: { color: '#222B30', fontWeight: '600' },
  primaryBtn: {
    flex: 2,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: '#0788B0',
  },
  primaryBtnText: { color: '#FFF', fontWeight: '700' },
});
