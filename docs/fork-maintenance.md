# Fork Maintenance

This fork retains the upstream application and adds headless hosting and the owner's interface and writing preferences.
Keep upstream merges separate from local feature and repair commits.
Do not replace a conflicted file wholesale with either side without checking the responsibilities below.

## Source References

- Previous upstream baseline: `3dd52110bbcbcba81645453ce0a8fdc230594c47` (0.3.9).
- Saved local changes before the 0.4.0 merge: `2a64653`.
- Upstream 0.4.0: `dc4c398d5167865b84b0ccb3ec809eb88bf8f65f`.
- Fork before the 0.6.1 merge: `14a61eb8d57946ff17ca6b26634fae6ee2012225`.
- Upstream 0.6.1: `cb25c8e49b85eed9e78315584731cad73a0118a6`.
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
| Shutdown | Initialise cleanup before requests, close notification streams and cancel web provider transports on signals; let Next drain and exit | `instrumentation.ts`, `src/server/shutdown.ts`, `scripts/smoke-shutdown-runtime.mjs` |

Prefer upstream behaviour for model admission, billing disclosure, question authority, persistence and rendering.
Apply our wording and presentation preferences around those behaviours.
Keep shared writing guidance at the production model boundary so new provider paths receive it without duplicating prompts.
Use hyphens only for established spellings, APA convention or to prevent misreading.
Rewrite invented compound labels as ordinary phrases, and retain the wording changes in built-in prompts when merging upstream.
For example, use "situations that suggest the wrong method" and "targets least recently active" rather than joining each phrase with hyphens.
Retain correct forms such as "sign-in" and "self-assessment", and preserve code, identifiers, filenames and quotations exactly.
The [APA hyphenation principles](https://apastyle.apa.org/style-grammar-guidelines/spelling-hyphenation/hyphenation) explain the distinction between dictionary spellings and temporary compounds.
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

## Intentional Conflict Resolutions: 0.6.1

| File and Landmark | Resolution and Validation |
| --- | --- |
| `src/agent/models.ts`, `piEngineForSpec().streamFn` | Keep per-operation cache retention and custom-provider revalidation. Prepare writing context once and pass it through every provider branch. Verify writing guidance, custom-provider lifecycle and cache-retention tests. |
| `instrumentation.ts`, `register` | Register shutdown cleanup before initialising plugins. Retain upstream plugin failure reporting and basic application access. |
| `src/agent/tools/fs-shared.ts`, `resolveSourcePath` and `sourceSearchRoots`; `file-access.ts`, `guardSourcePath`; `ls.ts` | Compose mandatory study-folder confinement, sensitive-location denials and optional allowed folders. Intersect roots for restricted searches; never fall back to home on a headless server. Check every listed entry before `stat`, independently of the optional restriction. Verify headless-source and upstream file-access tests. |
| `src/server/desktop-access.ts`, `subscriptionRequestOrigin` and `browserAPIRefusal` | Keep the shared upstream request guard, including streamed plugin documents. Validate the exact configured HTTPS origin and preserved host, require explicit host admission and ignore forwarded headers. Verify headless-origin, browser API and plugin-document access tests. |
| `components/settings/chatgpt-connection.tsx`, `finishSignIn` and `AccountDialog` | Retain remote callback completion, generation ownership and consent handling alongside upstream interaction layers and dialog focus. Verify connection UI and authentication tests. |
| `components/`, `app/layout.tsx`, `src/core/keyboard.ts` | Keep upstream component owners, image/plugin support, themes, focus and source organisation. Apply the fork's copy and label casing to the resulting controls. Keep the owner wordmark and reduced motion. Render tests follow current component behaviour. |
| `scripts/smoke-server.mjs`, `main` | Retain upstream plugin and relocated-payload probes. Run shutdown verification against the selected standalone directory, including isolated mode. Windows cannot establish POSIX shutdown. |

The fork requires SDK metadata and account advertisement for every ChatGPT model.
There is no release-lag Terra metadata entry.
Side-conversation delivery accepts current append-only update entries; the obsolete snapshot reader and field are removed.
These changes do not migrate old records.

The Docker build uses Node 26, prepares upstream source plugins and includes the explicit SDK/authoring inputs.
Tracked example `dist/` inputs remain available to the authoring bundle; generated local plugin outputs and dependencies stay outside the build context.
The final image contains a bounded renderer check and the existing shutdown check, documented in [Headless Docker Server](headless.md#build-and-run).
`esbuild` is a declared development dependency for bundling the renderer check; its version matches the existing lockfile entry.

## Validation: 0.6.1

Source checked on 15 November 2026: `6ae01bd12e6d994d597cc4491fd14d5e977d1c2f`.
The native Linux copy matched all 1,272 indexed source files and the source tree `4952dcbfa01350068c877cf9824ab7ab05f7ea88`.
Linux checks used Node 26.8.2 and npm 11.19.1 from the existing managed environment's lockfile.

| Check | Result |
| --- | --- |
| Full Linux Suite | 5,350 passed, four skipped, zero failures. The skips cover Windows semantics and case-insensitive filesystem fixtures. |
| Final Source, Origin and Read Checks | 111 passed, three filesystem/platform skips, zero failures. |
| Separate Plugin Suites | 388 passed across coding questions, drawing pad, flashcards, rich code blocks and UI Showcase. |
| Type Checking and Lint | Passed. Lint retains the upstream `source-name-ui.test.tsx` fixture warning about its synthetic `<head>` element. |
| Linux Production Build | Passed, including TypeScript and static page generation. |
| Provider and Image Payloads | Native provider initialisation and Photon resizing in process and in the worker passed offline, with zero external network attempts. |
| Isolated Standalone Server | Passed outside the source checkout, including core-plugin activation/assets/storage and external-plugin lifecycle checks. |
| Shutdown | Open notification streams and queued provider requests both settled without a forced kill. |
| Native PDF/SVG Rendering | Passed in the Linux test suite. |
| Final Docker Image and Chromium | Prepared, but unexecuted because no Docker CLI/builder was available. Run the image checks in the headless guide before deployment qualification. |

Turbopack emitted two broad-trace warnings in existing browser-helper/PDF paths.
The curated standalone payload excluded Git metadata, private root state and source-plugin projects, and passed the isolated import/runtime checks.
Windows full-suite qualification remains open: its initial run exposed POSIX/path/line-ending assumptions and synthetic file-replacement failures.
The Linux results do not establish Windows runtime acceptance.

The pinned dependency tree's audit reported 22 vulnerable dependency entries: three critical, eight high and 11 moderate.
Those dependency advisories remain unresolved by this merge.
These source and offline runtime checks do not establish real sign-in, provider entitlement, Docker signal handling or live deployment acceptance.

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
