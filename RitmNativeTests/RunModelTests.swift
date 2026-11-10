import XCTest
@testable import RitmNative

final class RunModelTests: XCTestCase {
    private let now: Double = 1_000_000
    private func accept(_ lat: Double = 55, _ lon: Double = 37, at: Double? = nil,
                        accuracy: Double = 5, previous: RoutePoint? = nil,
                        gap: Bool = false) -> RouteAcceptance? {
        RouteFilter.accept(latitude: lat, longitude: lon, at: at ?? now, accuracy: accuracy,
                           now: now, previous: previous, forceNewSegment: gap)
    }

    func testRejectsStaleInvalidAndInaccuratePoints() {
        XCTAssertNil(accept(at: now - 20_001))
        XCTAssertNil(accept(at: now + 5_001))
        XCTAssertNil(accept(accuracy: -1))
        XCTAssertNil(accept(accuracy: 41))
        XCTAssertNil(accept(.nan))
        XCTAssertNil(accept(91))
    }

    func testOrdinaryRouteAddsDistanceButGapDoesNot() {
        let first = accept(at: now - 5_000)!.point
        let next = accept(55.0001, at: now, previous: first)!
        XCTAssertTrue((10...12).contains(next.distanceMetres))
        XCTAssertEqual(next.point.segment, first.segment)
        let beforeGap = RoutePoint(lat: 54, lon: 36, at: now - 21_000, accuracy: 5, segment: 4)
        let afterGap = accept(previous: beforeGap)!
        XCTAssertEqual(afterGap.distanceMetres, 0)
        XCTAssertEqual(afterGap.point.segment, 5)
        XCTAssertEqual(accept(previous: first, gap: true)!.distanceMetres, 0)
    }

    func testRejectsDuplicateTimesAndTeleportWithinSegment() {
        let previous = accept(at: now - 1_000)!.point
        XCTAssertNil(accept(56, previous: previous))
        XCTAssertNil(accept(at: previous.at, previous: previous))
    }

    func testRejectsStationaryJitterAndOverFrequentFixes() {
        let previous = RoutePoint(lat: 55, lon: 37, at: now - 5_000, accuracy: 5, segment: 0)
        XCTAssertNil(accept(55.00001, previous: previous)) // About 1.1 m; minimum is 3 m.
        let coarse = RoutePoint(lat: 55, lon: 37, at: now - 5_000, accuracy: 40, segment: 0)
        XCTAssertNil(accept(55.00007, accuracy: 40, previous: coarse)) // About 7.8 m; threshold caps at 10 m.
        XCTAssertNotNil(accept(55.0001, accuracy: 40, previous: coarse))
        let recent = RoutePoint(lat: 55, lon: 37, at: now - 1_500, accuracy: 5, segment: 0)
        XCTAssertNil(accept(55.0001, previous: recent)) // About 11 m, but less than 2 s.
        let boundary = RoutePoint(lat: 55, lon: 37, at: now - 2_000, accuracy: 5, segment: 0)
        XCTAssertNotNil(accept(55.0001, previous: boundary))
    }

    func testJitterFilterDoesNotEraseSegmentStart() {
        let previous = RoutePoint(lat: 55, lon: 37, at: now - 21_000, accuracy: 5, segment: 0)
        let next = accept(previous: previous)
        XCTAssertEqual(next?.point.segment, 1)
        XCTAssertEqual(next?.distanceMetres, 0)
        let recent = RoutePoint(lat: 55, lon: 37, at: now - 500, accuracy: 5, segment: 0)
        XCTAssertEqual(accept(previous: recent, gap: true)?.point.segment, 1)
    }

    func testPausesExcludeTimeAndRecoveryDoesNotInventElapsedTime() {
        var active = ActiveRun(now: 1_000)
        active.pause(now: 11_000)
        XCTAssertEqual(active.snapshot(now: 100_000).seconds, 10)
        active.resume(now: 100_000)
        active.checkpoint(now: 105_000)
        XCTAssertEqual(active.run.seconds, 15)
        active.recoverAfterReopening()
        XCTAssertEqual(active.status, "paused")
        XCTAssertEqual(active.snapshot(now: 1_000_000).seconds, 15)
        XCTAssertTrue(active.segmentPending)
    }

    func testAtomicStoreRoundTripAndFinishKeepsOneRecord() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = try RunStore(directory: folder)
        var database = RunDatabase()
        database.active = ActiveRun(now: now)
        try store.save(database)
        var restored = try store.load()
        var finished = try XCTUnwrap(restored.active?.snapshot(now: now + 5000))
        finished.finishedAt = now + 5000
        restored.completed.append(finished)
        restored.active = nil
        try store.save(restored)
        let final = try store.load()
        XCTAssertNil(final.active)
        XCTAssertEqual(final.completed.count, 1)
        XCTAssertEqual(final.completed[0].id, finished.id)
    }

    func testUnknownStepsAreExplicitNull() throws {
        let record = RunRecord(startedAt: now)
        let data = try JSONEncoder().encode(record)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertTrue(json["steps"] is NSNull)
        XCTAssertTrue(json["finishedAt"] is NSNull)
    }
}
