# Project instructions

- Prefer minimal, targeted changes.
- Inspect only files relevant to the task.
- Avoid unnecessary repository-wide searches.
- Do not refactor unrelated code.
- Run targeted tests instead of the full test suite.
- Ask before making major architectural changes.


1. General Principles

Write clean, readable, maintainable, production-quality code.
Prioritize simplicity, correctness, and clarity over cleverness.
Follow established software engineering conventions and best practices.
Avoid overengineering. Implement the simplest robust solution that satisfies the requirements.
Do not introduce unnecessary abstractions, dependencies, frameworks, or configuration.
Prefer explicit, understandable logic over unnecessarily compact code.
Never sacrifice correctness or maintainability for implementation speed.

2. Architecture and Organization

Maintain a clear separation of concerns between data retrieval, data processing, business logic, storage, and presentation.
Each module, class, and function should have a clearly defined responsibility.
Follow the existing project architecture unless a change is justified.
Avoid creating large, monolithic files or functions.
Avoid unnecessary fragmentation into excessive small files or wrapper functions.
Prefer reusable components when functionality is genuinely shared.
Avoid circular dependencies and hidden coupling.
Do not duplicate existing functionality.