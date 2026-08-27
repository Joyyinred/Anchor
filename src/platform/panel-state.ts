// Anchor · background <-> side panel 之间共享的状态形状（chrome.storage.local 里存的那份）。
// 跟 messages.ts 一样是传输层，不是引擎契约——不放进 src/engine/types.ts。
// PetState/CheckInChannel 复用 src/pet/types.ts 已经声明的那份（不再手写第三份字面量，
// 08-26 code review ⑨已经在 pet/engine 两边为同样的问题加过一次编译期哨兵，这里不重蹈覆辙）。
import type { PetState, CheckInChannel } from '../pet/types';

export const PANEL_STATE_KEY = 'anchor_panel_state';

export interface PanelState {
  state: PetState;
  message?: string;
  channel?: CheckInChannel;
}
