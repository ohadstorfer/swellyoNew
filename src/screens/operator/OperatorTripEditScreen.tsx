import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/navigationRef';
import { EditSection } from '../../components/trips/edit/EditSection';
import { EditRow } from '../../components/trips/edit/EditRow';
import { ff } from '../../theme/fonts';

type Props = NativeStackScreenProps<RootStackParamList, 'OperatorEditTrip'>;

export default function OperatorTripEditScreen({ route, navigation }: Props) {
  // tripId is unused until Task 5 wires the first row's sheet — kept
  // destructured (not deleted) so that task's diff stays a one-liner.
  const { tripId: _tripId } = route.params;
  const noop = () => {};

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={28} color="#222B30" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit trip</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <EditSection title="Photos">
          <EditRow label="Cover photo" onPress={noop} />
        </EditSection>

        <EditSection title="The basics">
          <EditRow label="Trip name" onPress={noop} />
          <EditRow label="Description" onPress={noop} />
          <EditRow label="Where" onPress={noop} />
          <EditRow label="When" onPress={noop} />
          <EditRow label="Spots" onPress={noop} />
        </EditSection>

        <EditSection title="Who it's for">
          <EditRow label="Surf level" onPress={noop} />
          <EditRow label="Boards" onPress={noop} />
          <EditRow label="The wave" onPress={noop} />
          <EditRow label="Age" onPress={noop} />
        </EditSection>

        <EditSection title="The trip">
          <EditRow label="How it works" onPress={noop} />
          <EditRow label="Vibe" onPress={noop} />
          <EditRow label="Stay type" onPress={noop} />
          <EditRow label="Your stay" onPress={noop} />
          <EditRow label="About you" onPress={noop} />
        </EditSection>

        <EditSection title="Price">
          <EditRow label="Price per person" onPress={noop} />
          <EditRow label="Deposit" onPress={noop} />
          <EditRow label="What's included" onPress={noop} />
        </EditSection>

        <EditSection title="Visibility">
          <EditRow label="Listed in explore" onPress={noop} />
        </EditSection>

        <EditSection title="Manage">
          <EditRow label="Requirements" onPress={noop} />
          <EditRow label="Group gear" onPress={noop} />
          <EditRow label="Packing suggestions" onPress={noop} />
          <EditRow label="Admin updates" onPress={noop} />
        </EditSection>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6F6F6' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
  },
  backBtn: { padding: 4 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: ff('Inter', '700'),
    fontSize: 17,
    color: '#222B30',
  },
  scroll: { paddingBottom: 24 },
});
