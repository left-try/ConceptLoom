# Visual Learning and Simulations — Specification

**Status:** Draft for user review
**Scope:** Semantic teaching diagrams first; bounded interactive simulations after practice persistence is available.
**Related:** [platform design](2026-10-12-conceptloom-learning-platform-design.md), [practice plan](../plans/2026-10-12-conceptloom-practice.md), [diagram implementation](../plans/2026-10-12-conceptloom-foundation.md).

## Goal

Use diagrams and interactive models when they make a concept, dependency or causal process easier to understand, with a readable text fallback and saved learner attempts.

## Behavior and boundaries

- A teaching diagram expresses one idea: sequence, dependency, system boundary or concept relationship. It is generated from semantic nodes/edges with stable IDs and source/lesson links where available.
- The coach chooses a diagram only when visual structure helps; it does not add graphics to every response. Large maps are bounded to a useful neighborhood with progressive expansion.
- Every view has a text equivalent; unsupported hosts receive Mermaid or monospace output.
- A simulation is a versioned exercise with explicit learner-controlled inputs, a prediction-before-run step, deterministic or seeded outcomes, and an exportable attempt connected to the practice contract.
- Public simulation state and learner controls never contain hidden grading keys or answer criteria. Interactive UI is optional; it does not replace durable attempt storage.
- Simulations are introduced only after attempt submission/assessment and the text fallback work. Arbitrary user code execution is excluded.

## Acceptance criteria

- **VL-1 Semantic correctness:** Duplicate node IDs, unknown edge endpoints and invalid status values fail validation; labels render as text, not executable markup.
- **VL-2 Useful scale:** A graph view is bounded to a selected lesson/concept neighborhood, reports truncation and allows explicit expansion.
- **VL-3 Accessibility/fallback:** Diagram information is available in readable text and keyboard-navigable UI where UI is supported; unsupported clients receive text/Mermaid.
- **VL-4 Selective use:** Lesson output uses a diagram only when it clarifies the objective; no diagram is a valid outcome.
- **VL-5 Simulation integrity:** Prediction is captured before result reveal; same seed and actions reproduce the same state; invalid transitions are rejected.
- **VL-6 Attempt parity:** Simulation export matches the canonical practice attempt schema and can be assessed after closing/reopening the view.
- **VL-7 Privacy:** Private criteria/solutions are absent from UI resources and local exports before assessment.

## Test plan

- Unit tests for semantic diagram validation, stable rendering, hostile labels, relation IDs, bounds and deterministic text output.
- UI/resource tests for text fallback, keyboard operation, narrow/wide rendering, theme contrast, truncation/expansion and absence of private canary values.
- Simulation property tests: same seed/replay equivalence, invalid transition rejection, prediction stored before reveal, attempts preserve action trace.
- Cross-host acceptance checks record actual UI capability separately for each client; lack of UI does not fail the text pathway.
- End-to-end test creates a course concept graph → opens a lesson-level view → makes a prediction and actions → exports attempt → assesses it → verifies saved evidence and resume.

## Out of scope

Coding labs, arbitrary code execution, 3D/animated visualizations, and a general-purpose graph editor.
