import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Utente anonimo: nessun login, un UUID generato al primo avvio.
const KEY = 'margine_user_id'; // prefisso storico: non rinominare senza migrazione

async function get(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
  }
  return SecureStore.getItemAsync(key);
}

async function set(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try { globalThis.localStorage?.setItem(key, value); } catch {}
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

function uuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

let cached: string | null = null;

export async function getUserId(): Promise<string> {
  if (cached) return cached;
  let id = await get(KEY);
  if (!id) {
    id = uuid();
    await set(KEY, id);
  }
  cached = id;
  return id;
}
