// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "CoverageFixture", products: [.library(name: "FixtureMath", targets: ["FixtureMath"])], targets: [.target(name: "FixtureMath"), .testTarget(name: "FixtureMathTests", dependencies: ["FixtureMath"])])
