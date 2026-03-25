const { BaseProcessor } = require('../base');

/**
 * L2.5 多用途裂变处理器
 * 根据配置的用途方向，将源数据裂变成多条不同用途的数据
 *
 * 支持的用途：
 * - rag: RAG 知识库素材（知识点、案例、技巧）
 * - finetuning: 微调数据（多轮对话、问答对）
 * - content_creation: 内容创作素材（选题、大纲、素材片段）
 */
class L25FissionProcessor extends BaseProcessor {
    /**
     * @param {object} llmService - LLM 服务实例
     * @param {object} options - 选项配置
     * @param {string[]} options.purposes - 支持的用途列表 ['rag', 'finetuning', 'content_creation']
     */
    constructor(llmService, options = {}) {
        super();
        this.llmService = llmService;
        this.options = options;
    }

    getName() {
        return 'l25-fission';
    }

    async process(context) {
        const { cleanedText, sourceType, purposes: contextPurposes, fissionConfig, batchId, source } = context;

        if (!cleanedText) {
            throw new Error('没有可处理的文本内容');
        }

        // 优先使用上下文中的 purposes，否则使用构造函数中的配置
        const purposes = contextPurposes || this.options.purposes || ['rag', 'finetuning', 'content_creation'];

        // 调用 LLM 进行多用途裂变分析（传入裂变配置）
        const fissionResult = await this.llmService.analyzeForFission(cleanedText, {
            purposes,
            sourceType,
            fissionConfig // 传递裂变配置（每种用途的数量和要求）
        });

        // fissionResult.items 应该是一个数组，每个元素代表一条加工数据
        // 格式：{type, category, title, content, purposes, tags, ...}

        // 确保每条 item 都有 purposes 字段
        const enhancedItems = (fissionResult.items || []).map(item => ({
            ...item,
            // 如果 item 没有 purposes，使用配置的 purposes
            purposes: item.purposes || purposes,
            batchId,
            source: source || sourceType
        }));

        return {
            items: enhancedItems,
            fissionCount: enhancedItems.length || 1,
            fissionNote: `裂变 ${enhancedItems.length || 1} 条数据`,
            purposes // 传递 purposes 到下游
        };
    }

    isRequired() {
        return false; // 可选处理器
    }
}

/**
 * 简化的 LLM 服务（用于测试）
 * 实际使用时替换为真实的 LLM API 调用
 */
class MockLlmServiceForFission {
    /**
     * 分析文本并裂变出多条不同用途的数据
     * @param {string} text - 输入文本
     * @param {object} options - 选项
     * @param {string[]} options.purposes - 用途列表
     * @param {string} options.sourceType - 来源类型
     * @param {object} options.fissionConfig - 裂变配置 { rag: { count: 3, requirement: '...' }, ... }
     */
    async analyzeForFission(text, options = {}) {
        const { purposes = ['rag'], sourceType = 'unknown', fissionConfig = {} } = options;
        const items = [];

        // 遍历每种用途，根据配置生成对应数量的数据
        for (const purpose of purposes) {
            const config = fissionConfig[purpose] || {};
            const count = config.count || 1; // 默认生成 1 条
            const requirement = config.requirement || ''; // 用户要求说明

            // 检测裂变模式：只有明确要求"同一理念"或"不同场景"时才用场景裂变
            // 注意：包含"场景"但不包含"同一理念"的，仍然用原版（如"挖掘具体问题场景"）
            const useScenarioMode = requirement.includes('同一理念') ||
                                    (requirement.includes('场景') && requirement.includes('不同场景'));

            // 根据配置的数量生成多条数据
            for (let i = 0; i < count; i++) {
                if (purpose === 'rag') {
                    // 生成 RAG 知识点
                    items.push({
                        type: '知识卡片',
                        category: '职场',
                        title: `RAG 知识点示例 ${i + 1}${requirement ? ` - ${requirement.slice(0, 20)}` : ''}`,
                        content: text.slice(0, 200),
                        purposes: ['rag'],
                        tags: ['知识点', 'RAG'],
                        aiConfidenceScore: 0.85
                    });
                } else if (purpose === 'finetuning') {
                    // 根据模式选择不同的裂变方式
                    if (useScenarioMode) {
                        // === 场景裂变模式：同一理念，不同场景 ===
                        const scenarioData = this.generateScenarioVariation(text, i);
                        const questionFromScenario = this.extractQuestionFromScenario(scenarioData.scenario, scenarioData.principle);
                        const answerWithThinking = this.generateAnswerWithThinking(scenarioData, questionFromScenario);

                        items.push({
                            type: '多轮对话',
                            scenarioType: scenarioData.type,  // 保存场景类型（职场/社交/家庭/情感/自我/亲子）
                            category: '情商',
                            title: `微调对话示例 ${i + 1}${requirement ? ` - ${requirement.slice(0, 20)}` : ''}`,
                            content: scenarioData.scenario,
                            purposes: ['finetuning'],
                            conversation: [
                                {role: 'user', content: questionFromScenario},
                                {role: 'assistant', content: answerWithThinking}
                            ],
                            tags: ['对话', '微调', '场景裂变', scenarioData.type],
                            aiConfidenceScore: 0.85,
                            fissionNote: scenarioData.note,
                            originalStory: text,
                            appliedPrinciple: scenarioData.principle,
                            principleSource: scenarioData.principleSource  // 保存原理来源
                        });
                    } else {
                        // === 原版模式：从故事中挖掘具体问题 ===
                        const questionFromStory = this.extractQuestionFromStory(text, i);
                        const answerWithThinking = this.generateAnswerWithThinkingFromStory(text, questionFromStory);

                        items.push({
                            type: '多轮对话',
                            category: '情商',
                            title: `微调对话示例 ${i + 1}${requirement ? ` - ${requirement.slice(0, 20)}` : ''}`,
                            content: text,
                            purposes: ['finetuning'],
                            conversation: [
                                {role: 'user', content: questionFromStory.question},
                                {role: 'assistant', content: answerWithThinking}
                            ],
                            tags: ['对话', '微调', '故事场景'],
                            aiConfidenceScore: 0.85,
                            fissionNote: questionFromStory.note
                        });
                    }
                } else if (purpose === 'content_creation') {
                    // 生成内容创作素材
                    items.push({
                        type: '创作素材',
                        category: '通用',
                        title: `内容素材片段 ${i + 1}${requirement ? ` - ${requirement.slice(0, 20)}` : ''}`,
                        content: text.slice(0, 150),
                        purposes: ['content_creation'],
                        tags: ['素材', '创作'],
                        aiConfidenceScore: 0.75
                    });
                } else if (purpose === 'other') {
                    // 生成其他用途数据
                    items.push({
                        type: '其他素材',
                        category: '通用',
                        title: `其他素材 ${i + 1}${requirement ? ` - ${requirement.slice(0, 20)}` : ''}`,
                        content: text.slice(0, 180),
                        purposes: ['other'],
                        tags: ['其他'],
                        aiConfidenceScore: 0.7
                    });
                }
            }
        }

        return { items };
    }

    /**
     * 生成场景变体：同一原理，不同场景
     * @param {string} originalStory - 原始故事
     * @param {number} variantIndex - 变体索引
     * @returns {object} {scenario, principle, note, type}
     */
    generateScenarioVariation(originalStory, variantIndex) {
        // 从原始故事分析提取背后的原理道理启示
        const principles = this.extractPrinciplesFromStory(originalStory);

        // 场景类型索引：确保 6 次裂变覆盖 6 种不同场景
        const scenarioTypeIndex = variantIndex % 6;

        // 原理索引：循环使用提取的原理
        const principleIndex = variantIndex % principles.length;

        const principle = principles[principleIndex];

        // 定义 6 种情商领域的场景类型
        const scenarioTemplates = [
            {
                type: '职场',
                baseNote: '场景：职场工作分配'
            },
            {
                type: '社交',
                baseNote: '场景：社交人情请求'
            },
            {
                type: '家庭',
                baseNote: '场景：家庭压力应对'
            },
            {
                type: '情感',
                baseNote: '场景：情感关系矛盾'
            },
            {
                type: '自我',
                baseNote: '场景：自我内心冲突'
            },
            {
                type: '亲子',
                baseNote: '场景：亲子教育'
            }
        ];

        const template = scenarioTemplates[scenarioTypeIndex];

        // 根据原理和场景类型生成具体场景
        const scenarioData = this.generateScenarioFromPrinciple(principle, template.type, variantIndex);

        return {
            scenario: scenarioData.scenario,
            principle: principle,
            note: `${template.baseNote}；原理：${principle.name} - ${principle.description}`,
            type: template.type,
            principleSource: principle.fromStory
        };
    }

    /**
     * 根据原理生成具体场景
     * @param {object} principle - 从故事提取的原理
     * @param {string} scenarioType - 场景类型（职场/社交/家庭/情感/自我/亲子）
     * @param {number} variantIndex - 变体索引
     * @returns {object} {scenario}
     */
    generateScenarioFromPrinciple(principle, scenarioType, variantIndex) {
        // 根据原理名称和场景类型生成场景
        const scenarioGenerators = {
            '以退为进': this.generateYituiweijinScenario.bind(this),
            '间接沟通': this.generateIndirectScenario.bind(this),
            '制造紧急感': this.generateUrgencyScenario.bind(this)
        };

        const generator = scenarioGenerators[principle.name] || this.generateDefaultScenario.bind(this);
        return {
            scenario: generator(scenarioType, variantIndex)
        };
    }

    /**
     * 生成"以退为进"原理的场景
     */
    generateYituiweijinScenario(scenarioType, variantIndex) {
        const scenarios = {
            '职场': '领导在开会时突然说："小王啊，这个项目你负责一下吧，虽然不是你分内的工作，但你能力强。"你手头已经有好几个项目了，不想接但又不好直接拒绝。',
            '社交': '朋友打电话来说："我有个亲戚想在你们公司办事，你能不能帮忙走个后门？"你不想违反规定，但又不想伤了朋友感情。',
            '家庭': '过年回家，亲戚问："什么时候要孩子啊？你看你家 XX 都多大了。"你和伴侣暂时不打算要，但不想正面冲突。',
            '情感': '伴侣抱怨说："你最近都不怎么陪我，是不是不在乎我了？"但你最近确实工作很忙，不是故意冷落对方。',
            '自我': '内心很想去参加一个社交活动，但又害怕人多的场合，担心自己不会说话、格格不入。',
            '亲子': '孩子说："妈妈，我想学钢琴，班里小红也有在学！"但你担心孩子三分钟热度，又不想直接拒绝打击 TA 的积极性。'
        };
        return scenarios[scenarioType] || scenarios['社交'];
    }

    /**
     * 生成"间接沟通"原理的场景
     */
    generateIndirectScenario(scenarioType, variantIndex) {
        const scenarios = {
            '职场': '你想向领导提加薪，但直接开口怕被拒绝，又怕领导觉得你只看重钱。',
            '社交': '朋友借了你的钱一直没还，你想提醒但又不好意思直接开口要。',
            '家庭': '你希望父母来你们小家过年，但直接说怕伤了他们的心。',
            '情感': '你希望伴侣多关心你，但直接说又怕对方觉得你矫情。',
            '自我': '你想拒绝一个邀请，但直接说不想去又怕得罪人。',
            '亲子': '你希望孩子少玩手机，但直接说怕引起逆反心理。'
        };
        return scenarios[scenarioType] || scenarios['社交'];
    }

    /**
     * 生成"制造紧急感"原理的场景
     */
    generateUrgencyScenario(scenarioType, variantIndex) {
        const scenarios = {
            '职场': '你想争取一个项目机会，但直接争取怕显得太激进，不争取又怕错过。',
            '社交': '有个限时优惠活动，你想邀请朋友一起参加，但直接推荐怕对方觉得你在推销。',
            '家庭': '你想劝父母早点做体检，但直接说怕他们多想。',
            '情感': '你想和伴侣确定关系，但直接表白怕给对方压力。',
            '自我': '你想报名参加一个培训，但犹豫不决，怕错过又怕选错。',
            '亲子': '你想鼓励孩子参加一个比赛，但直接劝又怕给孩子压力。'
        };
        return scenarios[scenarioType] || scenarios['社交'];
    }

    /**
     * 生成默认场景
     */
    generateDefaultScenario(scenarioType, variantIndex) {
        const scenarios = {
            '职场': '工作中遇到一个不好直接处理的棘手问题。',
            '社交': '社交场合遇到一个不好直接拒绝的请求。',
            '家庭': '家庭中遇到一个不好直接表达的诉求。',
            '情感': '感情中遇到一个不好直接沟通的心结。',
            '自我': '内心中有一个不好直接面对的纠结。',
            '亲子': '教育孩子时遇到一个不好直接处理的情况。'
        };
        return scenarios[scenarioType] || scenarios['社交'];
    }

    /**
     * 从故事中分析提取背后的原理道理启示
     * @param {string} story - 原始故事
     * @returns {object[]} 从故事中提取的原理数组
     */
    extractPrinciplesFromStory(story) {
        // 分析故事内容，提取核心原理
        const extractedPrinciples = [];

        // 检测故事中的关键元素
        const hasSayNo = story.includes('不要') || story.includes('拒绝') || story.includes('推辞');
        const hasIndirectApproach = story.includes('喊') || story.includes('说') || story.includes('大声');
        const hasFaceSaving = story.includes('尴尬') || story.includes('面子') || story.includes('难堪');
        const hasUrgency = story.includes('急') || story.includes('忙') || story.includes('赶紧');
        const hasOtherPartyInitiative = story.includes('主动') || story.includes('塞给') || story.includes('追出来');

        // 基于故事内容提取原理
        if (hasSayNo && hasOtherPartyInitiative) {
            // 以退为进原理：表面说不要，激发对方主动给予
            extractedPrinciples.push({
                name: '以退为进',
                description: '表面上说"不要"或退让，实际激发对方主动给予的意愿',
                keySteps: ['表达退让姿态', '制造情境让对方主动', '达到目的同时保全双方面子'],
                fromStory: '主角说"我不要"，反而让长辈主动追出来塞回红包'
            });
        }

        if (hasIndirectApproach && hasFaceSaving) {
            // 间接沟通原理：不直接表达需求，用巧妙方式达到目的
            extractedPrinciples.push({
                name: '间接沟通',
                description: '不直接说出真实意图，而是通过巧妙的方式让对方理解和行动',
                keySteps: ['不直接说出口', '用话语制造情境', '让对方自己得出你想要的结论'],
                fromStory: '主角不直接说"我要红包"，而是喊"红包放桌上了"'
            });
        }

        if (hasUrgency && hasFaceSaving) {
            // 制造紧急感原理：让对方担心失去，从而主动行动
            extractedPrinciples.push({
                name: '制造紧急感',
                description: '通过暗示可能失去，激发对方立即行动的紧迫感',
                keySteps: ['暗示东西可能被拿走/失去', "让对方担心", '促使对方立即行动'],
                fromStory: '"放桌上了"暗示红包可能被拿走，让长辈着急'
            });
        }

        // 默认原理（如果故事分析失败）
        if (extractedPrinciples.length === 0) {
            extractedPrinciples.push({
                name: '以退为进',
                description: '表面上说"不要"或退让，实际激发对方主动给予的意愿',
                keySteps: ['表达退让姿态', '制造情境让对方主动', '达到目的同时保全双方面子'],
                fromStory: story.slice(0, 50) + '...'
            });
        }

        return extractedPrinciples;
    }

    /**
     * 从场景中提取问题
     * @param {string} scenario - 场景描述
     * @param {object} principle - 应用的理念
     * @returns {string} 问题
     */
    extractQuestionFromScenario(scenario, principle) {
        // 根据场景类型生成问题
        if (scenario.includes('领导') && scenario.includes('项目')) {
            return '领导突然给我加码安排工作，但我手头已经很忙了，怎么委婉拒绝才能让领导理解又不伤感情？';
        } else if (scenario.includes('朋友') && scenario.includes('走后门')) {
            return '朋友想让我帮忙走后门，但我不想违反规定，怎么拒绝才能不伤感情？';
        } else if (scenario.includes('亲戚') && scenario.includes('要孩子')) {
            return '过年回家被亲戚催生，但我和伴侣暂时不打算要，怎么回应才能不得罪人？';
        } else if (scenario.includes('伴侣') && scenario.includes('陪你')) {
            return '伴侣抱怨我最近冷落 TA，但我确实工作很忙，怎么解释才能让 TA 理解又不伤感情？';
        } else if (scenario.includes('内心') && scenario.includes('害怕')) {
            return '我内心想参加社交活动，但又害怕人多的场合，担心自己不会说话，该怎么调整心态？';
        } else if (scenario.includes('孩子') && scenario.includes('玩具')) {
            return '孩子吵着要买玩具，但我不想惯着 TA，又不想直接拒绝伤害孩子，该怎么处理？';
        }
        return '遇到这种不好直接拒绝的情况，怎么处理比较合适？';
    }

    /**
     * 生成包含思考过程和场景答案的回答
     * @param {object} scenarioData - 场景数据
     * @param {string} question - 问题
     * @returns {string} 包含<think>思考标签的完整回答
     */
    generateAnswerWithThinking(scenarioData, question) {
        const { scenario, principle, type } = scenarioData;

        // 思考分析部分
        const thinking = `分析用户的问题，这是一个"${type}"场景中典型的"不便直接拒绝"的社交困境。

核心难点：
1. 直接拒绝 → 可能得罪人、伤感情
2. 勉强答应 → 自己为难，可能后续更麻烦
3. 不回应 → 对方会觉得你不给面子

解决思路：
- 不能硬碰硬，需要用柔和的方式
- 保全对方的面子，同时表达自己的难处
- 最好能让对方主动理解或放弃

从原始故事中可以借鉴的理念：${principle.name} - ${principle.description}`;

        // 场景化的解决方案
        const solution = this.generateScenarioSolution(scenario, principle, type);

        // 组合完整回答
        return `<think>
${thinking}
</think>

${solution}

这个方法的精妙之处：
1. **不直接说"不"** - 避免正面冲突，给对方留面子
2. **表达自己的难处** - 让对方理解你的处境
3. **提供替代方案** - 显示你愿意帮忙的态度
4. **让对方主动退让** - 比直接拒绝效果好得多

这就是高情商：既坚持了自己的原则，又让双方都不尴尬。`;
    }

    /**
     * 生成包含思考过程和故事答案的回答（原版模式）
     * @param {string} story - 原始故事
     * @param {object} question - 问题对象
     * @returns {string} 包含<think>思考标签的完整回答
     */
    generateAnswerWithThinkingFromStory(story, question) {
        // 思考分析部分
        const thinking = `分析用户的问题，这是一个典型的"想要但不便直接开口"的社交困境。

核心难点：
1. 直接回去拿 → 显得贪财、不懂事
2. 不要了 → 自己损失，长辈可能也觉得你见外
3. 让对方送过来 → 更失礼

解决思路：
- 需要制造一个让对方"主动"给回红包的情境
- 保全双方的面子和感受
- 用巧妙的方式表达"我不要"，激发对方"非要给"的心理

从故事中可以提取的解法：在门口大喊"红包放桌上了，我不要"，让长辈着急追出来主动塞回红包。`;

        // 从故事中提取实际解决方案
        const solution = this.extractSolutionFromStory(story);

        // 组合完整回答
        return `<think>
${thinking}
</think>

${solution}

这个方法的精妙之处：
1. **表面说不要，实际激发对方给予意愿** - 人性使然，你越说不要，对方越要给
2. **制造紧急感** - "放桌上了"暗示可能被拿走，让对方着急
3. **远距离喊话** - 避免面对面尴尬，给对方反应时间
4. **双方都有台阶** - 你不是回去要，是"告知"；对方不是被索要，是"主动追出来给"

这就是高情商：既达到目的，又让双方都舒服。`;
    }

    /**
     * 从故事中提取实际解决方案
     * @param {string} story - 故事文本
     * @returns {string} 解决方案
     */
    extractSolutionFromStory(story) {
        // 提取故事中的关键行动
        if (story.includes('大喊') && story.includes('我不要')) {
            return `故事中的主角是这样做的：

**行动方案**：走到门口后，在门口大声喊："阿姨，红包放桌上了，我不要！"

**结果**：阿姨听后很着急，急忙拿起红包跑出来塞给了他，他也就顺势收下了。

**效果分析**：
- 主角没有直接回去说"我忘拿红包了"，而是用"告知 + 说不要"的方式
- 长辈听到后，担心红包被别人拿走，急忙追出来主动塞回
- 双方都不尴尬，红包也顺利收下`;
        }

        // 如果没有匹配到具体故事，返回通用解法
        return `故事中展示了一个巧妙的解法：不直接开口要，而是用一种让对方主动给的方式。具体做法需要结合故事细节，但核心思路是制造情境，让对方"自愿"行动。`;
    }

    /**
     * 为场景生成解决方案（基于动态提取的原理）
     * @param {string} scenario - 场景描述
     * @param {object} principle - 从故事提取的原理
     * @param {string} type - 场景类型（职场/社交/家庭/情感/自我/亲子）
     * @returns {string} 场景化的解决方案
     */
    generateScenarioSolution(scenario, principle, type) {
        // 根据原理名称调用对应的生成器
        const solutionGenerators = {
            '以退为进': this.generateYituiweijinSolution.bind(this),
            '间接沟通': this.generateIndirectSolution.bind(this),
            '制造紧急感': this.generateUrgencySolution.bind(this)
        };

        const generator = solutionGenerators[principle.name] || this.generateDefaultSolution.bind(this);
        return generator(scenario, principle, type);
    }

    /**
     * 生成"以退为进"原理的解决方案
     */
    generateYituiweijinSolution(scenario, principle, type) {
        const solutions = {
            '职场': `**解决方案**：

你可以这样说："领导，感谢您对我的信任。不过我手头目前有 A、B、C 三个项目都在关键阶段，担心接下这个项目会影响整体质量。您看是不是可以等我先把这几个项目收尾，或者您帮我优先级排一下？"

**效果分析**：
- 先肯定领导的信任，给对方留面子（退）
- 说明自己的实际困难，不是推脱（退）
- 把决定权交还给领导，让对方主动考虑（进）
- 提供替代方案，显示配合态度（进）

这正是红包故事中"说不要"的智慧：表面退让，实际激发对方主动。`,

            '社交': `**解决方案**：

你可以这样说："兄弟，你这个忙我真的很想帮。但这事儿确实超出我的能力范围了，我要是硬接下来，最后办不成反而伤感情。要不我帮你问问有没有更合适的人？"

**效果分析**：
- 表达想帮忙的意愿，给对方面子（退）
- 说自己能力不足，不是不想帮（退）
- 提供替代方案，显示诚意（进）

就像红包故事中主角说"我不要"，反而让对方主动给。`,

            '家庭': `**解决方案**：

你可以这样说："阿姨/叔叔，谢谢您关心！我们其实也在考虑这事儿，不过现在工作压力太大，想先把事业稳定一下，等有更好条件了再要，也是对孩子负责。您说是吧？"

**效果分析**：
- 先感谢关心，给对方面子（退）
- 说"也在考虑"，不是不要（退）
- 用"为孩子负责"这个对方无法反驳的理由（进）
- 最后反问"您说是吧"，让对方站到你这边（进）`,

            '情感': `**解决方案**：

你可以这样说："亲爱的，我知道最近陪你的时间少了，你肯定很失落。其实我也很想多陪你，只是最近项目确实太忙了。要不这样，这个周末我推掉所有安排，专门陪你一天好不好？"

**效果分析**：
- 先承认对方的感受，表示理解（退）
- 说明不是故意冷落，是客观原因（退）
- 提出具体的补偿方案，让对方看到用心（进）`,

            '自我': `**内心对话**：

"我确实不太擅长人多的场合，这没什么好羞愧的。但我可以先去待一小会儿，如果实在不舒服就早点离开，这样既给了自己机会，又不为难自己。"

**效果分析**：
- 接纳自己的不完美，不自我批判（退）
- 设定合理的期望，不是"必须表现得很好"（退）
- 给自己留退路，减少心理压力（进）
- 小步尝试，逐步突破（进）`,

            '亲子': `**解决方案**：

你可以这样说："宝宝，妈妈知道你很想要那个玩具，小明有你也很想要是不是？妈妈小时候也这样。不过玩具太多会玩不过来，咱们今天先看看，下次生日再买好不好？妈妈先给你记着。"

**效果分析**：
- 先共情，理解孩子的感受（退）
- 分享自己小时候的经历，拉近距离（退）
- 说明原因，不是"不行"而是"时候未到"（进）
- 给出期待和承诺，让孩子有盼头（进）`
        };

        return solutions[type] || solutions['社交'];
    }

    /**
     * 生成"间接沟通"原理的解决方案
     */
    generateIndirectSolution(scenario, principle, type) {
        const solutions = {
            '职场': `**解决方案**：

找个合适的时机，不经意地说："最近看到同行/同事 XX 加薪了，真替他高兴。我在咱们公司也工作这么久了，最近刚完成了 XX 项目，感觉收获挺大的。"

**效果分析**：
- 不直接说"我要加薪"，而是表达对别人的关注（间接）
- 暗示自己的贡献和资历（铺垫）
- 让领导自己得出"应该给他加薪"的结论（让对方主动）

就像红包故事中不直接说"我要红包"，而是喊"红包放桌上了"。`,

            '社交': `**解决方案**：

发个消息："今天整理账单看到之前的转账记录，才想起来时间过得真快啊。对了，最近怎么样？有空一起吃饭啊。"

**效果分析**：
- 不直接说"还钱"，而是提到"转账记录"（间接提醒）
- 转移到叙旧和吃饭，给对方台阶（缓和气氛）
- 让对方自己意识到该还钱了（让对方主动）`,

            '家庭': `**解决方案**：

跟父母说："爸妈，我岳父岳母/公公婆婆说想你们了，问你们过年要不要一起去他们那边聚聚？他们说已经准备好客房了。"

**效果分析**：
- 不直接说"来我们小家"，而是说"亲家想聚聚"（间接）
- 用对方无法拒绝的理由（亲情）
- 让对方自己提出去你们小家`,

            '情感': `**解决方案**：

跟伴侣说："我同事/朋友她男朋友最近给她准备了个小惊喜，她开心得不得了。我觉得这种被放在心上的感觉真好。"

**效果分析**：
- 不直接说"你要关心我"，而是说别人的故事（间接）
- 表达自己的感受和需求（但不直接要求）
- 让对方自己意识到应该怎么做`,

            '自我': `**内心对话**：

"我不想参加这个邀请，但直接说'不想去'怕得罪人。我可以这样说：'真不巧，那天我已经有安排了，下次有机会再聚！'这样说既表达了拒绝，又不伤人。"

**效果分析**：
- 不直接说"不想去"，而是说"有安排"（间接）
- 给对方留面子，也给自己留台阶
- 让对方理解而不是生气`,

            '亲子': `**解决方案**：

跟孩子说："宝贝，你知道吗？妈妈有个朋友的孩子，每天只玩半小时手机，剩下的时间用来画画/看书/运动，现在可厉害了。"

**效果分析**：
- 不直接说"少玩手机"，而是讲别人的故事（间接）
- 用榜样的力量引导孩子（让对方主动学习）
- 孩子自己会提出"我也要像他一样"`
        };

        return solutions[type] || solutions['社交'];
    }

    /**
     * 生成"制造紧急感"原理的解决方案
     */
    generateUrgencySolution(scenario, principle, type) {
        const solutions = {
            '职场': `**解决方案**：

跟领导说："领导，这次项目机会很难得，我听说其他部门也有人感兴趣。我觉得我在 XX 方面还是有些经验的，如果能负责这个项目，应该能做出不错的成绩。您考虑考虑我？"

**效果分析**：
- 暗示"其他人也感兴趣"，制造竞争感（紧急）
- 表达自己的优势和意愿（铺垫）
- 让领导担心失去你这个合适人选（促使主动决定）`,

            '社交': `**解决方案**：

跟朋友说："这个活动限时优惠，明天就截止了。我觉得挺适合你的，就想着赶紧告诉你一声。你要是有兴趣就抓紧报名，反正我是已经报了。"

**效果分析**：
- "明天就截止"制造时间紧迫感（紧急）
- "我已经报了"制造从众效应（你也该行动）
- 让对方担心错过机会（促使主动决定）`,

            '家庭': `**解决方案**：

跟父母说："爸妈，我有个同事的爸爸就是拖得太久没体检，结果查出来的时候已经晚了。现在医生都建议 50 岁以上每年体检一次，你们要不要也去看看？我帮你们预约？"

**效果分析**：
- 用同事的例子制造危机感（紧急）
- 引用医生建议增加权威性（可信）
- 主动提出帮忙预约（促使行动）`,

            '情感': `**解决方案**：

跟伴侣说："我们在一起这么久了，我一直没说过，但其实我心里很在意我们的关系能不能有个明确的方向。我不想一直这样不确定地走下去。"

**效果分析**：
- "一直很在意"表达重视（情感铺垫）
- "不想一直这样不确定"制造危机感（紧急）
- 让对方意识到再不行动可能失去你（促使主动）`,

            '自我': `**内心对话**：

"这个培训机会很难得，现在不报名下次不知道什么时候了。虽然有点贵，但投资自己总是值得的。再说了，再不学就怕被时代淘汰了。"

**效果分析**：
- "下次不知道什么时候"制造稀缺感（紧急）
- "怕被时代淘汰"制造危机感（紧迫）
- 促使自己立即行动`,

            '亲子': `**解决方案**：

跟孩子说："这个比赛报名下周就截止了，而且每个学校名额有限。妈妈觉得你挺有潜力的，要是错过了多可惜啊。要不要试试看？"

**效果分析**：
- "下周截止"制造时间紧迫感（紧急）
- "名额有限"制造稀缺感（错过就没了）
- "多可惜啊"激发孩子的损失厌恶（促使主动）`
        };

        return solutions[type] || solutions['社交'];
    }

    /**
     * 生成默认解决方案
     */
    generateDefaultSolution(scenario, principle, type) {
        return `**解决方案**：

借鉴这个故事的智慧，你可以用一种让对方主动理解的方式。具体来说：
1. 先肯定对方，给足面子
2. 说明自己的难处，让对方理解
3. 提供替代方案，显示诚意

这样既坚持了自己的原则，又不伤感情。`;
    }

    /**
     * 从故事中提取问题（原版模式）
     * @param {string} story - 原始故事
     * @param {number} variant - 变体索引
     * @returns {{question: string, note: string}} 问题对象
     */
    extractQuestionFromStory(story, variant = 0) {
        // 基于故事内容提取不同的困境问题
        const dilemmas = [
            {
                question: '红包不小心落在亲戚家桌上，走到门口才发现，想回去拿但又不好意思，该怎么办？',
                note: '困境：想要回红包但怕尴尬'
            },
            {
                question: '长辈给红包时推来推去很尴尬，怎么才能让长辈收下我的心意又不伤感情？',
                note: '困境：想让长辈收红包但对方推辞'
            },
            {
                question: '亲戚给了红包，但我已经工作了不好意思收，怎么拒绝才能让双方都不尴尬？',
                note: '困境：不想收红包但怕得罪长辈'
            }
        ];

        return dilemmas[variant % dilemmas.length];
    }
}

module.exports = { L25FissionProcessor, MockLlmServiceForFission };
