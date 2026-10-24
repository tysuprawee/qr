import UIKit
import AVFoundation
import RoomPlan

/// Present this controller from a user-initiated action in a signed iOS host app.
/// The host must provide NSCameraUsageDescription. No permanent credential is needed.
@MainActor
public final class RoomScanViewController: UIViewController, RoomCaptureViewDelegate {
    private var captureView: RoomCaptureView?
    private var result: CapturedRoom?
    private var exportDirectory: URL?
    private let status = UILabel()
    private let startButton = UIButton(type: .system)
    private let finishButton = UIButton(type: .system)
    private let shareButton = UIButton(type: .system)

    public override func viewDidLoad() {
        super.viewDidLoad()
        title = "RoomShift Room Scan"
        view.backgroundColor = .systemBackground
        status.text = RoomCaptureSession.isSupported ? "Scan walls, doors, and windows with LiDAR." : "Room scanning requires a compatible LiDAR iPhone or iPad. Use web photo capture on this device."
        status.numberOfLines = 0
        startButton.setTitle("Start room scan", for: .normal)
        finishButton.setTitle("Finish scan", for: .normal)
        shareButton.setTitle("Export room files", for: .normal)
        startButton.isEnabled = RoomCaptureSession.isSupported
        finishButton.isEnabled = false
        shareButton.isEnabled = false
        startButton.addTarget(self, action: #selector(startScan), for: .touchUpInside)
        finishButton.addTarget(self, action: #selector(finishScan), for: .touchUpInside)
        shareButton.addTarget(self, action: #selector(exportRoom), for: .touchUpInside)
        let controls = UIStackView(arrangedSubviews: [status, startButton, finishButton, shareButton])
        controls.axis = .vertical; controls.spacing = 10; controls.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(controls)
        NSLayoutConstraint.activate([
            controls.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 20),
            controls.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -20),
            controls.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12)
        ])
    }

    @objc private func startScan() {
        Task {
            guard RoomCaptureSession.isSupported else { return }
            let authorized = await AVCaptureDevice.requestAccess(for: .video)
            guard authorized else { status.text = "Camera permission denied. Allow camera access in Settings to scan."; return }
            discardExports()
            result = nil; shareButton.isEnabled = false
            captureView?.removeFromSuperview()
            let scanner = RoomCaptureView(frame: .zero)
            scanner.delegate = self; scanner.translatesAutoresizingMaskIntoConstraints = false
            view.insertSubview(scanner, at: 0)
            NSLayoutConstraint.activate([
                scanner.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
                scanner.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                scanner.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                scanner.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -230)
            ])
            captureView = scanner
            scanner.captureSession.run(configuration: RoomCaptureSession.Configuration())
            startButton.isEnabled = false; finishButton.isEnabled = true
            status.text = "Move slowly around the room. Follow the scanning guidance."
        }
    }

    @objc private func finishScan() {
        finishButton.isEnabled = false
        status.text = "Processing room geometry…"
        captureView?.captureSession.stop()
    }

    nonisolated public func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
        if let error { Task { @MainActor in self.status.text = error.localizedDescription; self.startButton.isEnabled = true }; return false }
        return true
    }

    nonisolated public func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
        Task { @MainActor in
            self.startButton.isEnabled = true
            if let error { self.status.text = error.localizedDescription; return }
            self.result = processedResult
            self.shareButton.isEnabled = true
            self.status.text = "Review your scan, then export geometry and layout data. Check important measurements."
        }
    }

    @objc private func exportRoom() {
        guard let result else { return }
        do {
            discardExports()
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("RoomShift-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            exportDirectory = directory
            let layoutURL = directory.appendingPathComponent("roomshift-layout.json")
            let originalURL = directory.appendingPathComponent("roomplan-original.json")
            let geometryURL = directory.appendingPathComponent("room.usdz")
            let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            try encoder.encode(RoomShiftLayout(capture: result)).write(to: layoutURL, options: .atomic)
            try encoder.encode(result).write(to: originalURL, options: .atomic)
            try result.export(to: geometryURL, exportOptions: .parametric)
            let share = UIActivityViewController(activityItems: [layoutURL, geometryURL, originalURL], applicationActivities: nil)
            share.popoverPresentationController?.sourceView = shareButton
            share.completionWithItemsHandler = { [weak self] _, _, _, _ in Task { @MainActor in self?.discardExports() } }
            present(share, animated: true)
        } catch { status.text = "Export failed: \(error.localizedDescription)"; discardExports() }
    }

    private func discardExports() {
        if let exportDirectory { try? FileManager.default.removeItem(at: exportDirectory) }
        exportDirectory = nil
    }

    public override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        captureView?.captureSession.stop()
        if isBeingDismissed || navigationController?.isBeingDismissed == true { discardExports(); result = nil }
    }
}
