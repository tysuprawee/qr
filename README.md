# RoomShift

A web room editor with QR-paired mobile furniture and room-reference capture. The phone is the primary camera. No desktop webcam or Raspberry Pi integration is included.

## Run the desktop editor

Node.js 22.13+ is required.

```powershell
npm.cmd install
npm.cmd run dev
```

Open **http://localhost:3000**. The sample room contains explicitly labeled demo furniture. Select an object and use the scene handles or sidebar fields to move, rotate, and resize it. `G` selects move, `R` rotate, Delete removes the selection. Room projects and imported assets are saved to this browser's IndexedDB. Export a room JSON backup to move devices. Private capture photos are never included in project exports.

For a production build:

```powershell
npm.cmd run build
$env:NODE_ENV = 'production'
npm.cmd start
```

The build uses Vite's native config loader because the Windows sandbox cannot traverse parent directories for esbuild's config discovery. Runtime production dependencies do not include Vite.

## Use a real iPhone

`localhost` on a phone means the phone, not the desktop. A trusted, phone-reachable HTTPS deployment is required for this workflow. Do not use a bare LAN HTTP address or bypass a certificate warning.

Deploy the Node service on a host with a DNS name and TLS reverse proxy. A ready-to-edit `Caddyfile` and `Dockerfile` are included. Configure `.env` from `.env.example`:

```dotenv
PUBLIC_ORIGIN=https://your-roomshift-host.example
PORT=3000
HOST=127.0.0.1
TRUST_PROXY=1
```

Use your actual hostname. `PUBLIC_ORIGIN` must exactly match the URL used by both desktop and phone, with no trailing slash. Caddy must run on the same host for the supplied proxy address; set `ROOMSHIFT_DOMAIN` in its environment, configure DNS, and allow HTTPS traffic. Keep the Node port private. The proxy must forward WebSocket upgrades and permit requests up to 9 MB. A trusted HTTPS tunnel to port 3000 is another development option; set `PUBLIC_ORIGIN` to that tunnel origin and restart. This project does not create a tunnel, buy a domain, or publish a deployment automatically.

For direct TLS, set `TLS_CERT` and `TLS_KEY` to existing trusted certificate files and use `HOST=0.0.0.0`. The iPhone must trust the issuing CA and reach the hostname in that certificate. Certificate provisioning remains deployment-specific.

1. Open the HTTPS editor on the desktop and click **Scan with Phone**.
2. Scan the QR code with the iPhone Camera app, or open `/capture` and enter the eight-character pairing code.
3. Request pairing. Match the six-digit verification number and **Approve phone** on the desktop.
4. Tap **Open rear camera**. Permission is requested only now. If permission is denied, use the photo picker. JPEG/PNG/WebP are supported; convert HEIC to JPEG if the picker does not do so.
5. Photograph the chair from several angles. Preview, retake, select, or delete photos; upload selected photos.
6. Desktop Captures updates via WebSockets without refresh. Reconnection receives a full snapshot.
7. Choose a furniture photo and outline the object. Submit the image and polygon mask to SAM 3D Objects.
8. If a configured inference worker succeeds, preview the GLB, enter measured dimensions, confirm scale, and add it to the room. It immediately appears in the library and is selected in the scene.
9. Move and rotate it with the handles or numeric controls.
10. If inference is unavailable, the app shows the actual failed state. **Import demo chair** is an explicit separate action, labeled as a demo in the preview, library, and inspector. It never replaces an inference result silently.

## Inference

Real SAM inference needs a separate CUDA GPU environment, model access, and weights. See [the worker setup](workers/sam3d/README.md). Set `SAM_WORKER_URL` and `SAM_WORKER_TOKEN` only on the Node server; these are never put in the QR code or browser.

The UI accepts multiple reference views, but the current official single-object pipeline receives one chosen image plus one mask. It is not multi-view photogrammetry. Reconstruction dimensions are uncertain until a user confirms them. The upstream mesh is packaged as self-contained GLB; Gaussian-only or malformed output fails instead of being presented as usable furniture. The worker adapter has not been GPU-tested here.

## Room capture

**Phase 1:** Room Scan on the phone captures reference photographs. Browser photos do not create metrically accurate 3D room scans. Enter measured width, length, and height in the editor. Import a self-contained GLB room model, a RoomShift project, or a normalized layout JSON. Try [the synthetic layout example](examples/room-layout.json). Room GLBs use the same preview and dimension-confirmation flow as other imported models.

**Phase 2:** [RoomShiftRoomPlan](native/RoomShiftRoomPlan/README.md) is an isolated Swift package for a native LiDAR iOS companion. It exports USDZ, original CapturedRoom metadata, and web-compatible normalized layout JSON. The editor imports walls, doors, windows, openings, dimensions, and wireframe object-location references. Coordinates are right-handed Y-up, meters, with the floor centered at the origin. The alignment dialog moves/rotates imported geometry and references together. Furniture captures are independently dimension-confirmed and manually aligned. This package requires Xcode signing, compilation, and LiDAR-device validation; it is not a shipped iOS app.

## Privacy and service boundaries

- 256-bit random invitations live in URL fragments, so they do not enter HTTP request URLs, server access logs, or referrer headers. Invitations expire after 10 minutes and become unusable after approval. The human code is independently random and rate-limited.
- A desktop HttpOnly, SameSite cookie owns each session. The phone receives a separate HttpOnly, SameSite cookie; approval gates access to photos and uploads. Cookies are Secure on HTTPS. Exact-origin checks protect mutations and WebSocket handshakes.
- A desktop approves only after comparing a phone's verification number. Approving one phone rejects other pending phones. Disconnect immediately revokes that phone; **End session & delete captures** revokes access and deletes all session data.
- Maximum 8 MB per uploaded photo, 24 photos per session, 24 megapixels before decoding, and 32 MB per GLB. Image bytes are decoded, re-encoded, and stripped of metadata; MIME claims alone are insufficient. SVG, animated images, and external GLB resource URLs are rejected.
- Images stay in bounded server memory. Unused images expire after 30 minutes. A successful reconstruction removes its source image. Sessions and their server assets expire after one hour, on explicit deletion, or on restart. Browser-local imported assets persist in the user's project; no private source photo is copied to IndexedDB.
- Deployment is intentionally a single Node process with ephemeral capture state. Multiple replicas need shared session/auth state, ephemeral object storage with expiry, and pub/sub or a room coordinator for WebSocket fan-out. There is no account system or multi-user project sharing in this first version; do not place an unrestricted GPU service on a public network. Add an outer identity/quota layer for production-scale access.
- Worker HTTP cancellation discards results but cannot forcibly interrupt a CUDA kernel. Do not log upload bodies; configure private worker ingress limits and retention.

## Verification

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

The browser configuration uses installed Microsoft Edge. Change its channel or install a Playwright browser on other platforms. The end-to-end tests use distinct desktop and phone browser contexts and simulated camera frames. They cover approval, camera interaction, uploads, WebSocket synchronization, inference failure, explicit demo import, object movement/rotation, persistence, room references, and deletion. Transport contract tests use a clearly synthetic GLB fixture under `tests/`; it is not accessible through the production inference path.

The local tests do **not** prove a physical iPhone scan, public HTTPS deployment, actual GPU inference quality, or native LiDAR accuracy. Follow [the device acceptance checklist](docs/acceptance.md) on deployment.

## Code map

| Location | Responsibility |
| --- | --- |
| `server/capture.js` | Session lifecycle, approval, WebSockets, uploads, masking, inference adapter |
| `src/mobile.js` | Phone pairing, camera, photo review, uploads, status |
| `src/editor.js` | Desktop pairing, library, masking, scale confirmation, import/export |
| `src/scene.js` | Three.js scene, transforms, room primitives and GLB preview |
| `workers/sam3d/` | Optional real GPU worker |
| `native/RoomShiftRoomPlan/` | Separate Phase 2 native module |

Sources: [SAM 3D Objects](https://github.com/facebookresearch/sam-3d-objects), [its GLB postprocessor](https://github.com/facebookresearch/sam-3d-objects/blob/main/sam3d_objects/model/backbone/tdfy_dit/utils/postprocessing_utils.py), and [Apple RoomPlan](https://developer.apple.com/documentation/roomplan).
