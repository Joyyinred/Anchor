// Anchor · SW 状态持久化封装（契约v4 §3.1：SW 回收后从 chrome.storage.local 恢复）
import type { BStatePersistable } from '../../engine/types';

const DEMO_MODE_KEY = 'anchor_demo_mode';

function bstateKey(sessionId: string): string {
  return `anchor_bstate_${sessionId}`;
}

export async function getDemoMode(): Promise<boolean> {
  const result = await chrome.storage.local.get(DEMO_MODE_KEY);
  return Boolean(result[DEMO_MODE_KEY]);
}

export async function setDemoMode(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [DEMO_MODE_KEY]: enabled });
}

export async function getBState(sessionId: string): Promise<BStatePersistable | undefined> {
  const key = bstateKey(sessionId);
  const result = await chrome.storage.local.get(key);
  return result[key] as BStatePersistable | undefined;
}

export async function setBState(sessionId: string, state: BStatePersistable): Promise<void> {
  await chrome.storage.local.set({ [bstateKey(sessionId)]: state });
}
