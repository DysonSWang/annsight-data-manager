/**
 * 状态机测试脚本
 * 验证审核流程中的状态转换逻辑
 */

const {
    REVIEW_STATES,
    FLOW_STATES,
    ReviewStateMachine,
    ReviewProgressTracker
} = require('../src/services/reviewStateMachine');

console.log('========================================');
console.log('状态机测试');
console.log('========================================\n');

// 测试 1: 状态转换验证
console.log('测试 1: 状态转换验证');
console.log('----------------------------------------');

const transitions = [
    // 合法转换
    { from: REVIEW_STATES.PENDING, to: REVIEW_STATES.AI_REVIEWING, expected: true },
    { from: REVIEW_STATES.AI_REVIEWING, to: REVIEW_STATES.AI_APPROVED, expected: true },
    { from: REVIEW_STATES.AI_REVIEWING, to: REVIEW_STATES.AI_FAILED, expected: true },
    { from: REVIEW_STATES.AI_FAILED, to: REVIEW_STATES.AI_OPTIMIZING, expected: true },
    { from: REVIEW_STATES.AI_OPTIMIZING, to: REVIEW_STATES.AI_REVIEWING, expected: true },
    { from: REVIEW_STATES.AI_APPROVED, to: REVIEW_STATES.MANUAL_REVIEW_PENDING, expected: true },
    { from: REVIEW_STATES.MANUAL_REVIEW_PENDING, to: REVIEW_STATES.MANUAL_REVIEWING, expected: true },
    { from: REVIEW_STATES.MANUAL_REVIEWING, to: REVIEW_STATES.MANUALLY_APPROVED, expected: true },
    { from: REVIEW_STATES.MANUALLY_APPROVED, to: REVIEW_STATES.FINAL_APPROVED, expected: true },
    { from: REVIEW_STATES.MANUAL_REVIEWING, to: REVIEW_STATES.MANUALLY_REJECTED, expected: true },
    { from: REVIEW_STATES.MANUALLY_REJECTED, to: REVIEW_STATES.REJECTED, expected: true },

    // 非法转换
    { from: REVIEW_STATES.PENDING, to: REVIEW_STATES.FINAL_APPROVED, expected: false },
    { from: REVIEW_STATES.AI_REVIEWING, to: REVIEW_STATES.MANUAL_REVIEW_PENDING, expected: false },
    { from: REVIEW_STATES.FINAL_APPROVED, to: REVIEW_STATES.AI_REVIEWING, expected: false },
];

let passedTests = 0;
let totalTests = transitions.length;

for (const { from, to, expected } of transitions) {
    const result = ReviewStateMachine.canTransition(from, to);
    const passed = result.valid === expected;

    if (passed) {
        passedTests++;
        console.log(`✓ ${from} → ${to}: ${result.valid ? '允许' : '禁止'} (预期：${expected ? '允许' : '禁止'})`);
    } else {
        console.log(`✗ ${from} → ${to}: ${result.valid ? '允许' : '禁止'} (预期：${expected ? '允许' : '禁止'}) - ${result.error}`);
    }
}

console.log(`\n通过：${passedTests}/${totalTests}\n`);

// 测试 2: 流程状态转换验证
console.log('测试 2: 流程状态转换验证');
console.log('----------------------------------------');

const flowTransitions = [
    // 合法转换
    { from: FLOW_STATES.INITIAL, to: FLOW_STATES.AI_REVIEW_IN_PROGRESS, expected: true },
    { from: FLOW_STATES.AI_REVIEW_IN_PROGRESS, to: FLOW_STATES.AI_APPROVED_FLOW, expected: true },
    { from: FLOW_STATES.AI_REVIEW_IN_PROGRESS, to: FLOW_STATES.AI_FAILED_FLOW, expected: true },
    { from: FLOW_STATES.AI_FAILED_FLOW, to: FLOW_STATES.AI_OPTIMIZED, expected: true },
    { from: FLOW_STATES.AI_OPTIMIZED, to: FLOW_STATES.AI_REVIEW_IN_PROGRESS, expected: true },
    { from: FLOW_STATES.AI_APPROVED_FLOW, to: FLOW_STATES.MANUAL_REVIEW_IN_PROGRESS, expected: true },
    { from: FLOW_STATES.MANUAL_REVIEW_IN_PROGRESS, to: FLOW_STATES.MANUALLY_APPROVED_FLOW, expected: true },
    { from: FLOW_STATES.MANUALLY_APPROVED_FLOW, to: FLOW_STATES.COMPLETED, expected: true },
    { from: FLOW_STATES.MANUAL_REVIEW_IN_PROGRESS, to: FLOW_STATES.MANUALLY_REJECTED_FLOW, expected: true },
    { from: FLOW_STATES.MANUALLY_REJECTED_FLOW, to: FLOW_STATES.AI_OPTIMIZED, expected: true },

    // 非法转换
    { from: FLOW_STATES.INITIAL, to: FLOW_STATES.COMPLETED, expected: false },
    { from: FLOW_STATES.COMPLETED, to: FLOW_STATES.AI_REVIEW_IN_PROGRESS, expected: false },
];

let passedFlowTests = 0;
let totalFlowTests = flowTransitions.length;

for (const { from, to, expected } of flowTransitions) {
    const result = ReviewStateMachine.canTransitionFlow(from, to);
    const passed = result.valid === expected;

    if (passed) {
        passedFlowTests++;
        console.log(`✓ ${from} → ${to}: ${result.valid ? '允许' : '禁止'} (预期：${expected ? '允许' : '禁止'})`);
    } else {
        console.log(`✗ ${from} → ${to}: ${result.valid ? '允许' : '禁止'} (预期：${expected ? '允许' : '禁止'}) - ${result.error}`);
    }
}

console.log(`\n通过：${passedFlowTests}/${totalFlowTests}\n`);

// 测试 3: 终止状态检测
console.log('测试 3: 终止状态检测');
console.log('----------------------------------------');

const terminalStates = [
    { state: REVIEW_STATES.FINAL_APPROVED, expected: true },
    { state: REVIEW_STATES.REJECTED, expected: true },
    { state: REVIEW_STATES.PENDING, expected: false },
    { state: REVIEW_STATES.AI_REVIEWING, expected: false },
    { state: REVIEW_STATES.AI_APPROVED, expected: false },
    { state: REVIEW_STATES.MANUAL_REVIEW_PENDING, expected: false },
];

for (const { state, expected } of terminalStates) {
    const result = ReviewStateMachine.isTerminalState(state);
    console.log(`${state}: ${result ? '终止状态' : '非终止状态'} ${result === expected ? '✓' : '✗'}`);
}

console.log('');

// 测试 4: 状态标签
console.log('测试 4: 状态标签（中文名称）');
console.log('----------------------------------------');

for (const [state, label] of Object.entries(REVIEW_STATES)) {
    console.log(`${state}: ${ReviewStateMachine.getStateLabel(label)}`);
}

console.log('');

// 测试 5: 获取下一个状态
console.log('测试 5: 获取允许的下一个状态');
console.log('----------------------------------------');

console.log(`PENDING 可以到：${ReviewStateMachine.getNextStates(REVIEW_STATES.PENDING).join(', ') || '无'}`);
console.log(`AI_REVIEWING 可以到：${ReviewStateMachine.getNextStates(REVIEW_STATES.AI_REVIEWING).join(', ') || '无'}`);
console.log(`AI_FAILED 可以到：${ReviewStateMachine.getNextStates(REVIEW_STATES.AI_FAILED).join(', ') || '无'}`);
console.log(`FINAL_APPROVED 可以到：${ReviewStateMachine.getNextStates(REVIEW_STATES.FINAL_APPROVED).join(', ') || '无 (终止状态)'}`);

console.log('\n========================================');
console.log(`测试完成：通过 ${passedTests + passedFlowTests}/${totalTests + totalFlowTests} 项`);
console.log('========================================');
