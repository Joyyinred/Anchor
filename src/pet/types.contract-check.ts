// Anchor · 编译期哨兵：src/pet/types.ts 故意不 import 引擎类型（保持桌宠组件是纯展示层，
// 见 types.ts 顶部注释），所以 CheckInAnswer/CheckInChannel 在这里和 src/engine/types.ts 各自
// 独立声明了一份。两份手写字面量没有共享引用，TypeScript 不会在其中一份改了、另一份忘了改时
// 报错——这个文件用类型相等断言把这条"静默漂移"的路堵上：只做类型层面的比较（type-only
// import，零运行时代码，没有任何值被真正 import 进来），不会被 vite build 打进产物，
// 也不会让组件在运行时真的依赖引擎；只有 `npm run typecheck:platform`/`npm run typecheck`
// 会跑到这个文件，两边字面量集合一旦对不上就会在这里编译报错。
import type { CheckInAnswer as EngineCheckInAnswer, CheckInChannel as EngineCheckInChannel } from '../engine/types';
import type { CheckInAnswer as PetCheckInAnswer, CheckInChannel as PetCheckInChannel } from './types';

type AssertEqual<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false;

// 如果这两行报类型错误（无法把 true 赋给 false），说明 src/pet/types.ts 和 src/engine/types.ts
// 里的 CheckInAnswer / CheckInChannel 已经不是同一组字面量了，去把两边手动对齐。
const _checkInAnswerMatches: AssertEqual<PetCheckInAnswer, EngineCheckInAnswer> = true;
const _checkInChannelMatches: AssertEqual<PetCheckInChannel, EngineCheckInChannel> = true;

export { _checkInAnswerMatches, _checkInChannelMatches };
