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

```sh
docker build --platform linux/amd64 -t learn-harness:headless .
docker save -o learn-harness-image.tar learn-harness:headless
```

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

Reference a file under `/data/sources` by its relative name in a message. For
example, an administrator can copy a PDF into the running container:

```sh
docker cp notes.pdf learn-harness:/data/sources/notes.pdf
```

File tools reject paths outside the study folder, including symlink escapes.
This restriction covers filesystem reads; it is not an operating-system sandbox
for generated demonstrations or a restriction on outbound web requests.

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
