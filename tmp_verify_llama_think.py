import inspect
import json
from pathlib import Path

from llama_cpp import Llama


MODEL_PATH = r"D:\ComfyUI_windows_portable\ComfyUI\models\LLM\GGUF\Qwen\Qwen3.5-27B-GGUF\Qwen3.5-27B-UD-IQ3_XXS.gguf"


def run(enable_thinking: bool) -> None:
    print(f"--- enable_thinking={enable_thinking} ---")
    llm = Llama(
        model_path=MODEL_PATH,
        n_ctx=2048,
        n_gpu_layers=-1,
        n_batch=512,
        n_threads=8,
        chat_format="chatml",
        flash_attn=True,
        verbose=False,
    )
    sig = inspect.signature(llm.create_chat_completion)
    print("supports_chat_template_kwargs=", "chat_template_kwargs" in sig.parameters)
    stream = llm.create_chat_completion(
        messages=[
            {"role": "system", "content": "You are a concise assistant."},
            {"role": "user", "content": "请只回复两个汉字：收到"},
        ],
        max_tokens=64,
        temperature=0.1,
        top_p=0.9,
        top_k=20,
        min_p=0.0,
        present_penalty=0.0,
        repeat_penalty=1.0,
        stream=True,
        chat_template_kwargs={"enable_thinking": enable_thinking},
    )
    pieces: list[str] = []
    finish_reason = ""
    for i, event in enumerate(stream):
        choice = event["choices"][0]
        finish_reason = str(choice.get("finish_reason") or finish_reason or "")
        delta = choice.get("delta", {})
        piece = delta.get("content") or ""
        if piece:
            pieces.append(piece)
        if i >= 80:
            break
    print("finish_reason=", finish_reason)
    print("output=", json.dumps("".join(pieces), ensure_ascii=False))


if __name__ == "__main__":
    print("model_exists=", Path(MODEL_PATH).exists())
    run(False)
    run(True)
