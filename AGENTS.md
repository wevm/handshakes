# Adapted from wevm/ondine

Source: https://github.com/wevm/ondine/blob/main/AGENTS.md
Source commit: `0b589ec34481856b4153526f10a0a35558a201a8`. Retrieved 2026-10-23. Ondine adapts the guidelines of `wevm/zyzz`. General TypeScript, module, testing, prose, and Git conventions are retained. Project principles, security, documentation, layout, and commands are adapted for Handshakes.

# Agent Guidelines

## Project Principles

- Handshakes is an OAuth client library and CLI. It replaces stored API keys with short-lived access tokens: in CI and on servers through the RFC 8693 token exchange of a platform OIDC token, and on a laptop through the RFC 8628 device authorization grant.
- Handshakes covers three roles: the client (`handshakes`, `handshakes/node`, the CLI), the authorization server (`Server` in `handshakes/server`), and the API (`Resource` in `handshakes/server`). Stay general purpose. Never add code for one product or one deployment.
- The client calls only standard endpoints (RFC 8414, 8628, 6749 refresh, 7009, 8693, 8707, 9728) and uses their terms: `authorize`, `revoke`, grant, subject token, issuer, resource.
- `Server` implements only the RFC 8693 token endpoint and its metadata, as a fetch handler. The host issues the credential through `issue`. `Server` stores no tokens and runs no device grant, consent, or client registration.
- `Resource` verifies the tokens that an API receives, and serves RFC 9728 metadata and the `401` challenge.
- `handshakes/better-auth` adapts `Server` to `@better-auth/oauth-provider` through `extendOAuthProvider`. It extends Better Auth and never replaces a Better Auth feature.
- `Client` and the CLI resolve an access token in one order: a cached token, an exchange of a detected subject token, a refresh of a stored grant, an interactive device grant, then `Client.AuthorizationRequiredError`. Change this order only in `.agent/plans/handshakes.md` first.
- A detected source that fails throws. Never fall through to the next source, since that can select a different identity.
- Keep `handshakes` and `handshakes/server` free of dependencies and of Node built-ins, so they run in Node, Bun, Deno, and edge runtimes. Verify signatures with WebCrypto. File system and child process code lives in `handshakes/node`.
- `.agent/plans/handshakes.md` defines the public API, the phases, and the acceptance gates. Update it in the same change as an API decision.

## Security Conventions

- Token values (subject tokens, access tokens, refresh tokens, device codes, client secrets) never appear in errors, logs, `status`, MCP output, or snapshots. Only `token()`, `Identity.token()`, and the CLI `token` command return one.
- Require an explicit audience for every subject token. A token for one service never reaches another.
- Decode, but never trust, the claims of a token on the client. Claims serve logs and errors only.
- The client verifies a fixed-audience token's `aud` before it sends the token.
- `Server` and `Resource` accept RS256 and ES256 only, match `iss` and `aud` exactly, and match policies on identifiers that cannot change, such as `repository_id` and `project_id`, never on names.
- Never issue a token that outlives the subject token it replaces.
- `Store.file` of `handshakes/node` writes with mode 0600, writes atomically, and refreshes under a lock that covers every process. A reused refresh token can revoke every grant of the client and user.
- Never read a client secret from argv. Read it from an environment variable that the caller names.
- Compare secrets in constant time on the server.

## TypeScript Conventions

- Treat `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` as design constraints. Include `| undefined` when an optional property can explicitly receive `undefined`, and narrow indexed reads before use.
- Use `readonly T[]` for array types. Preserve mutable arrays only when mutation is part of the contract.
- Use `type` for project-owned shapes. Use `interface` only when declaration merging or an external ambient contract requires it.
- Include `.js` extensions on relative imports and exports so source remains valid under NodeNext ESM.
- Author every source file and script in TypeScript. `.js` files are banned. Node runs TypeScript natively (`node script.ts`), so scripts need no build step.
- Import module-shaped internal files as namespaces (`import * as Store from './Store.js'`) and access members through the module name. Named imports are fine for types, leaf helpers, command handlers, and third-party APIs that are not module namespaces.
- Import Node built-ins as namespaces unless the neighboring code or API is clearer with a named import.
- Re-export public module files as namespaces (`export * as Store from './Store.js'`). Avoid flattening sibling-module symbols into a barrel.
- Use static imports. Reserve dynamic imports for a real runtime or bundle boundary, not dependency-cycle workarounds.
- Use `import type` and `export type` where an import or export is type-only.
- Use functions and plain data for normal APIs. Classes are limited to errors and framework-required entrypoints.
- Keep error classes in the module that throws them, ordered alphabetically with its public exports. Set custom error `name` values to the namespaced form, such as `Client.AuthorizationRequiredError`.
- Use unions or `as const` objects instead of enums.
- Prefer `camelCase` constants. Preserve uppercase names only when they mirror an external protocol or established neighboring code.
- Use `const` generic parameters when callers should retain literal or tuple types.
- Default optional option bags in the signature (`options: fn.Options = {}`), not with `options?: fn.Options` and downstream fallback logic.
- Name typed option bags `options`. Use a domain noun only when the value is not an options bag.
- Prefer one named object parameter over several positional parameters. An instance-like receiver such as `client` or `store` may be the first positional parameter, followed by an options bag.
- Put a function's parameter, return, and error types in a matching `declare namespace` (`create.Options`, `create.ReturnType`, `create.ErrorType`). Keep a sibling exported type only when several functions share the domain type.
- Avoid inline object types on local variables. When an explicit local object type improves clarity, name it directly above the use.
- Do not extract a named type until it is reused or makes a difficult shape materially easier to read.
- Keep shared domain types beside the module that owns the concept.
- Group a module's Zod schemas in a `schema` namespace, and derive their types beside them (`schema.Metadata`). Export the namespace only when another module validates against the same shape.
- Let declared return types constrain intermediate expressions. Avoid redundant local annotations.
- Return values directly unless a binding is reused or gives a complex expression a useful name.
- Prefer immediately invoked function expressions (IIFEs) with explicit branches and early returns over nested or complex ternary expressions. Keep simple two-way ternaries when both branches are easy to scan. This applies to executable code, not TypeScript conditional types.
- For a fallible local derivation, prefer an IIFE expression over a mutable variable assigned across `try` and `catch` blocks.
- Never destructure parameters in function definitions, including arrow functions, callbacks, and methods. Accept a named parameter and destructure inside the body when reading several properties. When normalizing one field, read `options.field` directly instead of creating a second name.
- Prefer short names whose meaning is clear from local context, such as `options`, `client`, `entry`, and `fn`.
- Keep wire formats, ordered tuples, protocol fields, and other order-sensitive shapes explicit. Do not alphabetize data whose order has meaning. OAuth form fields keep their RFC names, such as `subject_token`, at the wire boundary only.
- Avoid new `any`. Use a precise boundary type, validation, narrowing, or the smallest justified assertion.
- Express times as `expiresAt` in milliseconds since the epoch. Convert `expires_in` seconds at the wire boundary.
- Separate distinct contexts and logical steps with one blank line in every maintained module, including source, adapters, scripts, and test fixtures. Group setup, guard clauses, derivation, mutation or emission, and final returns so each step is easy to scan.
- Keep a lookup with its immediate guard, related local declarations, and consecutive assertions together. Separate independent branches, loops, local helper functions, and the work following a completed control-flow block. Avoid both dense uninterrupted logic and a blank line after every statement.
- Separate test setup, execution, and assertions. Keep each assertion group beside the operation it verifies. Preserve spacing inside generated source strings, snapshots, and other whitespace-sensitive fixtures.
- Audit logical spacing when adding or editing a module, since formatting tools do not infer context boundaries. Review the surrounding function as well as the changed lines, and keep spacing-only edits free of behavior changes.
- Do not use section-divider comments. Use exports, TSDoc, and whitespace to express module structure.
- Comment invariants and non-obvious reasons, not line-by-line mechanics. Keep comments independent of plans, task IDs, and prior versions.

## Alphabetical Ordering

- Alphabetize imports, named import/export specifiers, public exports, type/interface properties, object properties, enum/union members, unordered lists, configuration maps, scripts, and dependencies. Use case-insensitive lexical order consistently.
- Keep attached documentation with the declaration or property it describes. Keep function overloads and their namespace together. Order local declarations alphabetically within dependency-compatible groups. Do not introduce use-before-initialization or reorder execution.
- Preserve order with observable semantics: source priority (`Source.defaults`), the resolution order, tuples, package file inclusions followed by exclusions, workflow steps, test aliases, and regression fixtures testing those orders. Mark intentional exceptions in nearby documentation or comments.
- Keep `name` and `on` first in GitHub workflows, and alphabetize the remaining top-level keys. Preserve the scaffold package.json group order around `[!start-pkg]`, and alphabetize entries within each group. Do not alphabetize prose sections or sequential implementation phases mechanically.

## Module and Instance Conventions

- Organize each module file as one conceptual namespace containing its public types, constants, functions, and errors. Consumers should read calls as `Module.operation(...)`.
- Prefer stateless module functions for pure behavior. Do not create an instance when inputs fully describe the operation.
- When behavior needs dependencies or lifecycle state, expose a factory such as `Client.create(options)` that returns a plain object of operations and data.
- Construct instances explicitly at the application boundary and pass them down. Do not hide construction in imports or module-scope singletons.
- Scope an instance to the lifecycle that owns its state, such as one CLI run, one serverless instance, or one test. Do not share mutable state more broadly than required.
- Inject environment-specific capabilities through factory options: `env`, `fetch`, and `store`. Read `process.env` and `globalThis.fetch` only as defaults at that boundary, so tests inject them and nothing stubs a global.
- Type dependencies by the smallest capability the module consumes, not by the concrete SDK client. This keeps adapters interchangeable without wrapper classes.
- Let factory operations close over shared dependencies and state. Do not return methods that depend on `this` or require binding.
- Name the returned public shape after its role (`Client`, `Store`, `Source`) when that role is meaningful. Use `create.ReturnType` for a factory-specific shape that has no independent domain name.
- Keep one authoritative instance value. Derive related helpers and views from that instance instead of duplicating configuration or state.
- Keep mutable caches private to the instance. Expose explicit operations, such as `invalidate`, and provide reset or disposal only when the lifecycle requires it.
- Avoid side-effect registration. `sideEffects: false` means an import used only to install global behavior can disappear from a bundle.
- Keep default implementations directly reachable from the factory or resolver that selects them so bundlers can tree-shake unused paths.
- Keep request building, response parsing, and policy matching pure. Put file system, process, and network behavior in thin adapters around that core.
- Keep internal helpers under `internal/` and export them only when another module has a real contract with them.
- Add new public modules through the owning entrypoint as documented namespace exports. Keep the public surface lean and derive values that the library already knows.

## Type Inference Conventions

- Preserve literal inputs through public helpers when those literals affect the output type.
- Keep generic types flowing from inputs through callbacks and return values. Do not erase them to `any` at an internal seam.
- Prevent public callbacks, options, and return values from leaking `any`.
- Add consumer `.test-d.ts` fixtures beside their owning module (for example, `src/Client.test-d.ts`) with `expectTypeOf` and expected compiler errors when public inference or narrowing changes. Import public entrypoints, and make sure TypeScript checks the fixtures.
- Revisit inference after changing an API. Prefer a narrower useful contract over a broad type that merely compiles.

## Abstraction Conventions

- Start with concrete code and extract only after repeated uses reveal a stable shared contract.
- Prefer small local duplication over an abstraction that adds flags, modes, or call-site-specific branches.
- Wait for at least three concrete uses before introducing a general abstraction unless a hard boundary already exists.
- Optimize for code that is easy to change, not maximum DRYness.
- Keep authoritative state, configuration, schemas, and constants in one place. Derive dependent values.
- Avoid wrappers that only rename another function or mirror an SDK without narrowing capabilities or adding a domain contract. Do not reimplement what Better Auth already provides.

## Code Documentation

- Start every maintained TypeScript module with a brief standalone TSDoc `@module` comment describing its responsibility. Place it before imports, or after a required shebang. Include entrypoints, internal modules, tooling, fixtures, integration tests, and type fixtures. Describe the module rather than repeating its filename. Keep export-level TSDoc separately.
- Add TSDoc to every public export and public type property. Write or update the contract documentation alongside the implementation.
- Document caller-visible purpose, inputs, output, defaults, errors, and side effects. Name the RFC and section that a behavior follows. Keep low-level wiring in nearby implementation comments.
- Update the owning entrypoint documentation when adding or changing a public module.

## Writing Documentation

Applies to the README, guides, and other Markdown documentation. Prose Conventions also apply.

- Write for developers who know HTTP and have used an API key. Define OAuth terms at first use, and use the RFC term everywhere after.
- Explain behavior through a request, its response, and the code that sends it.
- Keep guides platform-neutral. When setup differs by platform, such as GitHub Actions or Vercel, show every platform.
- Organize each guide into Overview, Walkthrough, Recipes, and More sections. Give each platform and each test target a guide.
- Keep each paragraph to one idea in about 40 words, and at most three paragraphs per section.
- Use bullets for enumerable content and tables for comparisons. Start each item of a topic list with a bold label that ends in a colon.
- Write headings in Title Case with fewer than four words.
- Give every code block at least one comment. Formats without comments, such as JSON and HTTP, are exempt.
- Mark unimplemented APIs with `> [!NOTE]` callouts. Examples must not imply that they already work.

## Prose Conventions

Applies to documentation, comments, TSDoc, interface copy, commit messages, and pull requests.

- Write about the code, not about the person using it. Avoid second person outside interface copy.
- Describe behavior in technical terms rather than by the experience it produces.
- Write formally, concisely, and technically. Use precise verbs such as "returns", "requests", "issues", "exchanges", "revokes", "rejects", and "throws", not conversational ones such as "hands", "gets", "gives", "sees", "knows", "says", or "tells".
- State an invariant or a reason the code cannot show on its own. Leave out justification the code already makes plain.
- Write close to ASD-STE100 Simplified Technical English. Apply its writing rules below, but not its full dictionary.
- Use the short, common word: "use", "start", "before", "about", "make sure", not "utilize", "commence", "prior to", "approximately", "ensure". Technical names and OAuth terms, such as "grant", "issuer", and "subject token", are always valid.
- Use one word for one thing, and give each word one meaning and one part of speech. Do not use a synonym for variety.
- Keep an instruction to 20 words or fewer, and a descriptive sentence to 25 words or fewer. Give one instruction in each sentence, unless the actions occur at the same time.
- Keep each paragraph to one topic and six sentences or fewer. Use a vertical list for sequential steps or several conditions.
- Put a condition before the instruction it controls: "If the grant expires, run `handshakes authorize` again."
- Use the active voice in instructions. Use the passive voice in descriptions only when the agent is unknown or not important.
- Use the imperative, simple present, simple past, and simple future. Do not use a progressive (`-ing`) or perfect form as the main verb. An `-ing` word in a technical name, such as "signing key", is valid.
- Do not stack more than three nouns, except in a technical name. Break a longer cluster with a preposition.
- Do not leave out "the", "a", or "this" to make a sentence shorter.
- Start sentences in different ways, but keep each sentence simple.
- Use a diagram, not prose, to show a flow or how components connect, and keep it to about 12 nodes. Use a Mermaid `sequenceDiagram` for requests between participants. Use a table, not a paragraph, to compare options or map inputs to outputs.
- Do not use semicolons or em dashes in prose. Split the sentence, or use a comma, colon, or parenthesis. Semicolons remain valid inside code.
- Keep PR titles and bodies short and concrete. Explain the problem and resulting behavior in a few sentences, include one small example, and add one validation line.

## Testing Conventions

- Keep one runtime test file per module (`Module.test.ts`) and one type-test file (`Module.test-d.ts`). Express contexts with named `describe` blocks inside those files. Do not create `Module.context.test.ts`. Scope context-specific fixtures and lifecycle hooks to their `describe` block.
- Encapsulate every `.test-d.ts` assertion and expected compiler error in a named `test` inside a `describe` for the public function.
- Group tests in a `describe` named after the public function under test, such as `describe('create')`. These groups exercise complete integration flows, not isolated function implementations.
- Runtime coverage is integration-only. Do not write unit tests, private-helper tests, or per-function suites disguised as integration tests.
- Colocate integration suites and consumer type fixtures with their owning module: `Client.test.ts` and `Client.test-d.ts` beside `Client.ts`. Keep the shared harness under `test/`.
- No mocking, stubbing, fake implementations, module replacements, fake timers, or stubbed globals. Run every flow against a real server or platform:
  - **Authorization server:** `Server` behind a local HTTP server, and `test/Server.ts`, a local Better Auth server with `oauthProvider`, `oauthDeviceAuthorization`, and `jwt`, on a random port with its own in-memory database.
  - **Subject tokens:** the `handshakes/test` issuer, which signs real tokens and serves the endpoints that platform sources call. Pass its `env()` to the source.
  - **Platforms:** a GitHub Actions job with `id-token: write`, and a Vercel preview.
  - **Processes:** the built CLI, and several processes that share one `Store.file` of `handshakes/node` for lock and refresh races.
- Approve a device code through the server's own approval endpoint as a signed-in test user. Never write a grant into the database directly.
- Cover complete supported flows as they land. Before a later stage exists, test the real available public boundary, and do not fabricate a downstream stage.
- Exclude colocated tests and type fixtures from published files and build outputs.
- Snapshot values and results individually. Do not assemble unrelated values into an object or array only to combine snapshot assertions.
- Assert observable runtime results and public diagnostics with inline snapshots (`toMatchInlineSnapshot` or `toThrowErrorMatchingInlineSnapshot`). Pass property matchers for genuinely nondeterministic fields, such as ports, times, and token values. Review generated snapshots before accepting them. Never derive expected output from the implementation under test.
- Assert that no snapshot holds a token value. Replace a token with a property matcher, never with a recorded value.
- Add an integration regression scenario for every bug fix.
- Use bounded waits for observable conditions, isolate real resources, and clean them up after success or failure. Do not hide flakes with arbitrary sleeps or retries.

## Workflow Conventions

- Use the smallest repository script that covers the changed behavior. Run focused tests while iterating.
- Run `pnpm check:types` after TypeScript changes.
- `pnpm check` runs formatting and syntax-only lint with fixes. Run `pnpm check:types` separately for type checks. Inspect and keep only task-related changes.
- Run `git diff --check` and inspect the final diff before reporting completion.

## Git Conventions

- Conventional commits, lowercase, no trailing period: `feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `test:`, `chore:`. Scope optional.
- Name the thing that changed, in the identifiers the codebase already uses. Prefer `feat: add Client.revoke` over `feat: let users sign out`.
- State the change, not the reason for it. Leave `because`, `so that`, and `in order to` out of the subject.
- Write each message to stand alone for a reader who has not seen the pull request or the task that produced it.
- Never force push and never amend a pushed commit. Correct a mistake with a follow-up commit.
- Always commit and push directly to `main`. Never create or push to another branch, and never open a pull request.

## Repository Layout

- `src/`: flat PascalCase modules of the core entry, with colocated tests. `src/index.ts` re-exports them as namespaces.
- `src/better-auth/`, `src/node/`, `src/server/`, `src/test/`: the `handshakes/better-auth`, `handshakes/node`, `handshakes/server`, and `handshakes/test` entries.
- `src/cli/`: the incur CLI. `bin.ts` is the entry, and each command lives in its own file.
- `src/internal/`: helpers that no entry exports.
- `test/`: the shared harness, such as `test/Server.ts`.
- `.agent/plans/handshakes.md`: the plan, the public API, and the acceptance gate of each phase.

## Tooling

- Declare all package dependencies with `catalog:` references. Keep versions in `pnpm-workspace.yaml`, never inline in package manifests.
- Prettier is banned. Use Vite Plus with oxfmt for formatting and oxlint for linting, configured in `vite.config.ts`.
- Use zile for library builds and development linking.
- Put scripts, devDependencies, and packageManager before `[!start-pkg]` in package.json. Package metadata and runtime dependencies follow it. Alphabetize entries within each group.
- Use the single scaffold tsconfig.json. Zile derives build inputs from package entrypoints. Add each entry to `paths` in `tsconfig.json` and to the test aliases in `vite.config.ts`.
- `incur` is the one runtime dependency, for the CLI. Better Auth packages are optional peers.

## Commands

- `pnpm build` builds the package with zile. `pnpm dev` links source entrypoints with `zile dev`.
- `pnpm check` runs `vp check --fix`. `pnpm check:types` runs TypeScript.
- `pnpm test` runs the integration suites with `vp test`.
- `node src/cli/bin.ts` runs the CLI from source while it imports only dependencies. The CLI test bundles it with esbuild.
