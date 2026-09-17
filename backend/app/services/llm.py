"""The model behind the chat page.

WCC has tools but nothing to reason with, so the chat needs a language model.
Rather than binding to one vendor, this speaks the OpenAI *chat completions*
shape, which is the closest thing the field has to a lingua franca: LM Studio,
Ollama, vLLM, llama.cpp, Azure OpenAI and OpenAI itself all answer it. Pointing
WCC at a different one is three environment variables, not a rewrite - which
matters when the plan is "a local model today, whatever the bank licenses
later".

Deliberately hand-rolled over httpx rather than the `openai` package: the
surface used here is one POST, and a dependency that reaches the outside of a
bank's network is a conversation nobody wants to have over one endpoint.
"""
import json
import os
from typing import Any, Dict, List, Optional

import httpx

ENV_BASE = "WCC_LLM_BASE_URL"
ENV_KEY = "WCC_LLM_API_KEY"
ENV_MODEL = "WCC_LLM_MODEL"
# Azure is the one provider that does not take the path alone: it wants an
# api-version on the query string and returns 404 without it. Everyone else
# ignores an unknown parameter, so this is only ever set for Azure.
ENV_API_VERSION = "WCC_LLM_API_VERSION"

# LM Studio's default. From inside a container, localhost is the container, so
# the host has to be named - Docker Desktop publishes it as host.docker.internal.
DEFAULT_BASE = "http://host.docker.internal:1234/v1"


class LLMUnavailable(RuntimeError):
    """No model is configured, or the one configured cannot be reached."""


def configured() -> bool:
    return bool(os.getenv(ENV_MODEL, "").strip())


def settings() -> Dict[str, str]:
    return {
        "base_url": (os.getenv(ENV_BASE) or DEFAULT_BASE).rstrip("/"),
        "model": os.getenv(ENV_MODEL, "").strip(),
        "api_key": os.getenv(ENV_KEY, "").strip(),
        "api_version": os.getenv(ENV_API_VERSION, "").strip(),
    }


def endpoint() -> str:
    s = settings()
    url = f"{s['base_url']}/chat/completions"
    return f"{url}?api-version={s['api_version']}" if s["api_version"] else url


def status() -> Dict[str, Any]:
    s = settings()
    return {
        "enabled": bool(s["model"]),
        "base_url": s["base_url"],
        "model": s["model"] or None,
        # Never the key itself, only whether one is set.
        "api_key_set": bool(s["api_key"]),
        "detail": (
            f"Talking to {s['model']} at {s['base_url']}."
            if s["model"] else
            f"No model configured. Set {ENV_MODEL} (and {ENV_BASE} if it is not "
            f"LM Studio on this machine) to switch the chat on."
        ),
    }


def _headers() -> Dict[str, str]:
    s = settings()
    h = {"Content-Type": "application/json"}
    if s["api_key"]:
        # Azure wants api-key; everyone else wants a bearer. Sending both is
        # harmless and saves a provider switch.
        h["Authorization"] = f"Bearer {s['api_key']}"
        h["api-key"] = s["api_key"]
    return h


async def complete(messages: List[Dict[str, Any]],
                   tools: Optional[List[Dict[str, Any]]] = None,
                   temperature: float = 0.2,
                   timeout: float = 120.0) -> Dict[str, Any]:
    """One turn. Returns the assistant message as the model wrote it."""
    s = settings()
    if not s["model"]:
        raise LLMUnavailable(status()["detail"])

    payload: Dict[str, Any] = {
        "model": s["model"],
        "messages": messages,
        "temperature": temperature,
        "stream": False,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(endpoint(), headers=_headers(), json=payload)
    except httpx.HTTPError as e:
        raise LLMUnavailable(
            f"Could not reach the model at {s['base_url']}: {type(e).__name__}. "
            f"If it is LM Studio, check its server is started and that "
            f"{ENV_BASE} names the host rather than localhost - inside a "
            f"container localhost is the container."
        ) from e

    if r.status_code >= 400:
        detail = r.text[:400]
        raise LLMUnavailable(f"The model returned {r.status_code}: {detail}")

    try:
        body = r.json()
        return body["choices"][0]["message"]
    except (json.JSONDecodeError, KeyError, IndexError) as e:
        raise LLMUnavailable(
            f"The model's reply was not in the expected shape ({type(e).__name__}). "
            f"Is {s['base_url']} an OpenAI-compatible endpoint?"
        ) from e
