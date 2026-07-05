/**
 * WEB ONLY. metro.config.js redirects `@bottom-tabs/react-navigation` to this
 * file when bundling for web, because the native bar imports react-native
 * internals and cannot bundle for web (it kills `expo start --web` outright).
 *
 * We expose the exact `createNativeBottomTabNavigator()` shape RootNavigator
 * expects, backed by the JS @react-navigation/bottom-tabs bar (the "previous"
 * JS bar), and adapt the handful of native-only prop / option shapes so
 * RootNavigator needs zero platform branching. This is a dev-convenience bar so
 * the app runs on localhost — it is not meant to be pixel-perfect.
 */
import React from 'react';
import { Image } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

// Native form of tabBarIcon is `() => imageSource`. JS tabs want
// `({ color, size }) => ReactNode`, so wrap the source in an <Image>.
function adaptOptions(options: any) {
  if (!options || !options.tabBarIcon) return options;
  const { tabBarIcon, ...rest } = options;
  return {
    ...rest,
    tabBarIcon: ({ size }: { size: number }) => {
      const source = tabBarIcon();
      return <Image source={source} style={{ width: size ?? 26, height: size ?? 26 }} resizeMode="contain" />;
    },
  };
}

export function createNativeBottomTabNavigator<ParamList extends {} = any>() {
  const Nav = createBottomTabNavigator<any>();

  // Marker component — React Navigation never renders these. The Navigator
  // wrapper reads their props and emits real <Nav.Screen> children.
  const Screen = (_props: {
    name: keyof ParamList & string;
    component: React.ComponentType<any>;
    options?: any;
  }): React.ReactElement | null => null;

  const Navigator = ({
    children,
    screenOptions,
    tabBarHidden,
    tabBarActiveTintColor,
    tabBarInactiveTintColor,
    // native-only @bottom-tabs props — dropped on web:
    minimizeBehavior: _minimizeBehavior,
    labeled: _labeled,
    hapticFeedbackEnabled: _hapticFeedbackEnabled,
    ...rest
  }: any) => {
    const realScreens = React.Children.toArray(children)
      .filter((c): c is React.ReactElement<any> => React.isValidElement(c))
      .map((child) => {
        const { name, component, options } = child.props;
        return (
          <Nav.Screen key={name} name={name} component={component} options={adaptOptions(options)} />
        );
      });

    return (
      <Nav.Navigator
        {...rest}
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor,
          tabBarInactiveTintColor,
          ...(tabBarHidden ? { tabBarStyle: { display: 'none' } } : null),
          ...(typeof screenOptions === 'object' && screenOptions ? screenOptions : null),
        }}
      >
        {realScreens}
      </Nav.Navigator>
    );
  };

  return { Navigator, Screen } as {
    Navigator: React.ComponentType<any>;
    Screen: React.ComponentType<any>;
  };
}
