// 只是本地看一眼各态长什么样，不参与扩展的真实构建。
// 跑法：npx vite --config Devpreview.vite.config.ts   然后打开终端里打印的地址
import { createRoot } from 'react-dom/client';
import { CuteAnchorPet } from '../pet/cat';
import { buildRestReminderMessage } from '../engine/wording';

const log = (...args: unknown[]) => console.log(...args);

createRoot(document.getElementById('a')!).render(
  <CuteAnchorPet state="companion" focusedMinutes={12} onRestStart={() => log('REST_START')} />
);
createRoot(document.getElementById('b')!).render(
  <CuteAnchorPet state="observing" onRestStart={() => log('REST_START')} />
);
createRoot(document.getElementById('c')!).render(
  <CuteAnchorPet
    state="checkin"
    channel="DRIFT"
    message="You drifted from that login-page bug 10 minutes ago — still researching, or did you wander off?"
    onAnswer={(answer, channel) => log('answered:', answer, channel)}
    onRestStart={() => log('REST_START')}
  />
);

// ── 休息模式（契约v4 §3.8）──
// 休息不是第四个 PetState：下面两格 state 都还是 'companion'，只是 isResting 打开了。
createRoot(document.getElementById('d')!).render(
  <CuteAnchorPet state="companion" isResting onRestEnd={() => log('REST_END')} />
);
// 休息满 15 分钟起的提醒。文案走 B7 的 buildRestReminderMessage()，跟 side panel 里
// main.tsx 现算的那份是同一个函数，不另写一份假文案。
createRoot(document.getElementById('e')!).render(
  <CuteAnchorPet
    state="companion"
    isResting
    isRestReminder
    message={buildRestReminderMessage(16)}
    onRestEnd={() => log('REST_END')}
    onSessionEnd={() => log('SESSION_END')}
  />
);
