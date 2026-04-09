# 🆘 MeshAlert — Offline Disaster Relief Mesh Network

> Communicate when infrastructure fails. No internet. No cell towers. Just Bluetooth.

MeshAlert is an Android app that creates a peer-to-peer mesh network using Bluetooth (Google Nearby Connections). When disaster strikes and cell networks go down, phones running MeshAlert can relay SOS alerts across multiple devices — each phone acts as a node, hopping messages up to 10 devices deep to reach help.

---

## Features

| Feature | Description |
|---|---|
| 📡 **BLE Mesh** | Google Nearby Connections P2P_CLUSTER — works fully offline, ~50m range per hop |
| 🔴 **One-tap SOS** | Broadcasts your name, GPS location, blood group, medical info, and a voice note |
| ✅ **ACK System** | Responders tap "I'm coming" — the SOS sender gets vibration + alert confirmation |
| 💓 **Heartbeat** | Auto-ping every 5 minutes so your network knows you're alive |
| 🗺️ **Offline Maps** | Cache OSM tiles (zoom 13–15) for your area while online; maps work without data |
| 🎙️ **Voice Notes** | Record and attach audio to SOS broadcasts |
| 🆔 **QR Identity Card** | Your medical info as a QR code — show to first responders |
| 🌐 **Dashboard Sync** | Any phone with internet auto-uploads all relayed alerts to a command dashboard |
| 🔁 **Multi-hop Relay** | Messages hop up to 10 devices (TTL-based flooding) |

---

## How It Works

1. Victim taps SOS — message floods out over BLE to all nearby MeshAlert devices
2. Each device relays the message further (TTL decrements each hop, stops at 0)
3. Any device that regains internet connectivity silently uploads all stored alerts to the dashboard
4. Responders on the dashboard see live SOS pins on a map with full medical details

---

## Screenshots

> *(Add screenshots here)*

---

## Tech Stack

- **React Native 0.73** (TypeScript, Android)
- **Google Nearby Connections SDK** — BLE P2P_CLUSTER transport
- **SQLite** via `@op-engineering/op-sqlite` — local message store
- **Leaflet 1.9.4** — offline-capable map (inlined, no CDN)
- **react-native-fs** — OSM tile caching to device storage
- **Node.js + Express** — optional dashboard server with SSE live feed
- **Hermes** JS engine

---

## Getting Started

### Prerequisites
- Android device (API 26+, Bluetooth LE required)
- Node.js 18+, JDK 17, Android SDK

### Install

```bash
git clone https://github.com/jebusonjeffrin-cmd/MeshAlert.git
cd MeshAlert
npm install
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
Run Dashboard (optional)

cd server
npm install
node server.js
# Dashboard at http://localhost:3000
# Expose via localtunnel: npx localtunnel --port 3000
Then enter the tunnel URL in the app under Settings → Dashboard Sync.

Mesh Protocol
Transport: BLE via Google Nearby Connections (P2P_CLUSTER strategy)
Message TTL: 10 hops max
Scan interval: Continuous discovery
Heartbeat: Every 5 minutes (confirms node is alive)
Deduplication: messageId set per device — never relays the same message twice
Message types: SOS, HEARTBEAT, ACK
SOS Payload

{
  "messageId": "uuid",
  "type": "SOS",
  "emergencyType": "MEDICAL | TRAPPED | FIRE | OTHER",
  "senderId": "device-id",
  "senderName": "John Doe",
  "payload": {
    "latitude": 12.9716,
    "longitude": 77.5946,
    "message": "Trapped under rubble, 3rd floor",
    "bloodGroup": "O+",
    "medicalConditions": "Diabetes",
    "allergies": "Penicillin",
    "audioBase64": "..."
  },
  "ttl": 10,
  "hops": ["device-a", "device-b"],
  "timestamp": 1712345678000
}
Permissions Required
Permission	Reason
BLUETOOTH_SCAN / BLUETOOTH_ADVERTISE / BLUETOOTH_CONNECT	BLE mesh
ACCESS_FINE_LOCATION	Required by Android for BLE scanning
RECORD_AUDIO	Voice SOS notes
POST_NOTIFICATIONS	Foreground service notification
Built for Hackathon
MeshAlert was built as a proof-of-concept for offline disaster communication — demonstrating that smartphones already in people's pockets can form an ad-hoc rescue network with zero infrastructure dependency.



