# Qwen Agent V9

Local Ollama desktop coding + cowork-style agent for macOS.

## V9 additions
- Web search, URL fetch, GitHub code search and npm package lookup
- Cowork-style task planner and background shell tasks
- Persistent sessions and task history
- Trusted folders with path sandboxing
- Project context tool
- Automatic command-failure feedback and repeated-error guard
- Existing Diff Preview / Manual / Auto / Plan workflow preserved
- Git, editor, terminal, drag/drop image attachments and one-click DMG build preserved

## Run
```bash
npm install
npm start
```

Requires Ollama at `http://localhost:11434`. The default model is `qwen3-coder:30b-64k`; set `QWEN_AGENT_MODEL` to change it.

## Web access
Web tools run from the Electron main process. They are explicit agent tools (`web_search`, `fetch_url`, `github_search`, `npm_info`) rather than unrestricted browser control.

## Safety
File operations are restricted to the selected project and explicitly trusted folders. Shell commands continue to use Manual/Auto/Plan gating, with extra confirmation for potentially destructive commands.

## V11 Regression Suite
Use the **Tests** tab to run a consolidated regression suite covering workspace access, file create/read/edit, project search, terminal execution, background pause/resume, checkpoint rollback, Git detection, Ollama connectivity, session persistence, and cleanup. The suite uses a temporary `.qwen-agent-regression` folder and removes it after the run.
