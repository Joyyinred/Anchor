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
  // DRIFT check-in 触发那一刻的 frame.currentDomain——只在这条通道有意义（"就是这个域名把我
  // 判成走神了"），答 FALSE_POSITIVE 时要把这个域名写回 SessionContext.sessionWhitelist，
  // 而不是用户点按钮那一刻恰好在哪个域名（sticky 面板允许用户在气泡还没消失时已经切走）。
  domain?: string;
  // 08-30：DRIFT check-in 触发那一刻的 frame.lastAnchorSnapshot.url——check-in 文案
  // "Last I saw you on X"就是拿它拼的，答 DRIFTED 时"带我回去"也要去同一个地方，
  // 不能文案说 X、却把人带去别处（说了不算）。跟上面的 `domain` 是两码事：`domain` 是
  // "把我判成走神的那个页面"（写白名单用），这个是"走神前最后待着的相关页面"（拉回去用）。
  anchorUrl?: string;
}
