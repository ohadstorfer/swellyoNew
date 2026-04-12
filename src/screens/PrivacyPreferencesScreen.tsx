import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ScrollView,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { analyticsService } from '../services/analytics/analyticsService';
import { BlockedUsersScreen } from './BlockedUsersScreen';

const STORAGE_KEYS = {
  analytics: 'swellyo_privacy_analytics',
};

const DEFAULTS = {
  analytics: true,
};

interface ToggleSwitchProps {
  value: boolean;
  onToggle: () => void;
}

function ToggleSwitch({ value, onToggle }: ToggleSwitchProps) {
  const animValue = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(animValue, {
      toValue: value ? 1 : 0,
      tension: 60,
      friction: 8,
      useNativeDriver: false,
    }).start();
  }, [value]);

  const thumbTranslate = animValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 19],
  });

  const trackColor = animValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['#eceef2', '#b72df2'],
  });

  return (
    <TouchableOpacity onPress={onToggle} activeOpacity={0.8}>
      <Animated.View style={[styles.toggleTrack, { backgroundColor: trackColor }]}>
        <Animated.View
          style={[styles.toggleThumb, { transform: [{ translateX: thumbTranslate }] }]}
        />
      </Animated.View>
    </TouchableOpacity>
  );
}

interface PrivacyPreferencesScreenProps {
  onBack: () => void;
}

export function PrivacyPreferencesScreen({ onBack }: PrivacyPreferencesScreenProps) {
  const insets = useSafeAreaInsets();
  const [analytics, setAnalytics] = useState(DEFAULTS.analytics);
  const [showBlockedUsers, setShowBlockedUsers] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const a = await AsyncStorage.getItem(STORAGE_KEYS.analytics);
        if (a !== null) setAnalytics(JSON.parse(a));
      } catch (e) {
        console.error('Error loading privacy preferences:', e);
      }
      setLoaded(true);
    })();
  }, []);

  const toggle = (key: string, current: boolean, setter: (v: boolean) => void) => {
    const next = !current;
    setter(next);
    if (key === STORAGE_KEYS.analytics) {
      analyticsService.setOptOut(!next).catch(console.error);
    } else {
      AsyncStorage.setItem(key, JSON.stringify(next)).catch(console.error);
    }
  };

  if (!loaded) return null;

  if (showBlockedUsers) {
    return (
      <BlockedUsersScreen
        onBack={() => setShowBlockedUsers(false)}
      />
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7}>
        <Ionicons name="chevron-back" size={18} color="#333" />
        <Text style={styles.backButtonText}>Back</Text>
      </TouchableOpacity>

      <View style={[styles.bottomCard, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <View style={styles.topSpacer} />

        <View style={styles.divider} />

        <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
          <Text style={styles.title}>Privacy preferences</Text>

          <View style={styles.row}>
            <View style={styles.rowHeader}>
              <Text style={styles.rowTitle}>Analytics</Text>
              <ToggleSwitch
                value={analytics}
                onToggle={() => toggle(STORAGE_KEYS.analytics, analytics, setAnalytics)}
              />
            </View>
            <Text style={styles.rowDescription}>
              Help us improve Swelly by sharing anonymous usage data. You can turn this off anytime.
            </Text>
          </View>

          <View style={styles.sectionDivider} />

          <TouchableOpacity style={styles.contactsSection} activeOpacity={0.7} onPress={() => setShowBlockedUsers(true)}>
            <Text style={styles.rowTitle}>Contacts</Text>
            <Text style={styles.rowDescription}>Blocked accounts</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F7F7',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EEE',
    borderRadius: 48,
    paddingLeft: 8,
    paddingRight: 12,
    paddingVertical: 10,
    height: 40,
    minWidth: 70,
    position: 'absolute',
    top: 54,
    left: 16,
    zIndex: 10,
  },
  backButtonText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 12,
    fontWeight: '400' as const,
    color: '#333',
    lineHeight: 15,
  },
  bottomCard: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: 102,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
  },
  topSpacer: {
    height: 20,
  },
  divider: {
    height: 1,
    backgroundColor: '#E3E3E3',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingTop: 24,
    paddingBottom: 24,
    gap: 24,
  },
  title: {
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#333',
    lineHeight: 24,
  },
  row: {
    backgroundColor: '#FFFFFF',
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 10,
    gap: 16,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowTitle: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 20,
    fontWeight: '700' as const,
    color: '#333',
    lineHeight: 24,
  },
  rowDescription: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 14,
    fontWeight: '400' as const,
    color: '#333',
    lineHeight: 18,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: '#E3E3E3',
  },
  contactsSection: {
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 10,
    gap: 4,
  },
  toggleTrack: {
    width: 43,
    height: 24,
    borderRadius: 24,
    padding: 2,
    justifyContent: 'center',
  },
  toggleThumb: {
    width: 22,
    height: 19,
    borderRadius: 9999,
    backgroundColor: '#FFFFFF',
    shadowColor: '#101828',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
});
