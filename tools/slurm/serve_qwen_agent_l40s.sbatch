#!/usr/bin/env bash
#SBATCH --job-name=lf-qwen-agent
#SBATCH --gres=gpu:l40s:1
#SBATCH --cpus-per-task=8
#SBATCH --mem=64G
#SBATCH --time=04:00:00
#SBATCH --output=logs/lf-qwen-agent-%j.out
#SBATCH --error=logs/lf-qwen-agent-%j.err

set -euo pipefail

cd "${SLURM_SUBMIT_DIR:-$(pwd)}"
mkdir -p logs

module load python/3.11.5 cuda/12.6

export HF_HOME="${HF_HOME:-${SCRATCH:-$HOME}/hf-cache}"
export TRANSFORMERS_CACHE="${TRANSFORMERS_CACHE:-$HF_HOME/transformers}"
export VLLM_VENV="${VLLM_VENV:-${SCRATCH:-$HOME}/venvs/langerface-vllm}"
export LANGERFACE_LLM_MODEL="${LANGERFACE_LLM_MODEL:-Qwen/Qwen3-14B}"
export VLLM_HOST="${VLLM_HOST:-0.0.0.0}"
export VLLM_PORT="${VLLM_PORT:-8000}"
export AGENT_HOST="${AGENT_HOST:-0.0.0.0}"
export AGENT_PORT="${AGENT_PORT:-8765}"
export LANGERFACE_LLM_TIMEOUT_S="${LANGERFACE_LLM_TIMEOUT_S:-60}"

if [[ ! -x "$VLLM_VENV/bin/python" ]]; then
  python -m venv "$VLLM_VENV"
fi

source "$VLLM_VENV/bin/activate"
python -m pip install --upgrade pip wheel

if ! python - <<'PY'
import importlib.util
raise SystemExit(0 if importlib.util.find_spec("vllm") else 1)
PY
then
  python -m pip install "vllm>=0.8" "transformers>=4.51" "accelerate>=1.0"
fi

echo "LangerFace Qwen/vLLM job"
echo "node=$(hostname)"
echo "model=$LANGERFACE_LLM_MODEL"
echo "vllm=http://$(hostname):$VLLM_PORT/v1"
echo "agent=http://$(hostname):$AGENT_PORT/api/agentic-incision"
echo "tunnel example: ssh -N -L 8765:$(hostname):$AGENT_PORT <login-node>"

python -m vllm.entrypoints.openai.api_server \
  --host "$VLLM_HOST" \
  --port "$VLLM_PORT" \
  --model "$LANGERFACE_LLM_MODEL" \
  --dtype auto \
  --gpu-memory-utilization "${VLLM_GPU_MEMORY_UTILIZATION:-0.85}" \
  --max-model-len "${VLLM_MAX_MODEL_LEN:-8192}" &
VLLM_PID=$!

cleanup() {
  kill "$VLLM_PID" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 240); do
  if curl -fsS "http://127.0.0.1:$VLLM_PORT/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

curl -fsS "http://127.0.0.1:$VLLM_PORT/health" >/dev/null

export LANGERFACE_LLM_BASE_URL="http://127.0.0.1:$VLLM_PORT/v1"
export LANGERFACE_LLM_API_KEY="${LANGERFACE_LLM_API_KEY:-EMPTY}"

python tools/serve_incision_agent.py --host "$AGENT_HOST" --port "$AGENT_PORT"
