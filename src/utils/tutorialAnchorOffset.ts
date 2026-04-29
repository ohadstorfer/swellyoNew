import { Platform, StatusBar } from 'react-native';

// TutorialOverlay renders inside <Modal statusBarTranslucent>. On Android
// (edge-to-edge enabled in app.json) the modal's coordinate origin is the top
// of the screen INCLUDING the status bar, but measureInWindow on anchors
// outside the modal returns y EXCLUDING it (because the app's safe-area
// pushes content down). Without this offset the spotlight cutout draws ~24px
// above the actual anchor on Android. iOS doesn't need it.
export const TUTORIAL_ANCHOR_Y_OFFSET =
  Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0;
