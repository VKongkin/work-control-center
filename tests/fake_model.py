"""An OpenAI-compatible model that does exactly what the test tells it to.

The chat loop cannot be tested against a real model: the answer would differ
every run, there is no model in CI, and a bank's network will not reach one
anyway. But the loop is the part worth testing - does a tool call actually run,
does its result get fed back, does a second round happen, does a tool error
reach the model as text it can read.

So this serves the chat-completions endpoint and replies from a script the test
hands it. Same protocol, no reasoning.

    server = FakeModel([
        {"tool": "create_task", "arguments": {"title": "..."}},
        {"content": "Done - raised it."},
    ])
    server.start()          # -> server.base_url
    ...
    server.stop()
"""
import http.server
import json
import threading
from typing import Any, Dict, List, Optional


class FakeModel:
    def __init__(self, script: Optional[List[Dict[str, Any]]] = None):
        # Each entry is either {"content": "..."} or
        # {"tool": name, "arguments": {...}} - or a list of those for one turn
        # replying with several calls at once.
        self.script: List[Any] = list(script or [])
        self.seen: List[Dict[str, Any]] = []     # every request body received
        self._httpd = None
        self._thread = None
        self.port = 0
        self.fail_with: Optional[int] = None     # make it answer with an error
        self.garbage = False                     # ...or with nonsense

    # ------------------------------------------------------------------ http

    def _handler(self):
        outer = self

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass                              # silence

            def do_POST(self):
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}")
                outer.seen.append(body)

                if outer.fail_with:
                    self.send_response(outer.fail_with)
                    self.end_headers()
                    self.wfile.write(b'{"error":{"message":"the model is sulking"}}')
                    return
                if outer.garbage:
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(b'{"not":"what you expected"}')
                    return

                step = outer.script.pop(0) if outer.script else {
                    "content": "I have nothing scripted to say."
                }
                message = outer._message(step, len(outer.seen))
                payload = {
                    "id": f"chatcmpl-fake-{len(outer.seen)}",
                    "object": "chat.completion",
                    "model": body.get("model", "fake"),
                    "choices": [{"index": 0, "message": message,
                                 "finish_reason": "tool_calls"
                                 if message.get("tool_calls") else "stop"}],
                }
                raw = json.dumps(payload).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

        return H

    @staticmethod
    def _message(step: Any, n: int) -> Dict[str, Any]:
        steps = step if isinstance(step, list) else [step]
        calls = []
        content = None
        for i, s in enumerate(steps):
            if "tool" in s:
                calls.append({
                    "id": f"call_{n}_{i}",
                    "type": "function",
                    "function": {
                        "name": s["tool"],
                        # Deliberately a string, as a real model sends it - the
                        # loop has to parse it, including when it is malformed.
                        "arguments": s["arguments"] if isinstance(s.get("arguments"), str)
                        else json.dumps(s.get("arguments", {})),
                    },
                })
            else:
                content = s.get("content")
        msg: Dict[str, Any] = {"role": "assistant", "content": content}
        if calls:
            msg["tool_calls"] = calls
        return msg

    # ----------------------------------------------------------- lifecycle

    def start(self, port: int = 0) -> str:
        # A fixed port when the API is a separate process: it has to be told
        # where the model is before it starts, so the port cannot be a surprise.
        self._httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), self._handler())
        self.port = self._httpd.server_address[1]
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()
        return self.base_url

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}/v1"

    def stop(self):
        if self._httpd:
            self._httpd.shutdown()
            self._httpd.server_close()

    # ------------------------------------------------------------- helpers

    @property
    def last_request(self) -> Dict[str, Any]:
        return self.seen[-1] if self.seen else {}

    def tool_names_offered(self) -> List[str]:
        return [t["function"]["name"] for t in self.last_request.get("tools", [])]

    def roles_seen(self) -> List[str]:
        return [m.get("role") for m in self.last_request.get("messages", [])]
