import XCTest
@testable import FixtureMath
final class FixtureMathTests: XCTestCase {
    func testTwice() { XCTAssertEqual(FixtureMath.twice(3), 6) }
    func testPositive() { XCTAssertEqual(FixtureMath.sign(2), 1) }
}
