import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { GoogleSigninButton } from '@react-native-google-signin/google-signin';

export const GoogleSignInTest: React.FC = () => {
  const handlePress = () => {
    console.log('Google Sign-In test button pressed');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Google Sign-In Test</Text>
      <GoogleSigninButton
        style={styles.button}
        size={GoogleSigninButton.Size.Wide}
        color={GoogleSigninButton.Color.Dark}
        onPress={handlePress}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 18,
    marginBottom: 20,
  },
  button: {
    width: 300,
    height: 50,
  },
});
