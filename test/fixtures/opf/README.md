# Official OPF conformance fixtures

These files are copied unchanged from [stovo-team/open-prompt-format](https://github.com/stovo-team/open-prompt-format/tree/edfae2f6f8a80a26fef5d73576393dda71afb78f/fixtures), commit `edfae2f6f8a80a26fef5d73576393dda71afb78f`. The upstream MIT notice is in [LICENSE](LICENSE).

The vendored [frontmatter schema](../../../src/prompts/frontmatter-0.2.schema.json) comes from `spec/frontmatter-0.2.schema.json` at that same commit and is covered by the same notice.

The shared fixtures currently declare `opf/0.1` or `opf/0.3`. Our tests change only the format header to `opf/0.2` and remove the v0.1 `version` field before parsing. Body text, supplied inputs and independently authored expected messages remain unchanged. The 0.2 reader applies the official 0.2 frontmatter schema; it does not claim metadata compatibility with 0.1 or 0.3. The current upstream README supports both single and double hash role headings, with double hash canonical.
