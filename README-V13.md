# Qwen Agent V13

V13 builds on V12 with a more autonomous multi-step agent loop and parallel task support.

## New in V13
- `run_parallel_background` tool for independent long-running jobs.
- `get_task_status` tool for monitoring background jobs and recent output.
- Safe read/search/web tool calls can execute concurrently when the model requests multiple independent calls.
- Agent system prompt explicitly requires verified multi-step completion instead of stopping at a plan.
- Regression suite includes a parallel background-task test.
- Version 1.3.0.

V12 functionality including workspace access, file tools, terminal streaming, real process pause/resume, checkpoints, rollback, sessions, Git, web tools, Ollama, regression tests, and development update flow is preserved.
