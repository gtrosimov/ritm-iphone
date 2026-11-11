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

    func testStepsDecodeOnlyExactFEE0PayloadAsLittleEndian() {
        XCTAssertEqual(MiBandBroadcastParser.steps(serviceUUID: "FEE0", data: Data([0x34, 0x12, 9, 8])), 4660)
        XCTAssertEqual(MiBandBroadcastParser.steps(serviceUUID: "0000fee0-0000-1000-8000-00805f9b34fb", data: Data([0, 0, 9, 8])), 0)
        XCTAssertEqual(MiBandBroadcastParser.steps(serviceUUID: "fee0", data: Data([255, 255, 0, 0])), 65535)
        for uuid in ["FEE1", "180D", "FFEE0", "0000FEE0-0000-1000-8000-00805F9B34FA"] {
            XCTAssertNil(MiBandBroadcastParser.steps(serviceUUID: uuid, data: Data([1, 0, 0, 0])))
        }
        for count in [0, 1, 2, 3, 5, 6] {
            XCTAssertNil(MiBandBroadcastParser.steps(serviceUUID: "FEE0", data: Data(repeating: 0, count: count)))
        }
    }

    func testStepsDataSliceDoesNotAssumeZeroStartIndex() {
        let packet = Data([255, 255, 0x02, 0x01, 0, 0]).dropFirst(2)
        XCTAssertEqual(MiBandBroadcastParser.steps(serviceUUID: "FEE0", data: packet), 258)
    }
}
