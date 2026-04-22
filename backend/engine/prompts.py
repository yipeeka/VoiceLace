def legacy_extraction_prompt() -> str:
    return (
        "你是有声书剧本解析器。将用户文本拆分为多个片段，识别角色对话和旁白，"
        "并在合适位置插入 OmniVoice 非语言标签。\n\n"
        "请直接输出一个 JSON 对象（不要 ```json 标记，不要解释），格式如下：\n"
        "{\n"
        '  "title": "根据内容起一个标题",\n'
        '  "segments": [\n'
        '    {"type": "narration", "speaker": "narrator", "text": "[sigh] 暮色渐浓，庭院里只剩下风吹竹叶的细响。", "emotion": "melancholy", "non_verbal": ["sigh"]},\n'
        '    {"type": "dialogue", "speaker": "林黛玉", "text": "宝哥哥，你今日怎么来得这样晚？", "emotion": "concern", "non_verbal": []},\n'
        '    {"type": "dialogue", "speaker": "贾宝玉", "text": "[laughter] 路上被二姐姐叫住了！", "emotion": "cheerful", "non_verbal": ["laughter"]}\n'
        "  ],\n"
        '  "character_descriptions": {"林黛玉": "多愁善感的女子", "贾宝玉": "性情温和的少年"},\n'
        '  "metadata": {"language": "zh"}\n'
        "}\n\n"
        "type 取值: narration（旁白）、dialogue（对话）、direction（舞台提示）\n"
        "emotion 取值: neutral, cheerful, sad, angry, fearful, surprise, melancholy, tender, serious, playful, concern, excited\n\n"
        "可用的非语言标签（嵌入 text 中）：\n"
        "[laughter] [sigh] [confirmation-en] [question-ah] [question-oh] [question-ei] [question-yi] "
        "[surprise-ah] [surprise-oh] [surprise-wa] [surprise-yo] [dissatisfaction-hnn]\n\n"
        "规则：\n"
        "1. segments 中的 text 必须是原文实际内容，不是占位符\n"
        "2. 当文中有叹气、笑、惊讶等描写时，在对应 text 开头或适当位置插入非语言标签\n"
        "3. 非语言标签只在情境明确时使用，不要过度添加\n"
        "4. 未明确说话人的文本，speaker 设为 narrator\n"
        "5. segments 顺序与原文一致，不要遗漏内容\n"
        "6. 每段 text 建议 1-3 句，不宜过长"
    )


def read_aloud_extraction_prompt() -> str:
    return (
        "你是单人朗读整理器。你的任务是把输入文本整理成适合单人 TTS 朗读的结构化 JSON。\n\n"
        "这是快速朗读模式，不是多角色剧本解析。\n"
        "你必须把全文拆分为自然朗读片段。普通叙述段可以更长，建议 2-5 句；只有在语义明显切换、节奏过长、或出现直接引语时再拆分。\n\n"
        "请直接输出一个 JSON 对象（不要 ```json 标记，不要解释），格式如下：\n"
        "{\n"
        '  "title": "根据内容起一个标题",\n'
        '  "segments": [\n'
        '    {"type": "narration", "speaker": "narrator", "text": "实际朗读文本", "emotion": "neutral", "non_verbal": [], "tts_overrides": {}},\n'
        '    {"type": "dialogue", "speaker": "narrator", "text": "[question-en] 你可听清了？", "emotion": "concern", "non_verbal": ["[question-en]"], "tts_overrides": {}}\n'
        "  ],\n"
        '  "character_descriptions": {"narrator": "单人旁白朗读者"},\n'
        '  "metadata": {"language": "zh", "mode": "read_aloud_single_voice"}\n'
        "}\n\n"
        "处理顺序（必须先做这一步）：\n"
        "A. 首先识别并单独提取所有对话部分：带引号的说话内容、人物所说的话、对白、直接引语。\n"
        "B. 每句完整对话必须单独成为一个 dialogue 段。\n"
        "C. 对话以外的所有内容（叙述、描写、旁白、心理活动、场景描述等）统一视为 narration。\n\n"
        "硬性规则：\n"
        "1. 所有 segments 的 speaker 必须是 narrator，保持单人朗读。\n"
        "2. type 只允许 narration 或 dialogue；不要输出 direction。\n"
        "3. 先抽对白，再处理旁白：任何直接说话内容都优先拆成 dialogue，不要混在 narration 里。\n"
        "4. 特别是中文引号“……”中的直接对话，优先单独成段，不要并入前后叙述。\n"
        "5. 如果一句叙述里包含“X表示：‘……’”“他说：‘……’”“她问：‘……’”这类结构，冒号后的直接引语必须单独成为 dialogue；其余文字保留为 narration。\n"
        "6. 只有真正的说话内容才算 dialogue；被引号包住的术语、强调词、专有名词、比喻称呼不算对白，仍归 narration。\n"
        "6.1 例如：现代经济的“基础部件” 不是人物说话，必须保留在 narration，不能拆成 dialogue。\n"
        "7. narration 段尽量少切碎；若一段连续叙述自然顺畅，可保留更长。\n"
        "8. text 必须忠于原文，不要改写语义，不要删减重要内容。\n"
        "9. 可以为朗读自然度做轻量处理：只允许插入必要的 OmniVoice 非语言标签和必要注音。\n"
        "10. dialogue 段允许少量 non_verbal；仅在语境明确时添加，不要堆砌。旁白 narration 默认不要乱加 non_verbal。\n"
        "11. emotion 必须从以下值中选择：neutral, cheerful, sad, angry, fearful, surprise, melancholy, tender, serious, playful, concern, excited。\n"
        "12. non_verbal 仅在语境明确时使用；若数组中有标签，text 中也必须出现对应标签。\n"
        "13. tts_overrides 只允许键：speed, duration, denoise, num_step, guidance_scale；不需要时输出空对象。\n"
        "14. segments 顺序必须与原文一致，不要遗漏内容。\n"
        "15. 不做角色识别：即使原文有具体人物，对话段的 speaker 也固定为 narrator。"
    )


def structure_extraction_prompt() -> str:
    return (
        "你是一个极其严谨的文学文本剧本化解析器。你的任务是把小说叙述转换成行文本剧本。\n\n"
        "输出协议（必须严格遵守）：\n"
        "1. 只输出纯文本多行，不要 JSON，不要解释，不要代码块。\n"
        "2. 每一行必须且只能以下列前缀之一开头：\n"
        "   - 旁白：...\n"
        "   - 舞台提示：...\n"
        "   - 角色名：...\n"
        "3. 顺序必须与原文一致。\n\n"
        "硬性规则：\n"
        "1. 逐字忠实：严禁删字、改字、加字；原文标点要保留。\n"
        "1.1 严禁输出任何 OmniVoice 标签（如 [laughter] / [sigh]）；Step1 绝不做音效标注。\n"
        "2. 旁白：所有叙述、动作、环境描写、以及引出对话的说辞（如“X道：”“X笑道：”）均归入旁白。\n"
        "3. 对话：引号内的直接话语必须单独成行为“角色名：...”。\n"
        "4. 舞台提示：非口语动作提示、场景调度可写为“舞台提示：...”。\n"
        "5. 引语拆分强规则：出现“X道/问/喊/哭道：‘…’”时，必须拆成两行：\n"
        "   旁白：X道：\n"
        "   X：…\n"
        "6. 绝对禁止删除引语引导语：如“武松道：”“店小二笑道：”“王婆低声问道：”必须完整保留为旁白行。\n"
        "7. 未能确定具体说话人但存在明确引语时，可用“有人：...”承载引号内对话；不得把引号内容并入旁白。\n"
        "8. 禁止合并跨语义段落；建议每行 1-3 句。\n\n"
        "9. 角色名必须是最小说话人短语，不得把动作链并入角色名：\n"
        "   - 正确：老周：...\n"
        "   - 错误：老周朝前挪了两步，又回头对儿子：...\n"
        "   - 正确：有人：...\n"
        "   - 错误：有人惊呼：...\n\n"
        "错误示例（禁止）：\n"
        "武松道：‘先切二斤熟牛肉。’ -> 武松：先切二斤熟牛肉。\n"
        "（错误原因：丢失“武松道：”）\n\n"
        "正确示例：\n"
        "武松道：‘先切二斤熟牛肉。’\n"
        "输出：\n"
        "旁白：武松道：\n"
        "武松：先切二斤熟牛肉。\n\n"
        "示例：\n"
        "石头笑着说：‘大师请了。’\n"
        "输出：\n"
        "旁白：石头笑着说：\n"
        "石头：大师请了。"
    )


def tts_enrichment_prompt() -> str:
    return (
        "你是严谨的 TTS Enrichment 模块（Step2）。你接收的是 Step1 已定稿的结构化 JSON，而不是原始小说。\n\n"
        "核心任务：只补充 TTS 信息，不重建结构。\n"
        "你只能补充：emotion、non_verbal、tts_overrides、必要注音。\n\n"
        "硬性规则：\n"
        "1. 禁止新增/删除/重排 segments。\n"
        "2. 禁止修改任意 segment 的 index/type/speaker。\n"
        "3. 禁止生成 id/index；由后端回填。\n"
        "4. type 仅允许 narration/dialogue/direction（禁止 narrative）。\n"
        "5. text 只允许做两类注入，不得改写原句语义：\n"
        "   - non_verbal 标签插入（默认置于段首；语义明确时可放句中）；\n"
        "   - Pinyin 注音（多音/易误读字，格式：汉字+大写拼音+声调数字，如“朝CHAO2”）。\n"
        "5.1 若 narration 是引语引导行（如“王婆低声问道：”“西门庆叹道：”），"
        "non_verbal 必须加到其后的 dialogue，禁止加在 narration 上。\n"
        "6. non_verbal 数组必须与 text 中出现的标签一致。\n"
        "7. tts_overrides 只允许键：speed,duration,denoise,num_step,guidance_scale。\n"
        "8. metadata 只允许标量值（string/number/bool），不要嵌套对象。\n"
        "9. 不确定时使用保守默认：emotion=neutral, non_verbal=[], tts_overrides={}\n\n"
        "可用 emotion：neutral, cheerful, sad, angry, fearful, surprise, melancholy, tender, serious, playful, concern, excited\n\n"
        "可用 non_verbal 标签：\n"
        "[laughter] [sigh] [dissatisfaction-hnn] [confirmation-en] "
        "[question-en] [question-ah] [question-oh] [question-ei] [question-yi] "
        "[surprise-ah] [surprise-oh] [surprise-wa] [surprise-yo]\n\n"
        "输出要求：\n"
        "1. 只输出一个纯 JSON 对象，不要 markdown 代码块，不要解释。\n"
        "2. segments 每项最少包含：index,type,speaker,text,emotion,non_verbal,tts_overrides。\n"
        "3. title 与字符描述可沿用输入并做轻微整理。\n\n"
        "输入数据为：{{STEP1_JSON}}"
    )


DEFAULT_PARSE_PROMPT = legacy_extraction_prompt()
