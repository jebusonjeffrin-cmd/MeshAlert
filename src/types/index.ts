export type MessageType = 'SOS' | 'HEARTBEAT';
export type EmergencyType = 'MEDICAL' | 'TRAPPED' | 'SAFE';
export type BloodGroup = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-' | 'Unknown';

export interface MeshMessage {
  messageId: string;
  senderId: string;
  senderName: string;
  type: MessageType;
  emergencyType?: EmergencyType;
  payload: {
    latitude: number;
    longitude: number;
    message?: string;
    audioBase64?: string;
    bloodGroup?: BloodGroup;
    emergencyContacts?: string[];
    medicalConditions?: string;
    allergies?: string;
  };
  ttl: number;
  timestamp: number;
  hops: string[];
  synced?: boolean;
}

export interface UserProfile {
  deviceId: string;
  name: string;
  bloodGroup: BloodGroup;
  medicalConditions: string;
  allergies: string;
  emergencyContacts: string[];
}

export interface PeerDevice {
  deviceId: string;
  name: string;
  rssi: number;
  lastSeen: number;
  latitude?: number;
  longitude?: number;
  distanceMetres?: number;
}

export interface Location {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}
