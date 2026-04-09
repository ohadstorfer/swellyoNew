import { Platform } from 'react-native';

const KEY_BLOCKED = 'swellyo_age_gate_blocked';
const KEY_UNBLOCK_DATE = 'swellyo_age_gate_unblock_date';
const KEY_DOB = 'swellyo_age_gate_dob';

function calculate18thBirthday(dateOfBirth: string): string {
  const dob = new Date(dateOfBirth + 'T00:00:00Z');
  const year = dob.getUTCFullYear() + 18;
  const month = String(dob.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dob.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function getSecureStore() {
  if (Platform.OS === 'web') return null;
  try {
    return require('expo-secure-store') as typeof import('expo-secure-store');
  } catch {
    return null;
  }
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  const ss = await getSecureStore();
  if (!ss) return null;
  try { return await ss.getItemAsync(key); } catch { return null; }
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try { localStorage.setItem(key, value); } catch {}
    return;
  }
  const ss = await getSecureStore();
  if (!ss) return;
  try { await ss.setItemAsync(key, value); } catch {}
}

async function deleteItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    try { localStorage.removeItem(key); } catch {}
    return;
  }
  const ss = await getSecureStore();
  if (!ss) return;
  try { await ss.deleteItemAsync(key); } catch {}
}

export const ageGateService = {
  async checkBlocked(): Promise<{ blocked: boolean }> {
    const blocked = await getItem(KEY_BLOCKED);
    if (blocked !== 'true') return { blocked: false };

    const unblockDate = await getItem(KEY_UNBLOCK_DATE);
    if (unblockDate && todayISO() >= unblockDate) {
      await this.clearBlock();
      return { blocked: false };
    }
    return { blocked: true };
  },

  async setBlocked(dateOfBirth: string): Promise<void> {
    await setItem(KEY_BLOCKED, 'true');
    await setItem(KEY_UNBLOCK_DATE, calculate18thBirthday(dateOfBirth));
    await setItem(KEY_DOB, dateOfBirth);
  },

  async getDOB(): Promise<string | null> {
    return getItem(KEY_DOB);
  },

  async setDOB(dateOfBirth: string): Promise<void> {
    await setItem(KEY_DOB, dateOfBirth);
  },

  async clearBlock(): Promise<void> {
    await deleteItem(KEY_BLOCKED);
    await deleteItem(KEY_UNBLOCK_DATE);
    await deleteItem(KEY_DOB);
  },
};
