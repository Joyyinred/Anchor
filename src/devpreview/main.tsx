// 只是本地看一眼三态长什么样，不参与扩展的真实构建。
// 跑法见聊天里的步骤说明：npx vite --config devpreview.vite.config.ts
import { createRoot } from 'react-dom/client';
import { CuteAnchorPet } from '../src/pet/cat';

createRoot(document.getElementById('a')!).render(
  <CuteAnchorPet state="companion" focusedMinutes={12} />
);
createRoot(document.getElementById('b')!).render(
  <CuteAnchorPet state="observing" />
);
createRoot(document.getElementById('c')!).render(
  <CuteAnchorPet
    state="checkin"
    message="你从 10 分钟前那个登录页 bug 上飘走啦，还在查资料，还是走神啦？"
    onAnswer={(a) => console.log('answered:', a)}
  />
);
