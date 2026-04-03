import React from 'react';
import { View, Text, StyleSheet, StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { HomeScreen } from './screens/HomeScreen';
import { MapScreen } from './screens/MapScreen';
import { MeshScreen } from './screens/MeshScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { COLORS } from './utils/constants';

const Tab = createBottomTabNavigator();

interface EBState { hasError: boolean; error: string }

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, EBState> {
  state: EBState = { hasError: false, error: '' };

  static getDerivedStateFromError(e: Error): EBState {
    return { hasError: true, error: e.message };
  }

  componentDidCatch(e: Error) {
    console.error('[ErrorBoundary] Caught error:', e.message, e.stack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={eb.screen}>
          <Text style={eb.icon}>⚠️</Text>
          <Text style={eb.title}>Something went wrong</Text>
          <Text style={eb.msg}>{this.state.error}</Text>
          <Text style={eb.hint}>Check adb logcat for details</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const eb = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center', padding: 30 },
  icon: { fontSize: 48, marginBottom: 16 },
  title: { fontSize: 18, fontWeight: '800', color: COLORS.text, marginBottom: 8 },
  msg: { fontSize: 13, color: COLORS.sos, textAlign: 'center', marginBottom: 12, fontFamily: 'monospace' },
  hint: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center' },
});

export default function App(): React.JSX.Element {
  return (
    <ErrorBoundary>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={{
            tabBarStyle: {
              backgroundColor: COLORS.surface,
              borderTopColor: COLORS.border,
              borderTopWidth: 1,
            },
            tabBarActiveTintColor: COLORS.sos,
            tabBarInactiveTintColor: COLORS.textMuted,
            headerStyle: { backgroundColor: COLORS.surface, borderBottomColor: COLORS.border, borderBottomWidth: 1 },
            headerTintColor: COLORS.text,
            headerTitleStyle: { fontWeight: '800' },
          }}
        >
          <Tab.Screen
            name="Home"
            component={HomeScreen}
            options={{ title: 'MeshAlert', tabBarLabel: 'Home', tabBarIcon: ({ color }) => <TabIcon icon="🆘" color={color} /> }}
          />
          <Tab.Screen
            name="Map"
            component={MapScreen}
            options={{ title: 'Alerts', tabBarLabel: 'Alerts', tabBarIcon: ({ color }) => <TabIcon icon="📍" color={color} /> }}
          />
          <Tab.Screen
            name="Mesh"
            component={MeshScreen}
            options={{ title: 'Mesh', tabBarLabel: 'Mesh', tabBarIcon: ({ color }) => <TabIcon icon="📡" color={color} /> }}
          />
          <Tab.Screen
            name="Profile"
            component={ProfileScreen}
            options={{ title: 'Profile', tabBarLabel: 'Profile', tabBarIcon: ({ color }) => <TabIcon icon="👤" color={color} /> }}
          />
          <Tab.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ title: 'Settings', tabBarLabel: 'Settings', tabBarIcon: ({ color }) => <TabIcon icon="⚙️" color={color} /> }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </ErrorBoundary>
  );
}

const TabIcon: React.FC<{ icon: string; color: string }> = ({ icon }) => (
  <Text style={{ fontSize: 18 }}>{icon}</Text>
);
