# pi-recap — short, trusted-settings fork

A fork of [Dovyski/pi-recap](https://github.com/Dovyski/pi-recap), preserving its tiny status recap and terminal tab title. Requires current Pi (`@earendil-works/pi-coding-agent` 1.4+) and Node 22.19+; tests use Node 24+.

```text
※ Recap: Hardened Luna recap stays last in the flexible footer
```

## Install

```sh
pi install git:https://github.com/Karlo-Vrdoljak/pi-recap@fix/safe-short-recap
```

Run `/login openai-codex` if needed, then `/reload`. The default helper model is **GPT-6 Luna through your ChatGPT login**. There is no automatic fallback to an expensive session model or another provider.

For reproducible installs, pin a reviewed commit instead of the branch. The `dotfiles-mac` configuration does this already. Do not also copy the extension into the extensions directory: that would load it twice.

## Behavior and privacy

- At most **14 words and 160 characters**, with a separate 2–6 word tab title.
- Runs in the background only after the agent settles, not between tool calls. No calls in headless mode.
- Sends only the latest request and final reply, each capped at 2,000 characters. No tool results, images, hidden reasoning, or full-session uploads.
- Uses Pi's model registry for authentication; never reads credential files or handles tokens itself.
- Reads only Pi's effective settings. A denied project's settings cannot override the recap model.
- Aborts obsolete work on new input, session replacement, reload, or shutdown. Each helper request has a 15-second deadline and no retries.
- Removes terminal control sequences from generated and restored text. Incomplete/failed results retain the previous recap and show a warning.
- Persists recap/title data as session custom entries, not model-visible messages. The first recap also generates the title; later exchanges need only the recap call.

**These are additional model calls and consume your allowance.** Helper usage is not included in Pi's session token/dollar totals. Only enable the extension if sending those bounded snippets to the selected provider is acceptable. A recap is an orientation aid, not a verified statement of completed work.

## Configuration

No configuration is necessary. Optional settings are read through Pi's trusted-settings API:

```json
{
  "recap": {
    "model": "openai-codex/gpt-6-luna",
    "maxWords": 14
  }
}
```

`maxWords` may shorten the recap but cannot exceed 14. The existing `recap.prompts.title` and `recap.prompts.recap` string overrides remain supported; each prompt is capped at 2,000 characters. Trusted project settings can change these values, including the provider. Review them before approving a project. Run `/reload` after changing settings.

The extension publishes a plain `pi-recap` status and never replaces the footer. A custom footer can explicitly place that status last; `dotfiles-mac` does so and preserves wrapping at narrow widths.

## Development

Keep `origin` pointing at this fork and `upstream` at Dovyski's repository. Make changes on a feature branch; do not patch the managed installation.

```sh
npm test
PI_RECAP_INTEGRATION=1 npm test
```

Unit tests need no installed dependencies or network access. The optional integration test needs current Pi resolvable as a peer package (or `PI_TEST_CLI` pointing to its installed `dist/bundle/cli.js`). It checks the real extension loader and project-trust filtering without making model calls.

## License

MIT. Original work by Fernando Bevilacqua; see [LICENSE](LICENSE).
