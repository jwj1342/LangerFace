import fs from "node:fs";
import assert from "node:assert/strict";

const script = fs.readFileSync("../tools/slurm/serve_qwen_agent_l40s.sbatch", "utf8");

assert.ok(script.startsWith("#!/usr/bin/env bash"), "Slurm entrypoint is an executable bash script");
assert.ok(script.includes("#SBATCH --gres=gpu:l40s:1"), "Qwen/vLLM job requests one L40S GPU");
assert.ok(script.includes("#SBATCH --cpus-per-task=8"), "Qwen/vLLM job requests enough CPU workers");
assert.ok(script.includes("#SBATCH --mem=64G"), "Qwen/vLLM job requests explicit memory");
assert.ok(script.includes("module load python/3.11.5 cuda/12.6"), "job loads Python and CUDA modules");
assert.ok(script.includes("LANGERFACE_LLM_MODEL:-Qwen/Qwen3-14B"), "default model is Qwen3 14B");
assert.ok(script.includes("python -m vllm.entrypoints.openai.api_server"), "job starts vLLM OpenAI-compatible server");
assert.ok(script.includes("--host \"$VLLM_HOST\""), "vLLM host is configurable");
assert.ok(script.includes("--port \"$VLLM_PORT\""), "vLLM port is configurable");
assert.ok(script.includes("--model \"$LANGERFACE_LLM_MODEL\""), "vLLM receives the selected Qwen model");
assert.ok(script.includes("curl -fsS \"http://127.0.0.1:$VLLM_PORT/health\""), "job gates agent startup on vLLM health");
assert.ok(script.includes("LANGERFACE_LLM_PROVIDER=openai-compatible"), "agent uses OpenAI-compatible provider");
assert.ok(script.includes("LANGERFACE_LLM_BASE_URL=\"http://127.0.0.1:$VLLM_PORT/v1\""), "agent points to local vLLM endpoint");
assert.ok(script.includes("LANGERFACE_LLM_API_KEY=\"${LANGERFACE_LLM_API_KEY:-EMPTY}\""), "agent does not require a real key for local vLLM");
assert.ok(script.includes("python tools/serve_incision_agent.py --host \"$AGENT_HOST\" --port \"$AGENT_PORT\""), "job starts the incision agent proxy");
assert.ok(script.includes("ssh -N -L 8765:$(hostname):$AGENT_PORT <login-node>"), "job prints tunnel instructions for the frontend");

const vllmIndex = script.indexOf("python -m vllm.entrypoints.openai.api_server");
const healthIndex = script.indexOf("curl -fsS \"http://127.0.0.1:$VLLM_PORT/health\"");
const providerIndex = script.indexOf("export LANGERFACE_LLM_PROVIDER=openai-compatible");
const agentIndex = script.indexOf("python tools/serve_incision_agent.py");
assert.ok(vllmIndex >= 0 && healthIndex > vllmIndex, "health gate happens after vLLM starts");
assert.ok(providerIndex > healthIndex, "provider env is exported after vLLM health check");
assert.ok(agentIndex > providerIndex, "agent starts after provider env is set");

console.log("test_slurm_qwen_agent: L40S vLLM agent job contract assertions passed");
