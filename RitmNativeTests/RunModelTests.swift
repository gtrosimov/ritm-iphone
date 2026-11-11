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

    func testBandStepsCountRunDeltasAndKeepPhoneStepsSeparate() {
        var active = ActiveRun(now: now, bandStepReading: BandStepReading(at: now, total: 1200))
        XCTAssertEqual(active.run.bandSteps?.count, 0)
        active.receiveBandSteps(at: now + 5000, total: 1210)
        active.receiveBandSteps(at: now + 10000, total: 1221)
        XCTAssertEqual(active.run.bandSteps?.count, 21)
        XCTAssertEqual(active.run.bandSteps?.baseline, 1200)
        XCTAssertEqual(active.run.bandSteps?.hasGaps, false)
        XCTAssertNil(active.run.steps)
    }

    func testBandStepsMissingAndDelayedFirstReadingNeverUseDailyTotal() {
        var active = ActiveRun(now: now)
        XCTAssertNil(active.run.bandSteps)
        active.receiveBandSteps(at: now + 5000, total: 4000)
        XCTAssertNil(active.run.bandSteps?.count)
        XCTAssertEqual(active.run.bandSteps?.hasGaps, true)
        active.receiveBandSteps(at: now + 10000, total: 4012)
        XCTAssertEqual(active.run.bandSteps?.count, 12)
    }

    func testBandStepsZeroIsRealAndStaleStartReadingIsUnknown() {
        var zero = ActiveRun(now: now, bandStepReading: BandStepReading(at: now, total: 0))
        zero.receiveBandSteps(at: now + 5000, total: 0)
        XCTAssertEqual(zero.run.bandSteps?.count, 0)
        let stale = ActiveRun(now: now, bandStepReading: BandStepReading(at: now - 30001, total: 300))
        XCTAssertNil(stale.run.bandSteps)
        var atBoundary = ActiveRun(now: now)
        atBoundary.receiveBandSteps(at: now, total: 0)
        XCTAssertEqual(atBoundary.run.bandSteps?.count, 0)
        XCTAssertEqual(atBoundary.run.bandSteps?.hasGaps, false)
    }

    func testBandStepsPauseDoesNotCountStepsBetweenSegments() {
        var active = ActiveRun(now: now, bandStepReading: BandStepReading(at: now, total: 100))
        active.receiveBandSteps(at: now + 5000, total: 110)
        active.pause(now: now + 6000)
        active.receiveBandSteps(at: now + 10000, total: 200)
        active.resume(now: now + 20000, bandStepReading: BandStepReading(at: now + 20000, total: 220))
        active.receiveBandSteps(at: now + 25000, total: 230)
        XCTAssertEqual(active.run.bandSteps?.count, 20)
        XCTAssertEqual(active.run.bandSteps?.hasGaps, false)
    }

    func testBandStepsResumeWithoutNewBaselineDoesNotBridgePause() {
        var active = ActiveRun(now: now, bandStepReading: BandStepReading(at: now, total: 100))
        active.receiveBandSteps(at: now + 5000, total: 110)
        active.pause(now: now + 6000)
        active.resume(now: now + 10000, bandStepReading: BandStepReading(at: now + 5000, total: 110))
        active.receiveBandSteps(at: now + 12000, total: 140)
        XCTAssertEqual(active.run.bandSteps?.count, 10)
        XCTAssertEqual(active.run.bandSteps?.hasGaps, true)
        active.receiveBandSteps(at: now + 17000, total: 150)
        XCTAssertEqual(active.run.bandSteps?.count, 20)
    }

    func testBandStepsRecentCachedTotalCannotCountPreRunSteps() {
        var active = ActiveRun(now: now, bandStepReading: BandStepReading(at: now - 1000, total: 4000))
        XCTAssertNil(active.run.bandSteps)
        active.receiveBandSteps(at: now + 5000, total: 4020)
        XCTAssertNil(active.run.bandSteps?.count)
        XCTAssertEqual(active.run.bandSteps?.hasGaps, true)
        active.receiveBandSteps(at: now + 10000, total: 4030)
        XCTAssertEqual(active.run.bandSteps?.count, 10)
    }

    func testBandStepsCachedTotalDuringPauseCannotCountRemainingPausedSteps() {
        var active = ActiveRun(now: now, bandStepReading: BandStepReading(at: now, total: 100))
        active.receiveBandSteps(at: now + 5000, total: 110)
        active.pause(now: now + 6000)
        active.resume(now: now + 20000, bandStepReading: BandStepReading(at: now + 19000, total: 220))
        active.receiveBandSteps(at: now + 25000, total: 230)
        XCTAssertEqual(active.run.bandSteps?.count, 10)
        XCTAssertEqual(active.run.bandSteps?.hasGaps, true)
        active.receiveBandSteps(at: now + 30000, total: 240)
        XCTAssertEqual(active.run.bandSteps?.count, 20)
    }

    func testBandStepsResetLongGapAndImplausibleJumpOnlyRebaseline() {
        var active = ActiveRun(now: now, bandStepReading: BandStepReading(at: now, total: 100))
        active.receiveBandSteps(at: now + 5000, total: 110)
        active.receiveBandSteps(at: now + 10000, total: 0)
        active.receiveBandSteps(at: now + 15000, total: 10)
        active.receiveBandSteps(at: now + 45001, total: 50)
        active.receiveBandSteps(at: now + 50001, total: 60)
        active.receiveBandSteps(at: now + 51001, total: 100)
        active.receiveBandSteps(at: now + 56001, total: 110)
        XCTAssertEqual(active.run.bandSteps?.count, 40)
        XCTAssertEqual(active.run.bandSteps?.hasGaps, true)
        XCTAssertEqual(active.run.bandSteps?.baseline, 100)
        XCTAssertEqual(active.run.bandSteps?.lastTotal, 110)
    }

    func testBandStepsIgnoreOutOfOrderAndPreSegmentReadings() {
        var active = ActiveRun(now: now, bandStepReading: BandStepReading(at: now, total: 100))
        active.receiveBandSteps(at: now - 1, total: 5000)
        active.receiveBandSteps(at: now + 5000, total: 110)
        active.receiveBandSteps(at: now + 1000, total: 5000)
        active.receiveBandSteps(at: now + 10000, total: 120)
        XCTAssertEqual(active.run.bandSteps?.count, 20)
        XCTAssertEqual(active.run.bandSteps?.hasGaps, false)
    }

    func testBandStepsTrailingSilenceMarksPartialCoverageWithoutInventingCount() {
        var active = ActiveRun(now: now, bandStepReading: BandStepReading(at: now, total: 100))
        active.receiveBandSteps(at: now + 5000, total: 110)
        XCTAssertEqual(active.snapshot(now: now + 35000).bandSteps?.hasGaps, false)
        XCTAssertEqual(active.snapshot(now: now + 35001).bandSteps?.hasGaps, true)
        active.pause(now: now + 35001)
        XCTAssertEqual(active.run.bandSteps?.count, 10)
        XCTAssertEqual(active.run.bandSteps?.hasGaps, true)
    }

    func testUnknownBandCountIsExplicitNullAfterDelayedBaseline() throws {
        var active = ActiveRun(now: now)
        active.receiveBandSteps(at: now + 5000, total: 6000)
        let data = try JSONEncoder().encode(active.run)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let steps = try XCTUnwrap(json["bandSteps"] as? [String: Any])
        XCTAssertTrue(steps["count"] is NSNull)
        XCTAssertEqual(steps["lastTotal"] as? Int, 6000)
        XCTAssertEqual(steps["source"] as? String, "miband-advertisement")
    }

    func testBandStepsRecoveryAndSelectionChangeDoNotBridgeCounters() {
        var active = ActiveRun(now: now, bandStepReading: BandStepReading(at: now, total: 100))
        active.receiveBandSteps(at: now + 5000, total: 110)
        active.invalidateBandStepBaseline()
        active.receiveBandSteps(at: now + 10000, total: 6000)
        active.receiveBandSteps(at: now + 15000, total: 6010)
        XCTAssertEqual(active.run.bandSteps?.count, 20)
        active.recoverAfterReopening()
        XCTAssertNil(active.run.bandSteps?.baseline)
        XCTAssertEqual(active.run.bandSteps?.hasGaps, true)
    }

    func testOldRunRecordDecodesWithoutBandStepsAndNewRecordRoundTrips() throws {
        let old = Data(#"{"id":"old","startedAt":1000,"finishedAt":2000,"seconds":1,"distanceMetres":0,"points":[],"steps":null,"source":"iphone-native"}"#.utf8)
        let oldRun = try JSONDecoder().decode(RunRecord.self, from: old)
        XCTAssertNil(oldRun.bandSteps)
        XCTAssertNil(oldRun.steps)
        var active = ActiveRun(now: now, bandStepReading: BandStepReading(at: now, total: 0))
        active.receiveBandSteps(at: now + 5000, total: 10)
        let data = try JSONEncoder().encode(active.run)
        XCTAssertEqual(try JSONDecoder().decode(RunRecord.self, from: data), active.run)
    }
}
