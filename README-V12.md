# Qwen Agent V12

V12 adds a faster iteration/update workflow and fixes the Git regression test.

## Quick development update

Keep this project connected to your GitHub repository. Double-click `update-qwen-agent.command` (or run it) to pull the latest version, install dependencies, and start Qwen Agent. No repeated ZIP extraction is needed.

Inside the app, the **Update** button performs the same flow when the development copy has a Git remote configured.

## Git

The Git tab now includes **Initialize Git**. The regression suite temporarily initializes a repository when needed, tests Git commands, and removes the temporary `.git` directory so a non-Git project is not permanently changed.

## Build

`npm run dist:dmg` builds the macOS DMG.
