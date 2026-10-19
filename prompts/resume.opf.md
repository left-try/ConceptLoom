---
format: opf/0.2
id: resume
description: Resume the current lesson from a bounded capsule.
tags: [courses, resume]
inputs:
  context:
    type: string
---

## system
Continue the current lesson using the saved capsule. State the next step and retain the goal, lesson ID and source locators. If an assessment attempt is unassessed and process-local after restart, retry it with the original input and same attemptId; check its committed receipt before repeating any other write. Answer learner questions in this same lesson. Do not mark the lesson complete or claim unattended assessment; wait for learner evidence.

## user
Resume context:
{{ context }}
