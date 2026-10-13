// The two certification rows inside the Overview's Accommodation card
// (Figma 17488:28133 and 17780:27456): a logo, the program's name and a
// "Learn More" link. Each row shows only when the trip carries its flag.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image as CachedImage } from 'expo-image';
import { Images } from '../../../assets/images';
import { textStyle, textStyles } from '../../../theme/typography';

// Figma draws both logos 33 tall.
const LOGO_H = 33;
// The CI file is a wide wordmark with the emblem at its right end. Figma shows
// only the emblem: a 29-wide window on the image's right edge (17488:28136).
const CI_WINDOW_W = 29;
const CI_IMAGE_W = 102; // 351.39% of the window, as Figma scales it

// "Learn More" is drawn but opens nothing yet — there is no page to send
// people to (Ohad, 9 Oct). A plain row, so it does not press like a button.
const CertRow: React.FC<{ logo: React.ReactNode; title: string }> = ({ logo, title }) => (
  <View style={styles.row}>
    <View style={styles.logoSlot}>{logo}</View>
    <View style={styles.text}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.link}>Learn More</Text>
    </View>
  </View>
);

export const StayCertRows: React.FC<{
  ciSurfConservation?: boolean | null;
  stokeCertified?: boolean | null;
}> = ({ ciSurfConservation, stokeCertified }) => {
  if (!ciSurfConservation && !stokeCertified) return null;
  return (
    <>
      {ciSurfConservation ? (
        <CertRow
          title={'Conservation International\nSurf Protected Ecosystem'}
          logo={
            <View style={styles.ciWindow}>
              <CachedImage
                source={Images.stayCerts.conservationInternational}
                style={styles.ciImage}
                contentFit="fill"
              />
            </View>
          }
        />
      ) : null}
      {stokeCertified ? (
        <CertRow
          title="Sustainable STOKE Certified Provider"
          logo={
            <CachedImage
              source={Images.stayCerts.stoke}
              style={styles.stokeLogo}
              contentFit="contain"
            />
          }
        />
      ) : null}
    </>
  );
};

export default StayCertRows;

const styles = StyleSheet.create({
  // Figma: 74 tall, 32 radius, the logo 15 from the left and the text at 61.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
    minHeight: 74,
    paddingLeft: 13,
    paddingRight: 16,
    paddingVertical: 10,
    borderRadius: 32,
    backgroundColor: '#F7F7F7',
  },
  // One slot width for both logos, so the two titles start on the same line.
  logoSlot: { width: LOGO_H, height: LOGO_H, alignItems: 'center', justifyContent: 'center' },
  ciWindow: { width: CI_WINDOW_W, height: LOGO_H, overflow: 'hidden' },
  ciImage: { position: 'absolute', right: 0, top: 0, width: CI_IMAGE_W, height: LOGO_H },
  stokeLogo: { width: LOGO_H, height: LOGO_H },
  text: { flex: 1 },
  // Body/B-3 12/18, bold override (get_variable_defs 17488:28140, 17780:27463).
  title: { ...textStyle('B3', '700'), color: '#0A0A0A' },
  // Body/B-4 10/17 (get_variable_defs 17488:28141).
  link: { ...textStyles.B4, color: '#05BCD3' },
});
