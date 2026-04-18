# LLM Engine Refactor Notes (P1)

## 目标

- 缩小 `backend/engine/llm_engine.py` 复杂度，降低维护和回归风险。
- 在保持行为兼容的前提下，把“调用层 / 解析层 / 编排层 / 执行层”拆分。

## 当前模块分层

### 1) 引擎装配层

- 文件：`backend/engine/llm_engine.py`
- 职责：
  - 模型加载/卸载与 backend 选择
  - 对外暴露 parse API
  - 维护 `last_parse_stats` 和运行态字段
  - 组装并委托调用下层服务

### 2) Provider 调用层

- 文件：`backend/engine/llm_clients.py`
- 职责：
  - OpenAI / Gemini 请求封装
  - 结构化输出请求策略（schema 优先 + 回退）
  - Gemini JSON 修复请求

### 3) JSON 解析策略层

- 文件：`backend/engine/llm_parser.py`
- 职责：
  - schema 生成与 Gemini schema 转换
  - JSON fence 处理、对象提取
  - payload 校验（必须包含 `segments`）
  - decode + repair 策略和 meta 生成

### 4) 分块编排层

- 文件：`backend/engine/llm_parse_orchestrator.py`
- 职责：
  - 分块流程控制
  - chunk 上下文拼接（已知角色）
  - 统计聚合（single/chunked）

### 5) 单段执行层

- 文件：`backend/engine/llm_single_runner.py`
- 职责：
  - 单段 parse 执行与重试
  - llama token stream 消费
  - provider fallback 与 stats 输出

## 兼容性策略

- `LLMEngine` 保留原方法名（例如 `_decode_json_payload_with_meta`）作为薄封装，减少调用方改动。
- 统计字段结构保持不变：`mode/total_chunks/duration_ms/repair_used_count/fallback_count/chunk_stats`。
- provider fallback 行为保持一致，错误信息继续写入 `last_error`。

## 解析可观测字段（新增）

`last_parse_stats` 额外补充以下字段，便于前端状态栏与排障：

- `model_name`
- `structured_output_enabled`
- `json_repair_enabled`
- `think_mode_enabled`
- `n_ctx`
- `max_tokens`

## 建议的后续演进

- 把 `llm_single_runner` 的 llama stream 子流程继续拆成可单测函数（event->piece 聚合器）。
- 在 CI 增加 `backend.tests.test_llm_*` 模块集合，确保拆分后层级长期可维护。
- 为 OpenAI/Gemini client 增加超时/重试策略配置化（当前为内嵌参数）。
