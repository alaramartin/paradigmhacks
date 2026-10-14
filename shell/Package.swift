// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "TabShell",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "TabShell", path: "Sources/TabShell"),
    ]
)
