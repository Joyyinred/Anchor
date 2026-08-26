// 只是本地看一眼三态长什么样，不参与扩展的真实构建。
// 跑法见聊天里的步骤说明：npx vite --config devpreview.vite.config.ts
import { createRoot } from 'react-dom/client';
import { CuteAnchorPet } from '../pet/cat';

createRoot(document.getElementById('a')!).render(
  <CuteAnchorPet state="companion" focusedMinutes={12} />
);
createRoot(document.getElementById('b')!).render(
  <CuteAnchorPet state="observing" />
);
createRoot(document.getElementById('c')!).render(
  <CuteAnchorPet
    state="checkin"
    channel="DRIFT"
    message="You drifted from that login-page bug 10 minutes ago — still researching, or did you wander off?"
    onAnswer={(answer, channel) => console.log('answered:', answer, channel)}
  />
);
