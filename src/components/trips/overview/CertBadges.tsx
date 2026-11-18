// CertBadges — the Conservation International + STOKE Certified logos, shown
// when the operator ticked them on the trip's stay. One component so Explore
// cards and the trip page's top card draw them identically.
//
// Conservation International is Figma 18675:22870, a two-path vector, drawn
// as-is. STOKE Certified is the source PNG of Figma 18675:22751 (transparent).
// Layout (Figma 18675:22874): both logos in one cell, SC 43 right and 1 down
// over CI's edge; a lone logo sits at the row's start.
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image as CachedImage } from 'expo-image';
import Svg, { Path } from 'react-native-svg';

const SC_BADGE = require('../../../../assets/images/badges/sc-badge.png');

const CiBadge: React.FC<{ style?: StyleProp<ViewStyle> }> = ({ style }) => (
  <Svg width={33.75} height={38.3643} viewBox="0 0 33.75 38.3643" fill="none" style={style}>
    <Path d="M16.5013 0.618408C24.6616 0.198488 31.6197 6.47013 32.0462 14.6301C32.4726 22.7902 26.2059 29.7528 18.0462 30.1858C9.87747 30.619 2.90574 24.3442 2.47882 16.175C2.05212 8.00599 8.33189 1.03892 16.5013 0.618408ZM16.7327 6.59497C11.8673 6.89039 8.15948 11.0689 8.44562 15.9348C8.73196 20.8009 12.9043 24.5167 17.7708 24.2395C22.6502 23.9615 26.3782 19.7757 26.0911 14.8967C25.804 10.0179 21.6111 6.29884 16.7327 6.59497Z" fill="#0096D5" stroke="#000000" strokeWidth={0.25} />
    <Path d="M28.1014 31.8312L28.1346 31.9034C28.1422 31.9199 28.1452 31.9358 28.1463 31.9415C28.1479 31.9499 28.1492 31.9587 28.1502 31.9669C28.1522 31.9835 28.1545 32.0044 28.1561 32.0275C28.1591 32.074 28.1615 32.1372 28.1639 32.214C28.1687 32.3682 28.1727 32.5817 28.1756 32.8351C28.1814 33.3425 28.1839 34.0136 28.1844 34.6954C28.1853 36.0589 28.1778 37.4714 28.1746 37.7267L28.1736 37.8468L28.0535 37.8497C27.6824 37.8593 27.1984 37.8347 26.825 37.8341V37.8331H12.5545C10.5909 37.8335 8.528 37.7984 6.57892 37.8458C6.57762 37.846 6.5763 37.8457 6.57501 37.8458C6.57338 37.8459 6.57176 37.8468 6.57013 37.8468L6.56915 37.8458C6.53582 37.8479 6.50623 37.8451 6.47638 37.8331C6.46394 37.8281 6.45237 37.8217 6.44611 37.8185C6.43878 37.8147 6.43281 37.812 6.4256 37.8087L6.37775 37.7872L6.35919 37.7374C6.35195 37.7175 6.34891 37.6946 6.3465 37.6779C6.34373 37.6587 6.34082 37.6357 6.33868 37.6105C6.3344 37.5597 6.33108 37.4936 6.32794 37.4152C6.32164 37.2578 6.31729 37.0458 6.31427 36.797C6.30823 36.2988 6.30716 35.6491 6.30939 34.9874C6.31385 33.6609 6.32938 32.291 6.3299 31.9679V31.8331L6.46368 31.8429C6.86887 31.8725 7.43808 31.8594 7.86407 31.8595L10.2186 31.8585L17.4969 31.8575L24.3065 31.8585C25.318 31.859 26.9973 31.9085 27.9373 31.8322L27.9471 31.8312H28.1014Z" fill="#48AB44" stroke="#000000" strokeWidth={0.25} />
  </Svg>
);

export const CertBadges: React.FC<{
  ci: boolean;
  stoke: boolean;
  style?: StyleProp<ViewStyle>;
}> = ({ ci, stoke, style }) => {
  if (!ci && !stoke) return null;
  return (
    <View
      style={[styles.row, { width: ci && stoke ? 43 + 36.563 : ci ? 33.75 : 36.563 }, style]}
      pointerEvents="none"
      accessible
      accessibilityLabel={[ci ? 'CI Surf Conservation' : null, stoke ? 'STOKE Certified' : null]
        .filter(Boolean)
        .join(', ')}
    >
      {ci && <CiBadge style={styles.ci} />}
      {stoke && (
        <CachedImage
          source={SC_BADGE}
          style={[styles.sc, !ci && styles.solo]}
          contentFit="contain"
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { height: 38.364 },
  ci: { position: 'absolute', left: 0, top: 0, width: 33.75, height: 38.364 },
  sc: { position: 'absolute', left: 43, top: 1, width: 36.563, height: 36.563 },
  solo: { left: 0 },
});

export default CertBadges;
