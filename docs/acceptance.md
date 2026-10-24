# Device acceptance checklist

Automated local coverage is separate from this physical-device run. Do not mark this checklist complete solely because browser tests pass.

## HTTPS and pairing

- [ ] Desktop opens the configured HTTPS origin; the iPhone can reach the same origin with no certificate warning.
- [ ] Scan with Phone shows a locally generated QR, a fallback code, expiry, and connection status.
- [ ] iPhone Camera opens `/capture` with a temporary fragment invitation; the browser removes the fragment immediately.
- [ ] No camera permission prompt before tapping Open rear camera.
- [ ] Phone cannot upload or see session images before desktop approval.
- [ ] The verification numbers match; desktop approval activates capture.
- [ ] Fallback code works; expired/reused invitations fail.

## Chair capture and editing

- [ ] Open rear camera on iPhone Safari; photograph an actual chair from multiple angles.
- [ ] Preview, retake, deselect and delete local photos; upload the selection.
- [ ] Desktop shows the new photo automatically with no reload. Phone shows upload progress.
- [ ] Choose the clearest furniture view, outline the chair, and submit reconstruction.
- [ ] With a real SAM worker: running status is followed by a valid GLB preview. Confirm measured width, height and depth; add to library and scene; move and rotate.
- [ ] Without a worker: a real error appears on both devices. Demo import is an explicit separate action and remains marked DEMO.
- [ ] Reload the desktop and verify confirmed asset, corrected dimensions, and placement persist.
- [ ] Export/import the project and verify custom GLB, source labels and transforms survive.

## Room and failure cases

- [ ] Room Scan explicitly says reference photos are not metric 3D geometry.
- [ ] Manual room dimensions update the scene; layout JSON imports surfaces and object locations.
- [ ] Deny camera access, then choose a photo successfully.
- [ ] Test image decode rejection, file over 8 MB, HEIC guidance, network loss mid-upload, and retry.
- [ ] Restore network and confirm WebSocket snapshot catches up.
- [ ] Disconnect phone and verify uploads/photo reads fail. End session and verify captures are gone.
- [ ] Verify 10-minute invitation expiry, 30-minute photo expiry and one-hour session expiry.

## Native Phase 2 (requires a Mac and LiDAR device)

- [ ] Compile and sign the native package in an iOS host with camera usage description.
- [ ] Unsupported devices are clearly rejected.
- [ ] Scan a room with door and window; export USDZ and normalized JSON.
- [ ] Import normalized JSON; verify axes, floor origin, meters, openings and object reference positions.
- [ ] Compare dimensions to tape measurements and align independently reconstructed furniture.
- [ ] Test interruption, permission denial, export cancellation and temporary-file cleanup.
