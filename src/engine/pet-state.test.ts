// B9 单测：陪伴 / 观察 / check-in 三态状态机
import { describe, it, expect } from 'vitest';
import {
  createPetStateMachine,
  advancePetState,
  MIN_OBSERVING_MS,
  type PetEvidenceSnapshot,
} from './pet-state';

const now = 1_000_000;

// 什么证据都没有、也不在休息期的干净快照
function noEvidence(overrides: Partial<PetEvidenceSnapshot> = {}): PetEvidenceSnapshot {
  return { driftSustainerSince: null, stuckSustainerSince: null, restUntil: -Infinity, ...overrides };
}

describe('B9: 初始态与 check-in', () => {
  it('初始是 companion，不是 observing（没有任何证据时不该演"在盯着你"）', () => {
    expect(createPetStateMachine().state).toBe('companion');
  });

  it('CHECK_IN_DRIFT → checkin', () => {
    const m = createPetStateMachine();
    expect(advancePetState(m, 'CHECK_IN_DRIFT', noEvidence(), now)).toBe('checkin');
  });

  it('CHECK_IN_STUCK → checkin', () => {
    const m = createPetStateMachine();
    expect(advancePetState(m, 'CHECK_IN_STUCK', noEvidence(), now)).toBe('checkin');
  });

  it('check-in 压过一切：即便在休息期、证据也还挂着，仍然是 checkin', () => {
    const m = createPetStateMachine();
    const evidence = noEvidence({ driftSustainerSince: now - 5_000, restUntil: now + 60_000 });
    expect(advancePetState(m, 'CHECK_IN_DRIFT', evidence, now)).toBe('checkin');
  });

  it('从 checkin 回到无证据状态 → 直接回 companion，不经过 observing', () => {
    const m = createPetStateMachine();
    advancePetState(m, 'CHECK_IN_DRIFT', noEvidence(), now);
    expect(advancePetState(m, 'DO_NOTHING', noEvidence(), now + 1_000)).toBe('companion');
  });
});

describe('B9: observing —— 证据开始累积但还没触发', () => {
  it('driftSustainer 起了计时 → observing', () => {
    const m = createPetStateMachine();
    const evidence = noEvidence({ driftSustainerSince: now - 5_000 });
    expect(advancePetState(m, 'DO_NOTHING', evidence, now)).toBe('observing');
  });

  it('stuckSustainer 起了计时 → 同样是 observing（两条通道都算"有迹象"）', () => {
    const m = createPetStateMachine();
    const evidence = noEvidence({ stuckSustainerSince: now - 5_000 });
    expect(advancePetState(m, 'DO_NOTHING', evidence, now)).toBe('observing');
  });

  it('两个持续器都是 null → companion（这是最常见的"安静工作"情况）', () => {
    const m = createPetStateMachine();
    expect(advancePetState(m, 'DO_NOTHING', noEvidence(), now)).toBe('companion');
  });
});

describe('B9: 休息期（用户主动点了"休息"）', () => {
  it('休息期内即使证据还挂着也演 companion，不演 observing', () => {
    const m = createPetStateMachine();
    const evidence = noEvidence({ driftSustainerSince: now - 5_000, restUntil: now + 60_000 });
    expect(advancePetState(m, 'DO_NOTHING', evidence, now)).toBe('companion');
  });

  it('休息期结束后，证据还在 → 恢复 observing', () => {
    const m = createPetStateMachine();
    const during = noEvidence({ driftSustainerSince: now - 5_000, restUntil: now + 1_000 });
    expect(advancePetState(m, 'DO_NOTHING', during, now)).toBe('companion');
    const after = noEvidence({ driftSustainerSince: now - 5_000, restUntil: now + 1_000 });
    expect(advancePetState(m, 'DO_NOTHING', after, now + 2_000)).toBe('observing');
  });
});

describe('B9: 迟滞（视觉防抖，MIN_OBSERVING_MS）', () => {
  it('证据刚消失、还在迟滞窗口内 → 保持 observing，不立刻缩回 companion', () => {
    const m = createPetStateMachine();
    advancePetState(m, 'DO_NOTHING', noEvidence({ driftSustainerSince: now - 5_000 }), now);
    expect(m.state).toBe('observing');
    // 证据没了，但只过了 5s（< 15s 迟滞窗口）
    expect(advancePetState(m, 'DO_NOTHING', noEvidence(), now + 5_000)).toBe('observing');
  });

  it('迟滞窗口过完 → 退回 companion', () => {
    const m = createPetStateMachine();
    advancePetState(m, 'DO_NOTHING', noEvidence({ driftSustainerSince: now - 5_000 }), now);
    expect(advancePetState(m, 'DO_NOTHING', noEvidence(), now + MIN_OBSERVING_MS + 1)).toBe('companion');
  });

  it('持续有证据时 observingSince 不被每帧刷新，否则永远退不回 companion', () => {
    const m = createPetStateMachine();
    advancePetState(m, 'DO_NOTHING', noEvidence({ driftSustainerSince: now }), now);
    const enteredAt = m.observingSince;
    // 再连着喂几帧仍然有证据
    advancePetState(m, 'DO_NOTHING', noEvidence({ driftSustainerSince: now }), now + 10_000);
    advancePetState(m, 'DO_NOTHING', noEvidence({ driftSustainerSince: now }), now + 20_000);
    expect(m.observingSince).toBe(enteredAt);
    // 此刻证据消失，距离最初进入 observing 已经超过迟滞窗口 → 应该能立刻退回
    expect(advancePetState(m, 'DO_NOTHING', noEvidence(), now + 20_001)).toBe('companion');
  });

  it('迟滞只保护 observing，不会让 companion 粘住不进 observing', () => {
    const m = createPetStateMachine();
    expect(advancePetState(m, 'DO_NOTHING', noEvidence(), now)).toBe('companion');
    expect(advancePetState(m, 'DO_NOTHING', noEvidence({ driftSustainerSince: now }), now + 1)).toBe('observing');
  });
});

describe('B9: DEMO_MODE 时间压缩（红线5：所有时间常数都要压）', () => {
  it('demo 模式下迟滞窗口按 120x 压缩，不会拖慢 4 秒触发的演示节奏', () => {
    const m = createPetStateMachine();
    advancePetState(m, 'DO_NOTHING', noEvidence({ driftSustainerSince: now }), now, true);
    // 真实值 15s → demo 下 125ms；过了 130ms 应该已经退回
    expect(advancePetState(m, 'DO_NOTHING', noEvidence(), now + 130, true)).toBe('companion');
  });

  it('同样的 130ms 在非 demo 模式下还远没到迟滞窗口，仍是 observing（对照组）', () => {
    const m = createPetStateMachine();
    advancePetState(m, 'DO_NOTHING', noEvidence({ driftSustainerSince: now }), now);
    expect(advancePetState(m, 'DO_NOTHING', noEvidence(), now + 130)).toBe('observing');
  });
});