import json
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _request_json(url: str, payload: dict | None = None, *, timeout: float = 5.0) -> dict:
    if payload is None:
        req = urllib.request.Request(url, method="GET")
    else:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json"},
        )
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
        return json.loads(resp.read().decode("utf-8"))


def _request_sse(url: str, payload: dict, *, timeout: float = 5.0) -> list[dict]:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
        raw = resp.read().decode("utf-8")
    events: list[dict] = []
    for block in raw.strip().split("\n\n"):
        event = "message"
        data_lines: list[str] = []
        for line in block.splitlines():
            if line.startswith("event:"):
                event = line.split(":", 1)[1].strip() or "message"
            if line.startswith("data:"):
                data_lines.append(line.split(":", 1)[1].strip())
        if data_lines:
            events.append({"event": event, "data": json.loads("\n".join(data_lines))})
    return events


def _start_agent_server(port: int) -> subprocess.Popen:
    proc = subprocess.Popen(
        [
            sys.executable,
            "tools/serve_incision_agent.py",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--no-llm",
        ],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    deadline = time.time() + 8
    last_error = ""
    while time.time() < deadline:
        if proc.poll() is not None:
            out, err = proc.communicate(timeout=1)
            raise RuntimeError(f"agent server exited early\nstdout={out}\nstderr={err}")
        try:
            health = _request_json(f"http://127.0.0.1:{port}/api/health", timeout=0.4)
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
            last_error = str(exc)
            time.sleep(0.1)
            continue
        if health.get("ok") is True:
            return proc
    proc.terminate()
    out, err = proc.communicate(timeout=2)
    raise RuntimeError(f"agent server did not become ready: {last_error}\nstdout={out}\nstderr={err}")


def test_incision_agent_proxy_json_and_sse_contract():
    port = _free_port()
    proc = _start_agent_server(port)
    try:
        payload = {
            "tumor": {
                "kind": "subcutaneous",
                "center": [0.0, -0.5, 3.0],
                "diameter_mm": 8,
                "depth_mm": 4,
                "author": "server-test",
            },
            "provider_config": {
                "provider": "openai-compatible",
                "base_url": "https://example.invalid/v1",
                "model": "Qwen/Qwen3-14B",
                "api_key": "sk-test-secret",
                "timeout_s": 9,
            },
        }

        result = _request_json(f"http://127.0.0.1:{port}/api/agentic-incision", payload)
        assert result["schema_version"] == "agentic-incision-plan/v0.1"
        assert result["provider"]["mode"] == "deterministic_fallback"
        assert result["provider_config"]["api_key"] == "[redacted]"
        assert result["provider_config"]["base_url"] == "https://example.invalid/v1"
        assert result["agent_trace_gate"]["passed"] is True
        assert result["agent_execution_events"]["schema_version"] == "agent-execution-events/v0.1"
        assert result["agent_execution_events"]["passed"] is True
        assert result["agent_execution_events"]["tool_event_count"] == len(result["trace"])
        assert result["agent_orchestration_audit"]["schema_version"] == "agent-orchestration-audit/v0.1"
        assert result["agent_orchestration_audit"]["candidate_count"] == 3
        assert len(result["candidate_alternatives"]) == 3
        assert [item["rank"] for item in result["candidate_comparison"]] == [1, 2, 3]
        assert result["trace"][-1]["action"] == "compare_candidates"

        events = _request_sse(f"http://127.0.0.1:{port}/api/agentic-incision/stream", payload)
        names = [event["event"] for event in events]
        assert names[0] == "provider"
        assert "execution_event" in names
        assert "trace_gate" in names
        assert "react_plan" in names
        assert "result" in names
        assert names[-1] == "done"
        execution_events = [event["data"] for event in events if event["event"] == "execution_event"]
        assert execution_events[0]["event"] == "execution_started"
        assert execution_events[1]["action"] == "summarize_tumor_input_quality"
        assert execution_events[-2]["event"] == "trace_gate_evaluated"
        assert execution_events[-1]["event"] == "react_plan_evaluated"
        trace_actions = [event["data"]["action"] for event in events if event["event"] == "trace"]
        assert "propose_direction_variants" in trace_actions
        assert trace_actions[-1] == "compare_candidates"
        trace_gate = next(event["data"] for event in events if event["event"] == "trace_gate")
        assert trace_gate["passed"] is True
        react_plan = next(event["data"] for event in events if event["event"] == "react_plan")
        assert react_plan["schema_version"] == "agent-react-plan/v0.1"
        assert react_plan["passed"] is True
        streamed_result = next(event["data"] for event in events if event["event"] == "result")
        assert streamed_result["provider_config"]["api_key"] == "[redacted]"
        assert streamed_result["agent_orchestration_audit"]["comparison_ready"] is True
        boundary = streamed_result["candidate_comparison"][0]["clinical_boundary"]
        assert boundary.startswith("Engineering ranking")

        session_payload = {
            "session_id": "server-session-test",
            "tumor": payload["tumor"],
            "rounds": [
                {"round_id": "initial", "trigger": "initial_plan"},
                {
                    "round_id": "diameter-revision",
                    "trigger": "clinician_feedback_revision",
                    "clinician_feedback": {
                        "requested_change": "diameter corrected before discussion",
                        "reviewer": "server-test-reviewer",
                    },
                    "tumor_overrides": {"diameter_mm": 12},
                },
            ],
            "provider_config": payload["provider_config"],
        }
        session = _request_json(
            f"http://127.0.0.1:{port}/api/agentic-incision/session",
            session_payload,
        )
        assert session["schema_version"] == "agentic-incision-session/v0.1"
        assert session["session_id"] == "server-session-test"
        assert session["provider"]["mode"] == "deterministic_fallback"
        assert session["provider_config"]["api_key"] == "[redacted]"
        assert session["passed"] is True
        assert session["round_count"] == 2
        assert session["agent_session_audit"]["all_round_trace_gates_passed"] is True
        assert session["rounds"][1]["clinician_feedback"]["reviewer"] == "server-test-reviewer"
        assert session["rounds"][1]["tumor_delta"]["changed_fields"] == ["diameter_mm"]

        session_events = _request_sse(
            f"http://127.0.0.1:{port}/api/agentic-incision/session/stream",
            session_payload,
        )
        session_names = [event["event"] for event in session_events]
        assert session_names[0] == "provider"
        assert session_names.count("session_round") == 2
        assert "session_audit" in session_names
        assert "result" in session_names
        assert session_names[-1] == "done"
        session_rounds = [
            event["data"] for event in session_events if event["event"] == "session_round"
        ]
        assert [item["round_id"] for item in session_rounds] == ["initial", "diameter-revision"]
        session_trace_gates = [
            event["data"] for event in session_events if event["event"] == "trace_gate"
        ]
        assert {item["session_round_index"] for item in session_trace_gates} == {0, 1}
        assert all(item["passed"] is True for item in session_trace_gates)
        session_execution_events = [
            event["data"] for event in session_events if event["event"] == "execution_event"
        ]
        assert {item["session_round_index"] for item in session_execution_events} == {0, 1}
        session_audit = next(event["data"] for event in session_events if event["event"] == "session_audit")
        assert session_audit["schema_version"] == "agent-session-audit/v0.1"
        assert session_audit["round_count"] == 2
    finally:
        proc.terminate()
        try:
            proc.communicate(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.communicate(timeout=3)
