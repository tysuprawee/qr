# Real inference worker

This is a private HTTP adapter for the official [SAM 3D Objects](https://github.com/facebookresearch/sam-3d-objects) `Inference(image, mask)` API. It returns the upstream mesh's GLB export. It does not reconstruct from multiple views, supply metric scale, or substitute a demo asset.

1. On a Linux CUDA GPU host, follow the upstream [installation and checkpoint access instructions](https://github.com/facebookresearch/sam-3d-objects/blob/main/doc/setup.md), including its model license. Use the upstream supported environment; the web application's npm install does not install SAM.
2. Install this directory's `requirements.txt` in that environment.
3. Set `SAM3D_ROOT` to the upstream checkout and `SAM_WORKER_TOKEN` to a random secret of at least 32 characters. Keep the same token only in the Node server's environment.
4. Start from this directory: `uvicorn app:app --host 127.0.0.1 --port 8000 --workers 1`.
5. Set the web server's `SAM_WORKER_URL=http://127.0.0.1:8000/reconstruct` and `SAM_WORKER_TOKEN`, then restart it. If GPU and web services are on separate machines, use an authenticated private TLS network.

The Node service sends multipart fields `image` (metadata-stripped JPEG) and `mask` (white foreground, black background PNG at matching resolution), and a server-only Bearer header. The worker returns binary `model/gltf-binary` or a non-2xx failure. The Node service publishes stages over WebSockets; it does not invent a percentage for an opaque GPU call.

The upstream GLB postprocessor already rotates geometry to Y-up. Estimated geometry is bottom-centered by the editor and resized to the user's confirmed width/height/depth. Automatic pose alignment between independently captured furniture and a RoomPlan room is deliberately not assumed.

One GPU call runs at a time. The web service times out at 10 minutes and discards revoked results. A disconnected HTTP request does not interrupt an already executing CUDA kernel; run the worker in a supervised process with an infrastructure-level execution deadline if hard cancellation is required. Input bytes live in memory and framework temporary upload files are closed after each request. Do not enable request-body logging. Put a 17 MB request-body limit and authentication at the private ingress too: FastAPI parses multipart input before endpoint authentication.

Validation status: adapter source supplied and HTTP contract tested with a synthetic test fixture. Real model weights/GPU execution have not been verified in this Windows environment. The test fixture is confined to `tests/` and is not reachable from the app.
