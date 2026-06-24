import React from 'react';
import { View, Text, Modal, Pressable, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { ff } from '../../../theme/fonts';

interface Props {
  visible: boolean;
  /** Dismiss — the only action ("Got it"). Purely informational. */
  onDismiss: () => void;
}

// Alert-triangle glyph (Figma) — stroked in #222B30.
const WarningIcon: React.FC<{ size?: number }> = ({ size = 26 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M11.9978 8.99999V13M11.9978 17H12.0078M10.6131 3.89171L2.38823 18.0983C1.93203 18.8863 1.70393 19.2803 1.73764 19.6037C1.76705 19.8857 1.91482 20.142 2.14417 20.3088C2.40713 20.5 2.86239 20.5 3.77292 20.5H20.2227C21.1332 20.5 21.5885 20.5 21.8514 20.3088C22.0808 20.142 22.2286 19.8857 22.258 19.6037C22.2917 19.2803 22.0636 18.8863 21.6074 18.0983L13.3825 3.89171C12.9279 3.10654 12.7006 2.71396 12.4041 2.58211C12.1454 2.4671 11.8502 2.4671 11.5915 2.58211C11.295 2.71396 11.0677 3.10655 10.6131 3.89171Z"
      stroke="#222B30"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

/**
 * One-time heads-up shown to the host shortly after they open the chat to review
 * a member's commitment (from the "Review request" notification). Informational
 * only — a single "Got it" dismisses it; approving still happens on the bubble.
 */
export const BeforeYouApproveModal: React.FC<Props> = ({ visible, onDismiss }) => {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          {/* Gradient-ring circle: a horizontal accent gradient with a white
              inner disc, leaving a thin ring; the dark warning glyph sits on top. */}
          <LinearGradient
            colors={['#B72DF2', '#FF5367']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.iconRing}
          >
            <View style={styles.iconInner}>
              <WarningIcon size={26} />
            </View>
          </LinearGradient>

          <Text style={styles.title}>Before you approve</Text>
          <Text style={styles.body}>
            Verify their commitment is genuine - other members may book flights, accommodation, and more based on it.
          </Text>

          <TouchableOpacity
            style={styles.btn}
            onPress={onDismiss}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Got it"
          >
            <Text style={styles.btnText}>Got it</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  // Gradient ring (outer) — fills the circle; the inner white disc reveals it
  // as a ~1.5px ring.
  iconRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  iconInner: {
    width: 53,
    height: 53,
    borderRadius: 26.5,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Figma: Size/xl 18 / Size/3-xl 24, weight 700.
  title: {
    fontFamily: ff('Montserrat', '700'),
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    color: '#212121',
    textAlign: 'center',
  },
  // Figma: Size/md 14 / Size/xl 18, weight 400, #7B7B7B.
  body: {
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    lineHeight: 18,
    color: '#7B7B7B',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 36,
    paddingHorizontal: 12,
  },
  btn: {
    width: '100%',
    height: 52,
    borderRadius: 12,
    backgroundColor: '#212121',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Figma: Size/lg 16 / lineHeight 24, weight 400 (Body/M B-1, Inter Regular).
  btnText: {
    fontFamily: ff('Inter', '400'),
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400',
    color: '#FFFFFF',
  },
});

export default BeforeYouApproveModal;
