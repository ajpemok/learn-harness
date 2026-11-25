# Headless Docker Server

This image runs the existing Next standalone server as a single user. It supports
ChatGPT, GitHub Copilot and Grok subscription connections in Settings > Providers.
The desktop transport remains unchanged. Profiles and draft synchronisation are
outside this first increment.

## Build and Run

Build and test the Linux image on a development machine, then transfer the
finished image to the server. Windows developers can use a Linux builder in WSL.
Keep the build cache off the deployment host and retain the previous runtime
image for rollback. Native PDF/SVG dependencies must match the target platform.
The image includes Chromium for demo checks; it starts only on demand.
Both image stages use Node 26, matching upstream's build environment.
The build prepares the locked source-plugin dependencies and stages the core plugin packages before Next builds the application.

```sh
docker build --platform linux/amd64 -t learn-harness:headless .
docker save -o learn-harness-image.tar learn-harness:headless
```

Before transferring the image, run its disposable renderer and shutdown checks:

```sh
docker run --rm --network none --entrypoint node learn-harness:headless \
  /app/src/agent/subagents/headless-image-check.mjs
docker run --rm --network none --entrypoint node learn-harness:headless \
  /app/scripts/smoke-shutdown-runtime.mjs /app
```

These commands retain the image's `node` user and use synthetic inputs and temporary state.
The renderer check bundles the production PDF/SVG/demo functions and loads the final image's native dependencies and `/usr/bin/chromium`.
It requires disabled container networking, checks opaque-origin execution and refuses local file reads.
The shutdown check runs the built server with synthetic credentials and blocked provider requests.
Neither check establishes real sign-in, provider entitlement or deployment access control.
The image build also runs `pdf-native-render.test.ts`, `pdf-ops.test.ts` and `svg-native-render.test.ts` on Linux, plus provider/image checks and isolated standalone checks.

Copy the archive to the deployment host, then load and run it:

```sh
docker load -i learn-harness-image.tar
docker run -d --name learn-harness --init --stop-timeout 45 \
  -p 127.0.0.1:3000:3000 \
  -v learn-harness-data:/data \
  learn-harness:headless
```

Open `http://localhost:3000` on the Docker host for a local check. The published
port listens on loopback. Remote access requires your existing authenticated
HTTPS proxy, such as Cloudflare Access and Tunnel, or a private HTTPS route.
Protect the entire application, including API, streaming and subscription routes.
There is no application password or multi-user account system in this image.

Run one container per data volume. Subscription refresh locking is process-local.
The image uses UID/GID 1000 (`node`). A named volume starts with the image's
directory ownership; a bind mount must already grant that user access. Do not
mount a host home folder or the Docker socket.

The Docker build context includes application inputs only. Local learning data,
credential files, environment files, old builds and Git history are excluded.
The existing standalone curation and smoke checks run during the image build.
Do not pass provider secrets as build arguments.

Notification streams close on `SIGTERM` or `SIGINT`, allowing Next's normal
request drain to finish. Stop only when learning turns and background work are
idle, and verify the exit status before taking a stopped-data backup.

## Persistent State

| Container Path | Purpose |
| --- | --- |
| `/data/state` | Chats, graph, settings, jobs and prompt overrides |
| `/data/auth` | API keys and subscription credentials, stored as private plaintext files |
| `/data/sources` | Study files available to the agent's filesystem tools |

Core plugin code stays in the image's `/app/core-plugins/` directory.
Core plugin records live under `/data/state/core-plugin-data/<id>/`; community plugin code and records use `/data/state/plugins/<id>/`.
Newly discovered plugins start disabled.

Reference a file under `/data/sources` by its relative name in a message. For
example, an administrator can copy a PDF into the running container:

```sh
docker cp notes.pdf learn-harness:/data/sources/notes.pdf
```

File tools reject paths outside the study folder, including symlink escapes.
Relative paths start in the study folder.
With the optional File Access restriction off, `ls` without a path lists that folder's contents.
With it on, `ls` lists the effective allowed-folder paths within the study folder; searches use those same roots.
An allowed parent folder grants only the study folder, an allowed child grants that child, and disjoint or unavailable roots grant no access.
Settings cannot widen the image's study-folder boundary, and sensitive-location denials still apply.
This restriction covers filesystem reads; it is not an operating-system sandbox
for generated demonstrations or a restriction on outbound web requests.

## Shared Provider Service

Two single-user instances can share one set of providers while keeping separate
lessons and files. Run `node provider-service.mjs` from the same image as a third
container. It owns the subscription credentials and the Claude Code sign-in.

| Container | Environment Variables | Mounts |
| --- | --- | --- |
| Service | `LH_PROVIDER_SERVICE_SOCKET`, `LH_PROVIDER_SERVICE_ADMIN_SOCKET`, `LH_PROVIDER_SERVICE_CREDENTIALS_DIR` | Credentials and both socket directories |
| Primary | `LH_PROVIDER_ROLE=primary`, `LH_PROVIDER_SOCKET`, `LH_PROVIDER_ADMIN_SOCKET` | Both socket directories and the key directory |
| Secondary | `LH_PROVIDER_ROLE=secondary`, `LH_PROVIDER_SOCKET` | Runtime socket directory, and the key directory read-only |

Both instances set `LH_AUTH_FILE` inside the key directory. Keys, model choices,
the Claude Code switch and any custom endpoint follow the primary, and the
secondary refuses changes to them. Anyone who can open either instance uses the
same subscriptions. An incomplete configuration stops the server from starting.
Check the service with `node provider-service.mjs --health`. Losing it disconnects
both instances until it returns.

## Remote ChatGPT Sign-In

1. Open Settings > Providers > ChatGPT and continue with ChatGPT. Allow the new
   sign-in tab if your browser blocks popups.
2. Complete the OpenAI sign-in. On a remote device, the final `127.0.0.1` page
   usually cannot load because the callback listener runs on the server.
3. Copy that page's full address. Return to Learn Harness, paste it into the
   pending ChatGPT dialog and choose **Finish sign-in**.
4. Select the connected account and configure your model slots. Background-use
   consent applies to the server's shared connection.

Treat the callback address as a temporary credential. Paste it only into your
Learn Harness sign-in dialog. It is checked against the pending loopback address,
state and one-use attempt; the original PKCE, nonce and identity checks still
apply. A cancelled, expired or completed attempt requires a new sign-in.

Copilot and Grok retain their existing device-code flows. A subscription failure
does not silently switch to API-key billing.

## HTTPS Proxy Configuration

Set `LH_PUBLIC_ORIGIN` to the exact external HTTPS origin, for example
`https://learn.example.com`, when the proxy terminates TLS before the HTTP backend.
Preserve that hostname in the backend `Host` header. Learn Harness uses the
configured origin for subscription controls and rejects mismatching hosts or
origins. It does not use forwarded headers to grant that trust.
Also set `LH_ALLOWED_HOSTS` to the external hostname, without its scheme or port.
The shared upstream API guard requires this explicit host admission, including for streamed plugin documents.

This setting does not authenticate users. Cloudflare Access policy, direct
backend bypass, streaming/reconnection and expired sessions must be checked on
the actual deployment. Keep live ingress and Compose configuration in the
existing infrastructure repository.

| Environment Variable | Image Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Internal HTTP port |
| `LH_DATA_DIR` | `/data/state` | Learning records |
| `LH_AUTH_FILE` | `/data/auth/auth.json` | API-key file; subscription files live beside it |
| `LH_SOURCES_DIR` | `/data/sources` | Canonical study-file boundary; desktop behaviour is unchanged when unset |
| `LH_PUBLIC_ORIGIN` | Unset | Approved external HTTPS origin |
| `LH_ALLOWED_HOSTS` | Unset | Explicit external hostnames admitted by the browser API guard |
| `CHROME_PATH` | `/usr/bin/chromium` | Browser used for on-demand demo checks |

## Operation and Acceptance

Use `docker logs --tail 100 learn-harness` and `docker inspect learn-harness` for
status. `/api/health` checks HTTP liveness without loading credentials or calling
a provider. It does not establish that sign-in or model use works.

Let active work settle before stopping for an update or backup. Docker forwards
SIGTERM to Node and allows 45 seconds for Next's drain. Existing job recovery runs
when sessions reopen after a restart. In-flight streams, interrupted work and
the actual Docker signal path require acceptance on the target host.

Back up the stopped volume with its permissions. Learning-data restoration and
credential recovery are separate operations: an old refresh token may already
have been rotated or revoked. Retain current compatible credentials when rolling
back an image; sign in again if credential recovery is required.

Before calling the deployment ready, verify remote sign-in, an actual
subscription-backed answer, saved credentials after restart, PDF/SVG/demo
rendering, stream reconnection, access denial and a representative restore.
Unit tests use synthetic authentication and cannot establish those live results.

The remote callback adaptation follows
[Razkaroth's callback commit](https://github.com/Razkaroth/learnharness/commit/3efa0862399374cb6d4291563517220c96afb475).
Its AppImage launcher and plain-HTTP navigation fallback are not part of this
Docker implementation.
