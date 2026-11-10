import Foundation
import XCTest
@testable import RitmNative

final class MiBandBroadcastTests: XCTestCase {
    private func packet(_ bpm: UInt8) -> Data {
        // CoreBluetooth includes the little-endian company identifier, followed
        // by the manufacturer's payload. BPM is payload[3], therefore raw[5].
        Data([0x57, 0x01, 0xAA, 0xBB, 0xCC, bpm])
    }

    func testAcceptsTypicalAndBoundaryValuesAtCorrectOffset() {
        for bpm in [UInt8(20), 60, 75, 120, 180, 200, 254] {
            XCTAssertEqual(MiBandBroadcastParser.bpm(from: packet(bpm)), Int(bpm))
        }
        XCTAssertEqual(MiBandBroadcastParser.bpm(from: Data([0x57, 0x01, 90, 100, 110, 72, 240])), 72)
    }

    func testRejectsTruncatedPacketsWithoutIndexingPastEnd() {
        for count in 0..<6 {
            XCTAssertNil(MiBandBroadcastParser.bpm(from: Data(packet(72).prefix(count))))
        }
    }

    func testRejectsDifferentCompanyAndWrongEndianness() {
        XCTAssertNil(MiBandBroadcastParser.bpm(from: Data([0x01, 0x57, 0, 0, 0, 72])))
        XCTAssertNil(MiBandBroadcastParser.bpm(from: Data([0x57, 0x02, 0, 0, 0, 72])))
        XCTAssertNil(MiBandBroadcastParser.bpm(from: Data([0x56, 0x01, 0, 0, 0, 72])))
    }

    func testRejectsInvalidLowValuesAndSentinels() {
        for bpm in [UInt8(0), 1, 19, 255] {
            XCTAssertNil(MiBandBroadcastParser.bpm(from: packet(bpm)))
        }
    }

    func testDataSliceDoesNotAssumeZeroStartIndex() {
        let prefix = Data([0xFF, 0xFF]) + packet(88)
        XCTAssertEqual(MiBandBroadcastParser.bpm(from: prefix.dropFirst(2)), 88)
    }
}
