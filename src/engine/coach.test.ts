// B6 单测：起步教练最小版（契约v4 §5.5 taskDeclaration 质量要求 + 单次 LLM 调用 + SessionContext 产出）
import { describe, it, expect, vi } from 'vitest';
import {
  runStarterCoach,
  MIN_TASK_DECLARATION_LENGTH,
  MAX_FOLLOWUP_ROUNDS,
  FOLLOWUP_PROMPT,
  FIRST_ACTION_FALLBACK,
  StarterCoachLLMCall,
  TaskQualityCheckCall,
} from './coach';
import { DEFAULT_TASK_DECLARATION } from './types';

const now = 1_000_000;

function mockLLM(firstAction = 'Open your editor and write the first line'): StarterCoachLLMCall {
  return vi.fn().mockResolvedValue({ firstAction });
}

function mockQualityCheck(result: { sufficient: boolean; followupQuestion?: string }): TaskQualityCheckCall {
  return vi.fn().mockResolvedValue(result);
}

describe('B6: runStarterCoach 追问闸门（契约v4 §5.5）', () => {
  it('"essay"（5字符）< 8 字符，第一轮追问，不调用 LLM', async () => {
    const llmCall = mockLLM();
    const result = await runStarterCoach('essay', 0, llmCall, now);
    expect(result.status).toBe('NEEDS_FOLLOWUP');
    if (result.status === 'NEEDS_FOLLOWUP') {
      expect(result.prompt).toBe(FOLLOWUP_PROMPT);
      expect(result.roundsUsed).toBe(1);
    }
    expect(llmCall).not.toHaveBeenCalled();
  });

  it('恰好 8 字符：够格，直接 READY（边界值，不多不少）', async () => {
    const declaration = 'homework'; // 恰好 8 个字符
    expect(declaration.length).toBe(MIN_TASK_DECLARATION_LENGTH);
    const llmCall = mockLLM();
    const result = await runStarterCoach(declaration, 0, llmCall, now);
    expect(result.status).toBe('READY');
    expect(llmCall).toHaveBeenCalledTimes(1);
  });

  it('第二轮仍不够格（roundsUsed=1 < MAX_FOLLOWUP_ROUNDS=2）：继续追问，roundsUsed 变 2', async () => {
    const llmCall = mockLLM();
    const result = await runStarterCoach('study', 1, llmCall, now);
    expect(result.status).toBe('NEEDS_FOLLOWUP');
    if (result.status === 'NEEDS_FOLLOWUP') {
      expect(result.roundsUsed).toBe(2);
    }
    expect(llmCall).not.toHaveBeenCalled();
  });

  it('已追问满 2 轮（roundsUsed=2）：即使还是不够格也接受输入，不再卡住', async () => {
    const llmCall = mockLLM();
    const result = await runStarterCoach('study', MAX_FOLLOWUP_ROUNDS, llmCall, now);
    expect(result.status).toBe('READY');
    expect(llmCall).toHaveBeenCalledTimes(1);
    expect(llmCall).toHaveBeenCalledWith({ taskDeclaration: 'study' });
  });

  it('输入两边有空白：trim 后再判长度，不能被空格刷过 8 字符门槛', async () => {
    const llmCall = mockLLM();
    const result = await runStarterCoach('   essay   ', 0, llmCall, now);
    expect(result.status).toBe('NEEDS_FOLLOWUP');
    expect(llmCall).not.toHaveBeenCalled();
  });
});

describe('B6: runStarterCoach 产出（单次 LLM 调用 → firstAction + SessionContext）', () => {
  it('够格声明：LLM 只调用一次，返回的 firstAction 原样透传', async () => {
    const llmCall = mockLLM('Open VS Code and create login.tsx');
    const result = await runStarterCoach("Study for tomorrow's data structures exam", 0, llmCall, now);
    expect(result.status).toBe('READY');
    if (result.status === 'READY') {
      expect(result.firstAction).toBe('Open VS Code and create login.tsx');
    }
    expect(llmCall).toHaveBeenCalledTimes(1);
  });

  it('SessionContext.taskDeclaration 是校验通过的用户声明，不是 LLM 编的内容', async () => {
    const llmCall = mockLLM();
    const declaration = "Study for tomorrow's data structures exam";
    const result = await runStarterCoach(declaration, 0, llmCall, now);
    if (result.status === 'READY') {
      expect(result.sessionContext.taskDeclaration).toBe(declaration);
    }
  });

  it('SessionContext 其余字段沿用 defaultSessionContext 的兜底（阶段一 CREATOR 近似）', async () => {
    const llmCall = mockLLM();
    const result = await runStarterCoach("Study for tomorrow's data structures exam", 0, llmCall, now);
    if (result.status === 'READY') {
      expect(result.sessionContext.profile.archetype).toBe('CREATOR');
      expect(result.sessionContext.graceUntil).toBe(now + 120_000);
      expect(result.sessionContext.sessionWhitelist).toEqual([]);
    }
  });

  it('可以带入 A 侧推断出的锚点，原样写进 SessionContext.anchor', async () => {
    const llmCall = mockLLM();
    const inferredAnchor = { domain: 'vscode.dev', url: 'https://vscode.dev/proj' };
    const result = await runStarterCoach("Study for tomorrow's data structures exam", 0, llmCall, now, 'sess-1', inferredAnchor);
    if (result.status === 'READY') {
      expect(result.sessionContext.anchor).toEqual({ ...inferredAnchor, matchMode: 'exact' });
    }
  });

  it('追问满 2 轮后用户仍未说清楚（空输入）：taskDeclaration 保留默认文案，不写入空字符串', async () => {
    const llmCall = mockLLM();
    const result = await runStarterCoach('   ', MAX_FOLLOWUP_ROUNDS, llmCall, now);
    expect(result.status).toBe('READY');
    if (result.status === 'READY') {
      expect(result.sessionContext.taskDeclaration).toBe(DEFAULT_TASK_DECLARATION);
    }
    expect(llmCall).toHaveBeenCalledTimes(1); // 仍然只调用一次，不因为内容空就跳过
  });

  it('LLM 调用失败（网络/超时）：firstAction 兜底话术，不让起步教练直接挂掉（红线2同精神）', async () => {
    const llmCall: StarterCoachLLMCall = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await runStarterCoach("Study for tomorrow's data structures exam", 0, llmCall, now);
    expect(result.status).toBe('READY');
    if (result.status === 'READY') {
      expect(result.firstAction).toBe(FIRST_ACTION_FALLBACK);
      // SessionContext 该有的信息不受 LLM 失败影响，用户依然能正常开始
      expect(result.sessionContext.taskDeclaration).toBe("Study for tomorrow's data structures exam");
    }
  });
});

// 09-05：语义级"够不够具体"检查——真机复现，长度闸门放行了"调整并测试hackathon项目作品"
// 这种长度够但内容空洞的声明，contextRelevance 分类器全程只有这句话可比对，后面整场会话的
// 相关性判定都不准。
describe('B6: runStarterCoach 任务质量检查（09-05 新增，语义级"够不够具体"）', () => {
  it('不传 checkTaskQuality：行为跟这个功能上线前完全一样（默认永远判定够格）', async () => {
    const llmCall = mockLLM();
    const result = await runStarterCoach('adjust and test my hackathon project', 0, llmCall, now);
    expect(result.status).toBe('READY');
    expect(llmCall).toHaveBeenCalledTimes(1);
  });

  it('长度够但语义空洞：质量检查判 sufficient:false 时追问它给的针对性问题，不用通用 FOLLOWUP_PROMPT', async () => {
    const llmCall = mockLLM();
    const checkTaskQuality = mockQualityCheck({
      sufficient: false,
      followupQuestion: 'Which part of the project are you adjusting?',
    });
    const result = await runStarterCoach(
      'adjust and test my hackathon project',
      0,
      llmCall,
      now,
      undefined,
      undefined,
      undefined,
      undefined,
      checkTaskQuality
    );
    expect(result.status).toBe('NEEDS_FOLLOWUP');
    if (result.status === 'NEEDS_FOLLOWUP') {
      expect(result.prompt).toBe('Which part of the project are you adjusting?');
      expect(result.roundsUsed).toBe(1);
    }
    expect(checkTaskQuality).toHaveBeenCalledWith({ taskDeclaration: 'adjust and test my hackathon project' });
    expect(llmCall).not.toHaveBeenCalled(); // 还没到拆解那一步，不该多打一次 LLM
  });

  it('质量检查判 sufficient:true：正常放行到拆解，只多调用一次质量检查，不影响原有产出', async () => {
    const llmCall = mockLLM('Open auth.ts and reproduce the login bug');
    const checkTaskQuality = mockQualityCheck({ sufficient: true });
    const result = await runStarterCoach(
      'fix the login bug in auth.ts',
      0,
      llmCall,
      now,
      undefined,
      undefined,
      undefined,
      undefined,
      checkTaskQuality
    );
    expect(result.status).toBe('READY');
    if (result.status === 'READY') {
      expect(result.firstAction).toBe('Open auth.ts and reproduce the login bug');
    }
    expect(checkTaskQuality).toHaveBeenCalledTimes(1);
    expect(llmCall).toHaveBeenCalledTimes(1);
  });

  it('质量检查判 sufficient:false 但没给追问文案（解析失败/异常产出）：fail open，直接放行到拆解', async () => {
    const llmCall = mockLLM();
    const checkTaskQuality = mockQualityCheck({ sufficient: false }); // 没有 followupQuestion
    const result = await runStarterCoach(
      'adjust and test my hackathon project',
      0,
      llmCall,
      now,
      undefined,
      undefined,
      undefined,
      undefined,
      checkTaskQuality
    );
    expect(result.status).toBe('READY'); // 不能因为这道新增的检查本身产出不完整就把用户卡住
    expect(llmCall).toHaveBeenCalledTimes(1);
  });

  it('长度闸门先触发时不调用质量检查——两道闸门共用同一份 roundsUsed 预算，不重复消耗', async () => {
    const llmCall = mockLLM();
    const checkTaskQuality = mockQualityCheck({ sufficient: false, followupQuestion: 'irrelevant' });
    const result = await runStarterCoach('essay', 0, llmCall, now, undefined, undefined, undefined, undefined, checkTaskQuality);
    expect(result.status).toBe('NEEDS_FOLLOWUP');
    if (result.status === 'NEEDS_FOLLOWUP') {
      expect(result.prompt).toBe(FOLLOWUP_PROMPT); // 走的是长度闸门的通用文案，不是质量检查那句
    }
    expect(checkTaskQuality).not.toHaveBeenCalled();
  });

  it('已经追问满 2 轮（roundsUsed=MAX_FOLLOWUP_ROUNDS）：跳过质量检查，直接放行，不会无限问下去', async () => {
    const llmCall = mockLLM();
    const checkTaskQuality = mockQualityCheck({ sufficient: false, followupQuestion: 'irrelevant' });
    const result = await runStarterCoach(
      'adjust and test my hackathon project',
      MAX_FOLLOWUP_ROUNDS,
      llmCall,
      now,
      undefined,
      undefined,
      undefined,
      undefined,
      checkTaskQuality
    );
    expect(result.status).toBe('READY');
    expect(checkTaskQuality).not.toHaveBeenCalled();
    expect(llmCall).toHaveBeenCalledTimes(1);
  });
});