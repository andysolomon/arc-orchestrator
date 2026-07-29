# Research: Automatic Delegate Wrapper

Cursor documents `--model` as the CLI's explicit model-selection parameter and separately documents Auto as unpinned selection:

- https://docs.cursor.com/en/cli/reference/parameters
- https://docs.cursor.com/advanced/models

For this bug, ARC's own automatic selector is authoritative. Removing Cursor's model argument inside the Composer backend would not repair the surface bug and would weaken trace/model attestation. The fix must occur before backend selection.

