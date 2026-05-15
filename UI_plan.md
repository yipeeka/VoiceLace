# VoiceLace 前端 UI 改进计划

> 参考项目: [jamiepine/voicebox](https://github.com/jamiepine/voicebox) (14.8k ⭐)
> 当前技术栈: Vite 7 + React 19 + Zustand 5 + Vanilla CSS + Lucide Icons + WaveSurfer.js

---

## 一、VoiceBox 设计分析 → VoiceLace 映射

### VoiceBox 关键 UI 特征

| VoiceBox 特征 | 实现方式 | VoiceLace 映射 |
|---|---|---|
| **深色主题 + 精致分层** | Tailwind 4 + CSS 变量，`bg-zinc-950` → `bg-zinc-900` → `bg-zinc-800` 三层深度 | 当前 `variables.css` 只有 1 层 `--glass-bg`，需要扩展为 3 层深度系统 |
| **Voice Profile Cards** | 圆形头像/波形缩略图 + 语言标签 + 引擎标签 + 操作菜单 | 改造 `VoicePresetCardList` 为网格卡片，增加角色头像色块 + 模式标签 |
| **生成队列 + 版本历史** | 每次生成保留 original/effects/takes 版本链，SSE 实时推送 | 当前 `segmentResults` 只存最终结果，需增加版本追踪 |
| **WaveSurfer 波形** | 用于录音、预览、时间线 | 已有 `AudioPlayer.jsx`，但仅用于播放，需扩展到录音可视化 |
| **拖拽排序** | `@dnd-kit/core` + `@dnd-kit/sortable` | 当前剧本片段无排序功能，需添加 |
| **Radix UI 原语** | Dialog, Select, Slider, Progress, Tabs, Toast, Popover | 当前全用原生 HTML 控件（`<select>`, `<input type="checkbox">`），极其简陋 |
| **framer-motion 动画** | 页面转场、列表动画、hover 效果 | 当前零动画 |
| **底部状态栏** | 模型状态、GPU 内存、生成队列 | 当前 `Header.jsx` 只有静态文字 |
| **可折叠侧边栏** | icon-only 模式，保留 tooltip | 当前侧边栏固定 280px，不可收缩 |
| **录音功能** | 内置麦克风录音 + 系统音频捕获 + Whisper 转写 | 当前只有文件上传，无录音 UI |

---

## 二、改进方案

### Phase 1: 设计系统重构 (Foundation)

> 不改变任何业务逻辑，纯视觉层升级。

#### 1.1 安装新依赖

```bash
npm install @radix-ui/react-dialog @radix-ui/react-select @radix-ui/react-slider \
  @radix-ui/react-progress @radix-ui/react-tabs @radix-ui/react-toast \
  @radix-ui/react-popover @radix-ui/react-separator @radix-ui/react-scroll-area \
  @radix-ui/react-tooltip @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities \
  framer-motion clsx
```

#### 1.2 字体系统

```css
/* index.css — 新增 Google Fonts 引入 */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&family=Noto+Sans+SC:wght@400;500;700&display=swap');
```

| 用途 | 字体 | 理由 |
|---|---|---|
| 英文 UI | Inter | VoiceBox 同款，现代 SaaS 标准 |
| 中文 UI | Noto Sans SC | 与 Inter 搭配最佳的中文字体 |
| 代码/JSON | JetBrains Mono | 用于 LLM 输出 & 剧本 JSON 预览 |

#### 1.3 色彩系统重构

从 VoiceBox 的 zinc 深色系汲取灵感，但保留 VoiceLace 独有的暖色调个性：

```css
/* styles/variables.css — 完全重写 */
:root {
  /* ── 背景层级 (从 VoiceBox zinc 系统适配) ── */
  --bg-base: #09090b;              /* 最深层: 全局背景 */
  --bg-surface: #18181b;           /* 中间层: 卡片、面板 */
  --bg-elevated: #27272a;          /* 浮层: hover、弹窗 */
  --bg-soft: rgba(255, 255, 255, 0.04);  /* 输入框、代码块 */
  --bg-glass: rgba(24, 24, 27, 0.75);   /* 玻璃态 */

  /* ── 边框 ── */
  --border-default: rgba(255, 255, 255, 0.08);
  --border-subtle: rgba(255, 255, 255, 0.05);
  --border-accent: rgba(255, 179, 71, 0.5);
  --border-focus: rgba(124, 231, 255, 0.6);

  /* ── 文字 ── */
  --text-primary: #fafafa;
  --text-secondary: #a1a1aa;
  --text-muted: #71717a;

  /* ── 品牌色 (BeautyVoice 暖色个性) ── */
  --accent-primary: #ffb347;        /* 主操作 */
  --accent-primary-hover: #ffa726;
  --accent-secondary: #7ce7ff;      /* 辅助操作 */
  --accent-gradient: linear-gradient(135deg, #ffb347, #ff6b6b);

  /* ── 语义色 ── */
  --success: #4ade80;
  --warning: #fbbf24;
  --danger: #f87171;
  --info: #60a5fa;

  /* ── 角色色板 (用于剧本编辑器的角色色标) ── */
  --char-1: #818cf8;   /* 靛蓝 */
  --char-2: #fb923c;   /* 橙色 */
  --char-3: #34d399;   /* 翡翠 */
  --char-4: #f472b6;   /* 粉色 */
  --char-5: #a78bfa;   /* 紫色 */
  --char-6: #fbbf24;   /* 琥珀 */
  --char-7: #22d3ee;   /* 青色 */
  --char-8: #e879f9;   /* 品红 */
  --char-narrator: #94a3b8; /* 旁白灰色 */

  /* ── 圆角 ── */
  --radius-xs: 6px;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 20px;
  --radius-full: 9999px;

  /* ── 阴影 ── */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.3);
  --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.4);
  --shadow-glow: 0 0 0 1px rgba(255, 179, 71, 0.3), 0 0 20px rgba(255, 179, 71, 0.1);

  /* ── 动画 ── */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 400ms;

  /* ── 间距 ── */
  --sidebar-width: 260px;
  --sidebar-width-collapsed: 64px;
  --header-height: 56px;
  --statusbar-height: 36px;
}
```

#### 1.4 文件变更清单

| 操作 | 文件 | 说明 |
|---|---|---|
| **重写** | `src/styles/variables.css` | 上述完整设计 token |
| **重写** | `src/index.css` | 基于新 token 重构全局样式，移除所有散落的组件样式|
| **新建** | `src/styles/animations.css` | framer-motion 配合的 CSS 关键帧 |
| **新建** | `src/styles/components.css` | 所有组件级样式提取至此 (buttons, inputs, cards...) |
| **新建** | `src/utils/cn.js` | `clsx` 封装，替代手动字符串拼接 |

---

### Phase 2: 布局 & 导航重构

#### 2.1 可折叠侧边栏 (参考 VoiceBox)

```
┌──────────────────────────────────────────────────────────────┐
│ [≡]  BeautyVoice                                            │
│ ┌──────┐ ┌──────────────────────────────────────────────────┐│
│ │ 📝   │ │                                                  ││
│ │ Text │ │              Main Content Area                   ││
│ │      │ │                                                  ││
│ │ ──── │ │                                                  ││
│ │ 📜   │ │                                                  ││
│ │Script│ │                                                  ││
│ │      │ │                                                  ││
│ │ ──── │ │                                                  ││
│ │ 🎤   │ │                                                  ││
│ │Voice │ │                                                  ││
│ │      │ │                                                  ││
│ │ ──── │ │                                                  ││
│ │ 🔊   │ │                                                  ││
│ │Synth │ │                                                  ││
│ │      │ │                                                  ││
│ │ ──── │ │                                                  ││
│ │ ⚙️   │ │                                                  ││
│ │Settin│ │                                                  ││
│ └──────┘ └──────────────────────────────────────────────────┘│
│ ┌──────────── Status Bar (GPU / Model / Queue) ─────────────┐│
│ │ 🟢 LLM: Idle  │  🔵 TTS: Ready  │  VRAM 4.2/8.0 GB  │  ││
│ └────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

**关键改进:**
- 侧边栏可通过 `≡` 按钮在展开(260px) / 折叠(64px) 间切换
- 折叠模式下只显示图标 + Radix Tooltip
- 增加 **工作流步骤指示器** (Step 1→2→3→4 的竖向进度)
- 底部新增 **系统状态栏**: 实时显示 LLM/TTS 模型状态、VRAM 占用、合成队列

#### 2.2 文件变更清单

| 操作 | 文件 | 说明 |
|---|---|---|
| **重写** | `src/components/layout/Sidebar.jsx` | 可折叠逻辑 + 步骤指示器 + 设置入口 |
| **重写** | `src/components/layout/Header.jsx` | 移除 (功能合并到 Sidebar brand + StatusBar) |
| **新建** | `src/components/layout/StatusBar.jsx` | GPU 状态 + 模型状态 + 合成队列指示器 |
| **新建** | `src/components/layout/SettingsPanel.jsx` | 模型路径配置 + 串行模式开关 + 模型手动加卸载 |
| **重写** | `src/App.jsx` | 新布局结构 + 折叠状态管理 |
| **充实** | `src/stores/useSettingsStore.js` | 添加 `refreshSystemStatus`, `manualLoadLLM/TTS` 等 |

---

### Phase 3: 核心页面重构

#### 3.1 文本输入页 (`TextInputPage`)

**借鉴 VoiceBox 的 "生成输入区":**

```
┌─────────────────────────────────────────────────────────────┐
│  文本输入                                                     │
│  ┌─────────────────────────────────┐  ┌─────────────────────┐│
│  │ 项目: [默认项目 ▼] [+ 新建]      │  │ 模型状态 [⚙️]       ││
│  └─────────────────────────────────┘  └─────────────────────┘│
│                                                               │
│  ┌───── 文本编辑器 ──────────────────────────────────────────┐│
│  │                                                           ││
│  │  拖拽文件到此处，或粘贴文本内容...                            ││
│  │                                                           ││
│  │  (支持 .txt/.md/.srt 文件)                                ││
│  │                                                           ││
│  │                           字数统计: 0 │ 预估片段: ~0       ││
│  └───────────────────────────────────────────────────────────┘│
│                                                               │
│  ┌── 提示词 (可选) ─────────────────── [折叠/展开 ▾] ────────┐│
│  │ 默认使用系统提示词                                         ││
│  └───────────────────────────────────────────────────────────┘│
│                                                               │
│  [▶ 开始解析]  [填充示例]                                      │
│                                                               │
│  ┌── LLM 实时输出 ──────────────── streaming... ─────────────┐│
│  │  [系统] 正在卸载 TTS 模型...                               ││
│  │  [系统] 正在加载 LLM: Qwen2.5-7B...                       ││
│  │  [系统] LLM 就绪，开始推理                                 ││
│  │  {"title": "红楼梦·第三回",                                ││
│  │   "segments": [                                            ││
│  │     {"type": "narration", ...}                             ││
│  │  ■ (光标闪烁)                                              ││
│  └───────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

**改进点:**
1. **拖拽上传**: 支持将 `.txt` / `.md` 文件直接拖入编辑器
2. **字数统计**: 实时统计字符数、预估片段数
3. **提示词折叠**: 默认折叠，减少视觉噪音
4. **WebSocket 流式输出**: 模型加卸载过程可视化 + LLM token 逐字输出 (打字机效果)
5. **模型生命周期覆盖层**: 当模型正在切换时，显示半透明覆盖层 + spinner

#### 3.2 剧本编辑器 (`ScriptEditorPage`)

**借鉴 VoiceBox 的 Stories Editor 时间线概念:**

```
┌────────────────────────────────────────────────────────────────┐
│  剧本编辑  ·  42 段  ·  6 角色                     [导入][导出]│
│                                                                │
│  ┌─ 角色面板 ──┐  ┌─ 时间线视图 ────────────────────────────┐  │
│  │ ● 旁白      │  │                                        │  │
│  │ ● 贾宝玉    │  │  #001 ▮ 旁白 ▮ 暮色渐浓，庭院里...     │  │
│  │ ● 林黛玉    │  │  ┌ neutral ┐                           │  │
│  │ ● 王熙凤    │  │                                        │  │
│  │             │  │  #002 ▮ 林黛玉 ▮ 宝哥哥，你今日...     │  │
│  │ [+ 添加]    │  │  ┌ gentle ┐ ┌ sigh ┐                  │  │
│  │             │  │                                        │  │
│  │ ──── 统计 ──│  │  #003 ▮ 贾宝玉 ▮ 路上被二姐姐...      │  │
│  │ 对话: 28段  │  │  ┌ apologetic ┐                        │  │
│  │ 旁白: 14段  │  │                                        │  │
│  └─────────────┘  │  #004 ▮ 旁白 ▮ 黛玉低头轻笑...         │  │
│                    │  ┌ descriptive ┐                       │  │
│                    │  ═══════════════ (拖拽排序 handle) ═══ │  │
│                    └────────────────────────────────────────┘  │
│                                                                │
│  ┌─── 片段编辑 (点击展开) ─────────────────────────────────┐   │
│  │ 角色: [林黛玉 ▼]  类型: [dialogue ▼]                    │   │
│  │ 文本: [宝哥哥，你今日怎么来得这样晚？                 ]   │   │
│  │ 情感: [gentle ▼]  标签: [+sigh] [+添加]                │   │
│  │                                    [取消]  [💾 保存]     │   │
│  └─────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
```

**改进点:**
1. **左侧角色面板**: 显示所有角色列表 + 对应色标 + 出场统计
2. **色标系统**: 每个角色自动分配 `--char-1` ~ `--char-8` 颜色，片段卡片左侧有色条
3. **拖拽排序**: 使用 `@dnd-kit/sortable` 实现片段拖拽重排
4. **内联编辑**: 点击片段展开编辑面板 (VoiceBox 风格的 inline 编辑)
5. **标签选择器**: 情感和非语言标签使用 Popover + 可搜索列表
6. **批量操作**: 选中多个片段后可批量删除 / 批量修改角色

#### 3.3 声音配置页 (`VoiceConfigPage`)

**借鉴 VoiceBox 的 Voice Profile 管理:**

```
┌───────────────────────────────────────────────────────────────┐
│  声音配置                                                     │
│                                                               │
│  ┌───── 声音预设 ─────────────────────────────────────────────┐│
│  │                                                           ││
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ││
│  │  │  ♀       │  │  ♂       │  │  ♀       │  │  ＋       │  ││
│  │  │  温柔女声  │  │  少年音   │  │  泼辣女声  │  │  新建预设  │  ││
│  │  │  design  │  │  clone   │  │  design  │  │          │  ││
│  │  │  [试听]  │  │  [试听]  │  │  [试听]  │  │          │  ││
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  ││
│  │                                                           ││
│  └───────────────────────────────────────────────────────────┘│
│                                                               │
│  ┌───── 预设详情 (选中后展开) ────────────────────────────────┐│
│  │  名称: [温柔女声]              模式: [design | clone | auto]│
│  │                                                           ││
│  │  ╭─── design ─────────────────────────────────────────╮   ││
│  │  │ 性别: [Female ▼]     年龄: [Young ▼]              │   ││
│  │  │ 音调: [High ▼]       风格: [Gentle ▼]             │   ││
│  │  │ 自定义: [说话温柔，略带忧伤的年轻女性]               │   ││
│  │  │ 速度: ──────●────── 1.0x                           │   ││
│  │  ╰────────────────────────────────────────────────────╯   ││
│  │                                                           ││
│  │  ╭─── clone (切换 tab 后) ────────────────────────────╮   ││
│  │  │ 参考音频: [拖拽上传] 或 [🎤 录音] 或 [选择文件]      │   ││
│  │  │ ▶ ═══════●══════ 0:03/0:08  [ASR 转写]            │   ││
│  │  │ 转写文本: [这是参考音频的转写文本...]                 │   ││
│  │  ╰────────────────────────────────────────────────────╯   ││
│  │                                                           ││
│  │  试听文本: [这是试听文本，用于确认声音风格。]               ││
│  │  [▶ 试听预览]                                              ││
│  │  ▶ ═══════════════════════════════ 0:03/0:05              ││
│  └───────────────────────────────────────────────────────────┘│
│                                                               │
│  ┌───── 角色分配 ────────────────────────────────────────────┐│
│  │  旁白      →  [温柔女声 ▼]                               ││
│  │  贾宝玉    →  [少年音 ▼]                                  ││
│  │  林黛玉    →  [未分配 ▼]                                  ││
│  │                                    [保存角色分配]          ││
│  └───────────────────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────────┘
```

**改进点:**
1. **网格卡片布局**: 预设以 VoiceBox 风格的卡片网格展示，而非列表
2. **Radix Tabs**: clone / design / auto 三种模式使用 Tab 切换 (替代简陋的 `<select>`)
3. **Radix Slider**: 速度控制使用可视化滑块
4. **Radix Select**: 性别/年龄/音调等属性使用精美的下拉选择器
5. **录音功能**: 新增麦克风录音 (MediaRecorder API) + 波形可视化
6. **试听内联**: 试听音频直接在预设详情面板中播放 (AudioPlayer 组件)

#### 3.4 合成导出页 (`SynthesisPage`)

**借鉴 VoiceBox 的 Generation Queue + Stories Timeline:**

```
┌───────────────────────────────────────────────────────────────┐
│  语音合成                                                     │
│                                                               │
│  ┌── 合成参数 ─────────────────────────────────────┐ ┌──────┐│
│  │ 推理步数 ────●──── 32    CFG ────●──── 2.0      │ │ 状态 ││
│  │ 段间静音 ────●──── 500ms 格式: [WAV ▼]          │ │ 🟢   ││
│  │ ☑ 降噪                                         │ │ TTS  ││
│  │ [▶ 开始合成]  [⏹ 停止]       23/42 段 (55%)     │ │ Ready││
│  └─────────────────────────────────────────────────┘ └──────┘│
│                                                               │
│  ┌── 分段进度时间线 ─────────────────────────────────────────┐│
│  │  #001 ▮旁白▮     ████████████████████████████ ✅  ▶ 0:05  ││
│  │  #002 ▮贾宝玉▮   ████████████████████████████ ✅  ▶ 0:04  ││
│  │  #003 ▮林黛玉▮   ████████████████░░░░░░░░░░░░ ⏳       ││
│  │  #004 ▮旁白▮     ░░░░░░░░░░░░░░░░░░░░░░░░░░░ ⬜       ││
│  │  #005 ▮王熙凤▮   ░░░░░░░░░░░░░░░░░░░░░░░░░░░ ⬜       ││
│  └───────────────────────────────────────────────────────────┘│
│                                                               │
│  ┌── 完整音频预览 ───────────────────────────────────────────┐│
│  │ ▶ ═══════════●════════════════════════ 02:34 / 08:20      ││
│  │ [波形可视化 — WaveSurfer.js]                              ││
│  │                                                           ││
│  │ [📥 导出完整音频]  [📥 分段导出 (ZIP)]                      ││
│  └───────────────────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────────┘
```

**改进点:**
1. **Radix Progress**: 合成进度使用 Radix Progress 组件 + 角色色标
2. **Radix Slider**: 合成参数 (num_step, guidance_scale, gap) 全部用滑块
3. **分段时间线**: 每段显示角色色标 + 进度条 + 状态图标 + 内联播放
4. **WaveSurfer 时间线**: 完整音频使用 WaveSurfer 显示波形，可视化各段分界
5. **取消/暂停**: 实现合成取消/暂停功能 (后端已支持)

---

### Phase 4: 共享组件 & 交互打磨

#### 4.1 新建组件清单

| 组件 | 路径 | 说明 |
|---|---|---|
| `Button` | `src/components/ui/Button.jsx` | variant: primary / ghost / danger / outline, size: sm / md / lg |
| `IconButton` | `src/components/ui/IconButton.jsx` | 圆形图标按钮，tooltip 支持 |
| `Select` | `src/components/ui/Select.jsx` | Radix Select 封装, 支持搜索 |
| `Slider` | `src/components/ui/Slider.jsx` | Radix Slider 封装, 显示数值 |
| `Progress` | `src/components/ui/Progress.jsx` | Radix Progress 封装, 支持色彩 |
| `Tabs` | `src/components/ui/Tabs.jsx` | Radix Tabs 封装 |
| `Dialog` | `src/components/ui/Dialog.jsx` | Radix Dialog 封装, 支持确认/取消 |
| `Popover` | `src/components/ui/Popover.jsx` | Radix Popover 封装 |
| `Tooltip` | `src/components/ui/Tooltip.jsx` | Radix Tooltip 封装 |
| `ScrollArea` | `src/components/ui/ScrollArea.jsx` | Radix ScrollArea 封装 |
| `CharacterBadge` | `src/components/shared/CharacterBadge.jsx` | 角色色标 badge |
| `EmptyState` | `src/components/shared/EmptyState.jsx` | 空状态占位图 + CTA |
| `FileDropZone` | `src/components/shared/FileDropZone.jsx` | 拖拽上传区域 |
| `ModelStatusChip` | `src/components/shared/ModelStatusChip.jsx` | 模型状态指示器 |
| `AudioRecorder` | `src/components/shared/AudioRecorder.jsx` | 麦克风录音 + 波形 |

#### 4.2 动画系统

使用 framer-motion 的 `AnimatePresence` 和 `motion.div`:

```jsx
// 页面切换动画
<AnimatePresence mode="wait">
  <motion.div
    key={page}
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -8 }}
    transition={{ duration: 0.2, ease: "easeOut" }}
  >
    <CurrentPage />
  </motion.div>
</AnimatePresence>
```

- **页面切换**: fade + translateY
- **列表项增删**: framer-motion `layout` prop 自动布局动画
- **卡片 hover**: `scale(1.01)` + border-color 渐变
- **Toast 入场**: slide-in from bottom-right + fade
- **侧边栏折叠**: width 动画 + icon 旋转
- **进度条**: 平滑 `transition: width 0.3s ease-out`

#### 4.3 快捷键

| 快捷键 | 操作 |
|---|---|
| `Ctrl+1/2/3/4` | 切换页面 |
| `Ctrl+S` | 保存当前编辑 |
| `Ctrl+Enter` | 开始解析 / 开始合成 |
| `Ctrl+B` | 折叠/展开侧边栏 |
| `Escape` | 关闭弹窗 / 取消编辑 |

---

## 三、文件变更总览

### 新增文件 (~25 个)

```
src/
├── styles/
│   ├── variables.css          [重写] 完整设计 token
│   ├── animations.css         [新建] 关键帧动画
│   └── components.css         [新建] 组件样式
├── components/
│   ├── ui/
│   │   ├── Button.jsx         [新建]
│   │   ├── IconButton.jsx     [新建]
│   │   ├── Select.jsx         [新建] Radix Select
│   │   ├── Slider.jsx         [新建] Radix Slider
│   │   ├── Progress.jsx       [新建] Radix Progress
│   │   ├── Tabs.jsx           [新建] Radix Tabs
│   │   ├── Dialog.jsx         [新建] Radix Dialog
│   │   ├── Popover.jsx        [新建] Radix Popover
│   │   ├── Tooltip.jsx        [新建] Radix Tooltip
│   │   └── ScrollArea.jsx     [新建] Radix ScrollArea
│   ├── shared/
│   │   ├── AudioPlayer.jsx    [重写] 升级样式
│   │   ├── AudioRecorder.jsx  [新建] 麦克风录音
│   │   ├── CharacterBadge.jsx [新建] 角色色标
│   │   ├── EmptyState.jsx     [新建] 空状态
│   │   ├── FileDropZone.jsx   [新建] 拖拽上传
│   │   ├── GlassCard.jsx      [重写] 适配新 token
│   │   ├── ModelStatusChip.jsx [新建] 模型状态
│   │   └── ToastLayer.jsx     [重写] Radix Toast
│   ├── layout/
│   │   ├── Sidebar.jsx        [重写] 可折叠 + 步骤
│   │   ├── StatusBar.jsx      [新建] 底部状态栏
│   │   ├── SettingsPanel.jsx  [新建] 设置面板
│   │   └── PageContainer.jsx  [重写] 适配新布局
│   └── ...                    [重写] 各模块子组件
├── pages/
│   ├── TextInputPage.jsx      [重写] 拖拽 + WS 流式
│   ├── ScriptEditorPage.jsx   [重写] 角色面板 + 拖拽
│   ├── VoiceConfigPage.jsx    [重写] 卡片 + Tabs
│   └── SynthesisPage.jsx      [重写] 时间线 + 滑块
├── stores/
│   └── useSettingsStore.js    [重写] 完整调度逻辑
└── utils/
    └── cn.js                  [新建] clsx 封装
```

### 修改文件 (~10 个)

所有现有 page / store / component 文件将根据新设计系统进行样式和交互升级。

---

## 四、执行分期

| Phase | 内容 | 预估工作 |
|-------|------|---------|
| **P1: Foundation** | 设计 token + 字体 + 颜色 + 全局样式重构 + `cn.js` + 依赖安装 | 基础层 |
| **P2: UI Primitives** | 10 个 Radix 封装组件 (`Button`, `Select`, `Slider`, `Dialog`...) + `EmptyState` + `CharacterBadge` | 组件库 |
| **P3: Layout** | 可折叠侧边栏 + StatusBar + SettingsPanel + framer-motion 动画 + 快捷键 | 框架层 |
| **P4: Pages** | 4 个业务页面全面重构 (TextInput、ScriptEditor、VoiceConfig、Synthesis) | 业务层 |

> [!IMPORTANT]
> **执行策略**: 每个 Phase 完成后都可独立运行，不会破坏后端对接。建议按 P1→P2→P3→P4 顺序逐步推进，这样即使在中途也始终有一个可用的 UI。

## User Review Required

> [!IMPORTANT]
> **Radix UI vs 纯手写**: VoiceBox 重度使用 Radix UI 原语。当前 VoiceLace 使用原生 HTML 控件。计划引入 Radix 替代 `<select>`, `<input[type=range]>`, `<dialog>` 等。这会增加 ~50KB (gzipped) 的依赖体积，但带来显著的无障碍访问和视觉一致性提升。**是否同意引入 Radix UI?**

> [!IMPORTANT]
> **framer-motion**: 引入 framer-motion 用于页面切换和列表动画。bundle 增加 ~35KB (gzipped)。如果你更倾向轻量方案，可以用纯 CSS transitions + `AnimatePresence` 替代方案。**是否引入 framer-motion?**

> [!IMPORTANT]
> **@dnd-kit**: 用于剧本编辑器的片段拖拽排序。如果你不需要拖拽排序功能，可以跳过此依赖。**是否需要拖拽排序?**

> [!WARNING]
> **Header 移除**: 计划将当前 `Header.jsx` 的功能合并到 Sidebar 的 brand 区域 + 新的 StatusBar。这意味着顶部不再有独立的 header 条。如果你希望保留 header，请告知。

## Verification Plan

### Automated Tests
```bash
cd frontend
npm run build  # 确保编译通过, 无类型/导入错误
```

### Manual Verification
1. 每个 Phase 完成后运行 `npm run dev`，检查所有 4 个页面正常渲染
2. 折叠/展开侧边栏切换流畅
3. StatusBar 显示后端 `/system/status` 返回的模型状态
4. 所有 Radix 组件支持键盘导航 (Tab, Enter, Escape)
5. framer-motion 动画在页面切换时流畅
6. 手机端 (≤960px) 侧边栏自动折叠

