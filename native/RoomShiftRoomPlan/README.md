# Phase 2: native RoomPlan module

This separate Swift package supplies a UIKit scanning controller and a normalized layout exporter for iOS 17+ LiDAR devices. The main RoomShift editor remains web-based. Source is provided; this module has not been compiled, signed, or device-tested on this Windows machine.

Add this local package to an iOS app target in Xcode on a Mac. Add `NSCameraUsageDescription` to the host app's Info.plist, explaining that the camera and LiDAR scan the user's room. Present `RoomScanViewController()` inside a navigation controller after the user chooses Room Scan. The controller requests permission only when **Start room scan** is tapped and gates the experience with `RoomCaptureSession.isSupported`.

Exports are shared through the system share sheet:

- `roomshift-layout.json`: normalized meters, right-handed Y-up, room floor centered at the origin. Import this using the web editor's **Import room** action.
- `room.usdz`: Apple's parametric room geometry. Keep for native/AR use or convert to a self-contained GLB offline for web model import; the web editor does not pretend to support USDZ directly.
- `roomplan-original.json`: original structured CapturedRoom metadata, preserving confidence, categories, transforms, and dimensions for future importers.

All normalized elements also retain their original column-major transform. The initial web renderer uses upright surface boxes and yaw, with doors/windows/openings overlaid as distinct surfaces; it is not a watertight CAD reconstruction. Detected objects are wireframe location references, never reconstructed furniture. The web alignment dialog applies a planar rigid transform to the scanned surfaces and locations together. Independently reconstructed furniture is dimension-confirmed, bottom-centered, and manually aligned; there is no shared camera coordinate frame between independent photo captures and a native scan.

Temporary native export files are removed when sharing completes or the controller is dismissed. The host app should also clear orphaned `RoomShift-*` temporary exports on startup after a crash. No photo library export, background upload, persistent token, or Raspberry Pi integration is included. A future native pairing client can use the same approval service; Phase 2 currently transfers files through the share sheet.

Device validation still required: denied camera access, unsupported devices, interrupted scans, LiDAR scans with windows/doors, portrait/landscape, share cancellation, floor alignment, dimensions against a tape measure, and furniture alignment after import.

References: [RoomCaptureSession](https://developer.apple.com/documentation/roomplan/roomcapturesession), [RoomCaptureViewDelegate](https://developer.apple.com/documentation/roomplan/roomcaptureviewdelegate), [CapturedRoom](https://developer.apple.com/documentation/roomplan/capturedroom).
