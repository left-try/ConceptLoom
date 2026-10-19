# Coding labs

Coding labs are ordinary versioned ConceptLoom exercises. Public instructions and starter files are kept separate from private checks and runner configuration.

## Configure an executor

1. Install Docker yourself and build the runtime image locally.
2. Configure the exercise's trusted runner with the exact `sha256:<64 hex digits>` image digest, an argv array, and optional limits no higher than 10 seconds, 128 MiB, one CPU, 64 processes, and 64 KiB combined output.
3. Keep expected results and grading criteria in private exercise state. They are never mounted into the learner container.
4. Verify the digest exists locally. ConceptLoom never pulls or installs an image during a practice call.

The executor starts Docker with `shell: false`, no network, a read-only root filesystem and source mount, a non-root UID, dropped Linux capabilities, `no-new-privileges`, a bounded tmpfs, process/CPU/memory limits, and an enforced timeout. Only submitted source files are staged. The container cannot write to the workspace or access the host filesystem outside its read-only input mount.

## Results and fallback

`completed`, `failed`, `timeout`, and `unavailable` are distinct execution outcomes. An unavailable daemon or missing local image does not count as a pass. The submitted source and attempt are still retained. A host may review the code without running it, but that is recorded as execution-unverified evidence.

Local HTML and text views can export a response file for explicit submission through the MCP host. They do not execute code themselves and do not claim that private grading is hidden from a learner who controls the local file.
