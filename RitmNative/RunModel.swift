import Foundation

struct RoutePoint: Codable, Equatable {
    var lat: Double
    var lon: Double
    var at: Double
    var accuracy: Double
    var segment: Int
}

struct HeartRateSample: Codable, Equatable { var at: Double; var bpm: Int }

struct RunRecord: Codable, Equatable {
    var id = UUID().uuidString
    var startedAt: Double
    var finishedAt: Double? = nil
    var seconds: Double = 0
    var distanceMetres: Double = 0
    var points: [RoutePoint] = []
    var steps: Int? = nil
    var heartRate: [HeartRateSample]? = nil
    var source = "iphone-native"

    private enum CodingKeys: String, CodingKey {
        case id, startedAt, finishedAt, seconds, distanceMetres, points, steps, source, heartRate
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(startedAt, forKey: .startedAt)
        try container.encode(finishedAt, forKey: .finishedAt)
        try container.encode(seconds, forKey: .seconds)
        try container.encode(distanceMetres, forKey: .distanceMetres)
        try container.encode(points, forKey: .points)
        try container.encode(steps, forKey: .steps)
        try container.encode(heartRate, forKey: .heartRate)
        try container.encode(source, forKey: .source)
    }
}

struct ActiveRun: Codable {
    var run: RunRecord
    var status = "running"
    var accumulatedSeconds: Double = 0
    var runningSince: Double?
    var lastCheckpointAt: Double
    var segmentStartedAt: Double
    var segmentPending = true

    init(now: Double) {
        run = RunRecord(startedAt: now)
        runningSince = now
        lastCheckpointAt = now
        segmentStartedAt = now
    }

    func snapshot(now: Double) -> RunRecord {
        var result = run
        result.seconds = accumulatedSeconds + (runningSince.map { max(0, now - $0) / 1000 } ?? 0)
        return result
    }

    mutating func checkpoint(now: Double) {
        run = snapshot(now: now)
        accumulatedSeconds = run.seconds
        if status == "running" { runningSince = now }
        lastCheckpointAt = now
    }

    mutating func pause(now: Double) {
        checkpoint(now: now)
        status = "paused"
        runningSince = nil
        segmentPending = true
    }

    mutating func resume(now: Double) {
        status = "running"
        runningSince = now
        lastCheckpointAt = now
        segmentPending = true
        segmentStartedAt = now
    }

    // Process death is a recording gap. Keep only elapsed time already saved.
    mutating func recoverAfterReopening() {
        accumulatedSeconds = run.seconds
        runningSince = nil
        status = "paused"
        segmentPending = true
    }
}

struct RouteAcceptance {
    let point: RoutePoint
    let distanceMetres: Double
}

enum RouteFilter {
    static func accept(latitude: Double, longitude: Double, at: Double, accuracy: Double,
                       now: Double, previous: RoutePoint?, forceNewSegment: Bool) -> RouteAcceptance? {
        guard [latitude, longitude, at, accuracy, now].allSatisfy({ $0.isFinite }),
              (-90...90).contains(latitude), (-180...180).contains(longitude),
              accuracy >= 0, accuracy <= 40, at >= 0,
              now - at <= 20_000, at - now <= 5_000 else { return nil }
        guard let previous else {
            return RouteAcceptance(point: RoutePoint(lat: latitude, lon: longitude, at: at,
                                                    accuracy: accuracy, segment: 0), distanceMetres: 0)
        }
        guard at > previous.at else { return nil }
        let seconds = (at - previous.at) / 1000
        let gap = forceNewSegment || seconds > 20
        let distance = metres(previous.lat, previous.lon, latitude, longitude)
        let minimumDistance = max(3, min(10, max(previous.accuracy, accuracy) / 2))
        // Keep the last accepted point as the reference, so slow real movement
        // eventually crosses the threshold without accumulating stationary noise.
        if !gap && (seconds < 2 || distance < minimumDistance) { return nil }
        // Gaps start a new segment and never acquire distance. Within a segment,
        // reject jumps inconsistent with running even allowing GPS uncertainty.
        if !gap && distance > max(50, 15 * seconds + previous.accuracy + accuracy) { return nil }
        let segment = gap ? previous.segment + 1 : previous.segment
        return RouteAcceptance(point: RoutePoint(lat: latitude, lon: longitude, at: at,
                                                accuracy: accuracy, segment: segment),
                               distanceMetres: gap ? 0 : distance)
    }

    private static func metres(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
        let r = Double.pi / 180
        let a = pow(sin((lat2 - lat1) * r / 2), 2)
            + cos(lat1 * r) * cos(lat2 * r) * pow(sin((lon2 - lon1) * r / 2), 2)
        return 6_371_000 * 2 * atan2(sqrt(max(0, a)), sqrt(max(0, 1 - a)))
    }
}

struct RunDatabase: Codable {
    var version = 1
    var active: ActiveRun? = nil
    var completed: [RunRecord] = []
    var gymHeartRate: [String: [HeartRateSample]]? = nil
}
