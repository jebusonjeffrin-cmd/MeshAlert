import SQLite, { SQLiteDatabase } from 'react-native-sqlite-storage';
import { DB_NAME } from '../utils/constants';
import { MeshMessage, UserProfile } from '../types';

SQLite.enablePromise(true);

class StorageService {
  private db: SQLiteDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._init();
    return this.initPromise;
  }

  private async _init(): Promise<void> {
    this.db = await SQLite.openDatabase({ name: DB_NAME, location: 'default' });
    await this.createTables();
    console.log('[Storage] ✅ Database ready');
  }

  private async createTables(): Promise<void> {
    const db = this.getDB();
    await db.executeSql(`CREATE TABLE IF NOT EXISTS pending_messages (
      message_id TEXT PRIMARY KEY, data TEXT NOT NULL,
      created_at INTEGER NOT NULL, synced INTEGER DEFAULT 0);`);
    await db.executeSql(`CREATE TABLE IF NOT EXISTS received_messages (
      message_id TEXT PRIMARY KEY, data TEXT NOT NULL, received_at INTEGER NOT NULL);`);
    await db.executeSql(`CREATE TABLE IF NOT EXISTS user_profile (
      key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    await db.executeSql(`CREATE TABLE IF NOT EXISTS seen_message_ids (
      message_id TEXT PRIMARY KEY, seen_at INTEGER NOT NULL);`);
  }

  private getDB(): SQLiteDatabase {
    if (!this.db) throw new Error('StorageService not initialized');
    return this.db;
  }

  // ─── Pending (outbox) ────────────────────────────────────────────────────────

  async savePending(message: MeshMessage): Promise<void> {
    try {
      const db = this.getDB();
      await db.executeSql(
        'INSERT OR REPLACE INTO pending_messages (message_id,data,created_at,synced) VALUES(?,?,?,0);',
        [message.messageId, JSON.stringify(message), message.timestamp],
      );
    } catch (e: any) { console.warn('[Storage] savePending error:', e?.message); }
  }

  async getUnsyncedMessages(): Promise<MeshMessage[]> {
    try {
      const db = this.getDB();
      const [r] = await db.executeSql(
        'SELECT data FROM pending_messages WHERE synced=0 ORDER BY created_at ASC;',
      );
      const out: MeshMessage[] = [];
      for (let i = 0; i < r.rows.length; i++) {
        try { out.push(JSON.parse(r.rows.item(i).data)); } catch {}
      }
      return out;
    } catch (e: any) {
      console.warn('[Storage] getUnsyncedMessages error:', e?.message);
      return [];
    }
  }

  async markSynced(messageId: string): Promise<void> {
    try {
      const db = this.getDB();
      await db.executeSql('UPDATE pending_messages SET synced=1 WHERE message_id=?;', [messageId]);
    } catch {}
  }

  // ─── Received messages ────────────────────────────────────────────────────────

  async saveReceived(message: MeshMessage): Promise<void> {
    try {
      const db = this.getDB();
      await db.executeSql(
        'INSERT OR IGNORE INTO received_messages (message_id,data,received_at) VALUES(?,?,?);',
        [message.messageId, JSON.stringify(message), Date.now()],
      );
    } catch {}
  }

  async getSOSMessages(): Promise<MeshMessage[]> {
    try {
      const db = this.getDB();
      const [r] = await db.executeSql(
        'SELECT data FROM received_messages ORDER BY received_at DESC LIMIT 500;',
      );
      const all: MeshMessage[] = [];
      for (let i = 0; i < r.rows.length; i++) {
        try {
          const m = JSON.parse(r.rows.item(i).data) as MeshMessage;
          if (m.type === 'SOS') all.push(m);
        } catch {}
      }
      return all;
    } catch (e: any) {
      console.warn('[Storage] getSOSMessages error:', e?.message);
      return [];
    }
  }

  async getRecentMessages(limit = 100): Promise<MeshMessage[]> {
    try {
      const db = this.getDB();
      const [r] = await db.executeSql(
        'SELECT data FROM received_messages ORDER BY received_at DESC LIMIT ?;',
        [limit],
      );
      const out: MeshMessage[] = [];
      for (let i = 0; i < r.rows.length; i++) {
        try { out.push(JSON.parse(r.rows.item(i).data)); } catch {}
      }
      return out;
    } catch { return []; }
  }

  async getAllMessages(): Promise<MeshMessage[]> {
    return this.getRecentMessages(500);
  }

  async clearMessages(): Promise<void> {
    try {
      const db = this.getDB();
      await db.executeSql('DELETE FROM received_messages;');
      await db.executeSql('DELETE FROM pending_messages;');
      await db.executeSql('DELETE FROM seen_message_ids;');
      console.log('[Storage] Messages cleared');
    } catch (e: any) { console.warn('[Storage] clearMessages error:', e?.message); }
  }

  // ─── Seen IDs (dedup) ────────────────────────────────────────────────────────

  async saveSeenId(id: string): Promise<void> {
    try {
      const db = this.getDB();
      await db.executeSql(
        'INSERT OR IGNORE INTO seen_message_ids (message_id,seen_at) VALUES(?,?);',
        [id, Date.now()],
      );
    } catch {}
  }

  async getSeenIds(): Promise<string[]> {
    try {
      const db = this.getDB();
      const [r] = await db.executeSql(
        'SELECT message_id FROM seen_message_ids ORDER BY seen_at DESC LIMIT 1000;',
      );
      const ids: string[] = [];
      for (let i = 0; i < r.rows.length; i++) ids.push(r.rows.item(i).message_id);
      return ids;
    } catch { return []; }
  }

  // ─── Profile ────────────────────────────────────────────────────────────────

  async saveProfile(profile: UserProfile): Promise<void> {
    try {
      const db = this.getDB();
      for (const [key, value] of Object.entries(profile)) {
        await db.executeSql('INSERT OR REPLACE INTO user_profile(key,value) VALUES(?,?);',
          [key, typeof value === 'string' ? value : JSON.stringify(value)]);
      }
    } catch {}
  }

  async getProfile(): Promise<UserProfile | null> {
    try {
      const db = this.getDB();
      const [r] = await db.executeSql('SELECT key,value FROM user_profile;');
      if (r.rows.length === 0) return null;
      const obj: Record<string, any> = {};
      for (let i = 0; i < r.rows.length; i++) {
        const { key, value } = r.rows.item(i);
        try { obj[key] = JSON.parse(value); } catch { obj[key] = value; }
      }
      return obj as UserProfile;
    } catch { return null; }
  }
}

export const storageService = new StorageService();
