# Fork Maintenance

This fork retains the upstream application and adds headless hosting and the owner's interface and writing preferences.
Keep upstream merges separate from local feature and repair commits.
Do not replace a conflicted file wholesale with either side without checking the responsibilities below.

## Source References

- Previous upstream baseline: `3dd52110bbcbcba81645453ce0a8fdc230594c47` (0.3.9).
- Saved local changes before the 0.4.0 merge: `2a64653`.
- Upstream 0.4.0: `dc4c398d5167865b84b0ccb3ec809eb88bf8f65f`.
- Upstream repository: <https://github.com/amosblomqvist/learnharness>.

The local `upstream` remote points to that repository.
Runtime credentials, learning data, private hostnames and deployment inventories belong outside this public repository.

## Intentional Differences

| Area | Preserve | Main References |
| --- | --- | --- |
| Writing | Australian English, APA Title Case for titles and short labels, shared unslop guidance for every agent request; preserve schemas and quotations | `src/agent/writing-guidance.ts`, `src/agent/models.ts`, built-in prompts, `tests/writing-guidance.test.ts` |
| Interface | Clearer copy, natural empty-state wrapping, aligned composer controls, owner wordmark beside the logo and reduced-motion support | `app/globals.css`, `components/composer-actions.tsx`, `components/owner-wordmark.tsx`, `components/sidebar.tsx`, render tests |
| Headless Hosting | Standalone Linux image, persistent state/auth/sources separation, health route and remote ChatGPT callback completion | `Dockerfile`, `.dockerignore`, `docs/headless.md`, web-subscription modules and tests |
| Study Files | Headless source-root confinement; retain upstream file/PDF/image handling within that boundary | `src/agent/tools/fs-shared.ts`, `tests/headless-sources.test.ts` |
| Terra Discovery | Account must advertise the model; SDK metadata takes precedence over the temporary compatibility entry | `src/agent/chatgpt-models.ts`, `src/agent/chatgpt-bridge.ts`, `tests/chatgpt-catalog.test.ts` |
| Shutdown | Initialise cleanup before requests, close notification streams and cancel web provider transports on signals; let Next drain and exit | `instrumentation.ts`, `src/server/shutdown.ts`, `scripts/smoke-shutdown-runtime.mjs` |

Prefer upstream behaviour for model admission, billing disclosure, question authority, persistence and rendering.
Apply our wording and presentation preferences around those behaviours.
Keep shared writing guidance at the production model boundary so new provider paths receive it without duplicating prompts.
Retain shutdown cancellation for discovery and queued credential refreshes; closing providers only on process exit can leave Next waiting for their HTTP requests.

## Intentional Conflict Resolutions: 0.4.0

| File and Landmark | Conflict | Resolution and Future Comparison |
| --- | --- | --- |
| `src/agent/models.ts`, `piEngineForSpec().streamFn` | Upstream added per-operation custom-provider resolution; our branch added shared writing guidance | Keep upstream resolution, thinking and billing behaviour. Prepare the request context once with `withWritingContext` before either provider branch. Pass that context through both custom and built-in streams. Verify helper, custom-provider and conversation prompt tests. |
| `components/settings/model-menu.tsx`, `ModelMenuList` billing caption | Upstream added Claude CLI billing and unavailable-price handling; our branch changed label casing | Keep every upstream billing branch. Retain `Subscription Connection`, `Price Unavailable` and `CLI Billing`, and use Learn Harness in authored explanatory copy. Verify model-menu and Claude CLI billing tests. |
| `tests/chatgpt-connection-ui.test.tsx`, Providers section order | Upstream added the fifth External CLI section; our branch expected four sections with title-cased Model API Keys | Keep five sections and the CLI assertion. Preserve `Model API Keys`. The test must reflect both the added capability and our copy. |

The upstream `tests/claude-code-usage.test.tsx` caption assertion also deliberately uses `CLI Billing` to match our title casing.
`tests/custom-provider-lifecycle.test.ts` verifies that the shared writing policy reaches the native custom-provider transport once.

An automatic merge is not evidence that local behaviour survived.
Review the upstream diff for new production model paths, prompt composition, source-file reads and replacement UI components.
Check the intentional differences above even when Git reports no conflict.

## Future Updates

Start with a clean working tree and retain the deployed source commit and image reference in private operation records.
Fetch the next upstream release and inspect its changes before merging:

For a new clone, first add the remote once with `git remote add upstream https://github.com/amosblomqvist/learnharness.git`.

```sh
git fetch upstream main
git log --oneline HEAD..upstream/main
git diff --stat HEAD...upstream/main
git merge --no-ff --no-commit upstream/main
```

Compare conflicts with the latest local feature commit and the previous upstream baseline.
Record new intentional resolutions in this document using function/component landmarks, the competing behaviours, the selected result and relevant validation.
Do not use file-wide `ours` or `theirs` resolution for mixed behaviour and presentation changes.

Run the deterministic tests, lint, type checking, production build, standalone curation and runtime smoke checks.
Run `node scripts/smoke-image-runtime.mjs --standalone .next/standalone` to check the traced image-processing core, worker and Photon WASM assets.
Qualify native dependencies and shutdown in the Linux image before deployment.
Keep the merge commit separate from any subsequent local repair so future comparisons can distinguish imported code from our changes.
Publish only source and documentation; retain live operation evidence in the private infrastructure repository.
