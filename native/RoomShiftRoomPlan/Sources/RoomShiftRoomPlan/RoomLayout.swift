import Foundation
import RoomPlan
import simd

public struct RoomShiftLayout: Encodable {
    public struct Dimensions: Encodable { let width: Float; let depth: Float; let height: Float }
    public struct Element: Encodable {
        let id: String
        let kind: String
        let dimensions: [Float]
        var position: [Float]
        let rotation: Float
        // Original column-major transform retained for lossless future importers.
        let originalTransform: [Float]
    }
    let format = "roomshift-layout"
    let version = 1
    let units = "meters"
    let coordinateSystem = "right-handed-y-up"
    let source = "apple-roomplan"
    let room: Dimensions
    let originalOrigin: [Float]
    let surfaces: [Element]
    let objectLocations: [Element]

    public init(capture: CapturedRoom) throws {
        guard !capture.walls.isEmpty else { throw LayoutError.noWalls }
        var minimum = SIMD3<Float>(repeating: .greatestFiniteMagnitude)
        var maximum = SIMD3<Float>(repeating: -.greatestFiniteMagnitude)
        // Use transformed corners, not centers, to compute metric bounds.
        for wall in capture.walls {
            for x in [Float(-0.5), Float(0.5)] {
                for y in [Float(-0.5), Float(0.5)] {
                    for z in [Float(-0.5), Float(0.5)] {
                        let corner = wall.transform * SIMD4<Float>(wall.dimensions.x * x, wall.dimensions.y * y, wall.dimensions.z * z, 1)
                        let point = SIMD3<Float>(corner.x, corner.y, corner.z)
                        minimum = simd_min(minimum, point)
                        maximum = simd_max(maximum, point)
                    }
                }
            }
        }
        let extent = maximum - minimum
        guard extent.x >= 1, extent.z >= 1, extent.y >= 1,
              extent.x <= 30, extent.z <= 30, extent.y <= 30 else { throw LayoutError.unsupportedDimensions }
        // RoomPlan/ARKit and Three.js both use right-handed Y-up coordinates and meters.
        // Translate the bounding-box floor center to the editor's origin; preserve yaw.
        let origin = SIMD3<Float>((minimum.x + maximum.x) / 2, minimum.y, (minimum.z + maximum.z) / 2)
        originalOrigin = [origin.x, origin.y, origin.z]
        room = Dimensions(width: extent.x, depth: extent.z, height: extent.y)
        func element(id: UUID, kind: String, dimensions: SIMD3<Float>, transform: simd_float4x4) -> Element {
            let p = SIMD3<Float>(transform.columns.3.x, transform.columns.3.y, transform.columns.3.z) - origin
            let matrix = (0..<4).flatMap { col in (0..<4).map { row in transform[col][row] } }
            return Element(id: id.uuidString, kind: kind, dimensions: [dimensions.x, dimensions.y, dimensions.z], position: [p.x, p.y, p.z], rotation: atan2(-transform.columns.0.z, transform.columns.0.x), originalTransform: matrix)
        }
        surfaces = [("wall", capture.walls), ("window", capture.windows), ("door", capture.doors), ("opening", capture.openings)].flatMap { kind, items in
            items.map { element(id: $0.identifier, kind: kind, dimensions: $0.dimensions, transform: $0.transform) }
        }
        objectLocations = capture.objects.map { element(id: $0.identifier, kind: String(describing: $0.category), dimensions: $0.dimensions, transform: $0.transform) }
    }

    public enum LayoutError: LocalizedError {
        case noWalls, unsupportedDimensions
        public var errorDescription: String? {
            switch self {
            case .noWalls: return "Scan at least one complete wall before exporting."
            case .unsupportedDimensions: return "The web editor supports room dimensions from 1 to 30 meters."
            }
        }
    }
}
