# Project instructions

## Working style
- Prefer minimal, targeted changes. Inspect only the files relevant to the task and do not refactor unrelated code.
- While iterating run targeted tests; run the full suite before finishing.
- Ask before major architectural changes: new dependencies, schema redesigns, moving or splitting folders.

## Code principles
- Write clean, readable, maintainable code. Simplicity and correctness come before cleverness or speed of delivery.
- Choose the simplest robust solution. No overengineering, and no unnecessary abstractions, dependencies, frameworks or configuration.
- Prefer explicit, understandable logic over compact tricks. Follow established conventions and the existing project style.

## Organization
- Keep concerns separate: data retrieval, data processing, business logic, storage and presentation.
- Every module and function has one clear responsibility. Follow the existing architecture unless a change is justified.
- A long file is fine when it is readable, cohesive and touches few areas. Split a file only when it mixes unrelated jobs or changes for unrelated reasons.
- Do not add files that only forward calls or re-export other files. Fragmentation and pass-through layers bloat the project.
- Reuse code that is genuinely shared. Do not duplicate existing functionality, and avoid circular dependencies and hidden coupling.

## Project conventions
- Backend (`src/backend`): Python with uv, so run `uv run ...` from that folder. Schema changes are Alembic migrations in `migrations/versions/`; never edit one that has been applied, add a new one.
- Frontend (`src/frontend`): npm, run from that folder. Colours, sizes, labels and typography live in `src/settings.js`. Every chart goes through `src/Plot.jsx`, so register a new trace type there before using it.
- Keep each file's existing line endings, and never commit secrets: `.env` files are ignored, `.env.example` shows what is needed.
