// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "RoomShiftRoomPlan",
    platforms: [.iOS(.v17)],
    products: [.library(name: "RoomShiftRoomPlan", targets: ["RoomShiftRoomPlan"])],
    targets: [.target(name: "RoomShiftRoomPlan")]
)
