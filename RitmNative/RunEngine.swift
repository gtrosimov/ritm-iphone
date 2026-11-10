import Foundation
import Combine
import CoreLocation
import CoreMotion

@MainActor
final class RunEngine: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published private(set) var revision = 0
    @Published private(set) var persistenceError: String?
    private var database = RunDatabase()
    private var store: RunStore?
    private var readableStore = false
    private let location = CLLocationManager()
    private let pedometer = CMPedometer()
    private let band = MiBandBroadcastManager()
    private var activeGymID: String?
    private var stepStart: Date?
    private var stepBase = 0
    private var stepToken = UUID()
    private var busy = false
    private var timer: Timer?
    var status: String { database.active?.status ?? "idle" }
    private var now: Double { Date().timeIntervalSince1970 * 1000 }

    override init() {
        super.init()
        do {
            let store = try RunStore()
            self.store = store
            database = try store.load()
            readableStore = true
            if database.active != nil {
                database.active?.recoverAfterReopening()
                try store.save(database)
            }
        } catch { persistenceError = error.localizedDescription }
        band.onMeasurement = { [weak self] at, bpm in self?.recordHeartRate(at: at, bpm: bpm) }
        location.delegate = self
        location.activityType = .fitness
        location.desiredAccuracy = kCLLocationAccuracyBest
        location.distanceFilter = 3
        location.pausesLocationUpdatesAutomatically = false
        location.allowsBackgroundLocationUpdates = true
        location.showsBackgroundLocationIndicator = true
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.checkpoint() }
        }
    }

    deinit { timer?.invalidate() }

    typealias Reply = (Result<Any, Error>) -> Void

    func command(_ action: String, payload: [String: Any], reply: @escaping Reply) {
        do {
            if ["startRun", "pauseRun", "resumeRun", "stopRun", "deleteRun"].contains(action) {
                guard readableStore, store != nil else { throw Failure.message("История недоступна. Исходный файл не изменён.") }
                guard !busy else { throw Failure.message("Предыдущая команда ещё выполняется.") }
            }
            switch action {
            case "bandState": reply(.success(band.state()))
            case "bandScan": reply(.success(try band.startScan()))
            case "bandStop": reply(.success(band.stopScan()))
            case "bandSelect": reply(.success(try band.select(id: payload["id"] as? String)))
            case "bandGymStart":
                guard let id = payload["id"] as? String, !id.isEmpty, id.count <= 100 else { throw Failure.message("Не указан id занятия.") }
                activeGymID = id
                if band.state()["selectedId"] is String { _ = try? band.startScan() }
                reply(.success(["started": id]))
            case "bandGymRead":
                guard let id = payload["id"] as? String else { throw Failure.message("Не указан id занятия.") }
                reply(.success(try object(database.gymHeartRate?[id] ?? [])))
            case "bandGymStop":
                activeGymID = nil
                if status != "running" { _ = band.stopScan() }
                reply(.success(["stopped": true]))
            case "bandGymDelete":
                guard let id = payload["id"] as? String else { throw Failure.message("Не указан id занятия.") }
                var next = database; next.gymHeartRate?.removeValue(forKey: id); try commit(next)
                reply(.success(["deleted": id]))
            case "capabilities": reply(.success(capabilities()))
            case "getRunState": reply(.success(try state()))
            case "listRuns": reply(.success(try object(database.completed)))
            case "startRun":
                guard database.active == nil else { throw Failure.message("Пробежка уже существует. Продолжите или завершите её.") }
                try requireLocationPermission()
                var next = database
                next.active = ActiveRun(now: now)
                try commit(next)
                startSensors()
                reply(.success(try state()))
            case "pauseRun":
                guard status == "running" else { throw Failure.message("Нет запущенной пробежки.") }
                pauseOrFinish(finish: false, reply: reply)
            case "resumeRun":
                guard status == "paused" else { throw Failure.message("Нет пробежки на паузе.") }
                try requireLocationPermission()
                var next = database
                next.active?.resume(now: now)
                try commit(next)
                startSensors()
                reply(.success(try state()))
            case "stopRun":
                guard database.active != nil else { throw Failure.message("Нет активной пробежки.") }
                pauseOrFinish(finish: true, reply: reply)
            case "deleteRun":
                guard let id = payload["id"] as? String else { throw Failure.message("Не указан id пробежки.") }
                guard database.active?.run.id != id else { throw Failure.message("Сначала завершите активную пробежку.") }
                var next = database
                next.completed.removeAll { $0.id == id }
                try commit(next)
                reply(.success(["deleted": id]))
            default: throw Failure.message("Неизвестная команда.")
            }
        } catch { reply(.failure(error)) }
    }

    func capabilities() -> [String: Any] {
        ["available": true, "version": 1, "source": "iphone-native",
         "backgroundLocation": true, "nativeSteps": CMPedometer.isStepCountingAvailable(),
         "healthKit": false, "bluetoothHeartRate": true, "heartRateCoverage": "intermittent", "uploads": false,
         "fileSharing": true,
         "locationAuthorization": authorizationName,
         "locationServicesEnabled": CLLocationManager.locationServicesEnabled(),
         "preciseLocation": location.accuracyAuthorization == .fullAccuracy]
    }

    func state() throws -> [String: Any] {
        ["status": status, "run": try database.active.map { try object($0.snapshot(now: now)) } ?? NSNull(),
         "locationAuthorization": authorizationName,
         "locationServicesEnabled": CLLocationManager.locationServicesEnabled(),
         "motionAvailable": CMPedometer.isStepCountingAvailable(),
         "motionAuthorization": motionAuthorizationName,
         "persistenceError": persistenceError.map { $0 as Any } ?? NSNull()]
    }

    private func recordHeartRate(at: Double, bpm: Int) {
        guard readableStore, !busy else { return }
        var next = database
        let sample = HeartRateSample(at: at, bpm: bpm)
        var changed = false
        if status == "running", var active = next.active {
            var values = active.run.heartRate ?? []
            if values.count < 30000, values.last.map({ at - $0.at >= 5000 }) ?? true {
                values.append(sample); active.run.heartRate = values; active.checkpoint(now: now); next.active = active; changed = true
            }
        }
        if let id = activeGymID {
            var values = next.gymHeartRate?[id] ?? []
            if values.count < 30000, values.last.map({ at - $0.at >= 5000 }) ?? true {
                values.append(sample)
                if next.gymHeartRate == nil { next.gymHeartRate = [:] }
                next.gymHeartRate?[id] = values; changed = true
            }
        }
        if changed { do { try commit(next) } catch { handlePersistenceFailure(error) } }
    }

    private func requireLocationPermission() throws {
        guard CLLocationManager.locationServicesEnabled() else {
            throw Failure.message("Включите геолокацию в настройках iPhone.")
        }
        switch location.authorizationStatus {
        case .notDetermined:
            location.requestWhenInUseAuthorization()
            throw Failure.message("Разрешите геолокацию и нажмите «Начать» ещё раз.")
        case .denied, .restricted:
            throw Failure.message("Разрешите геолокацию в настройках iPhone → Ритм.")
        case .authorizedWhenInUse:
            // Requested only in response to an explicit start/resume gesture.
            location.requestAlwaysAuthorization()
        case .authorizedAlways: break
        @unknown default: throw Failure.message("Неизвестное разрешение геолокации.")
        }
    }

    private func startSensors() {
        if band.state()["selectedId"] is String { _ = try? band.startScan() }
        location.startUpdatingLocation()
        guard CMPedometer.isStepCountingAvailable() else { return }
        let token = UUID()
        stepToken = token
        stepBase = database.active?.run.steps ?? 0
        let start = Date()
        stepStart = start
        pedometer.startUpdates(from: start) { [weak self] data, error in
            DispatchQueue.main.async {
                guard let self, self.stepToken == token, self.status == "running" else { return }
                guard let data, error == nil else { return }
                var next = self.database
                next.active?.run.steps = self.stepBase + max(0, data.numberOfSteps.intValue)
                next.active?.checkpoint(now: self.now)
                do { try self.commit(next) } catch { self.handlePersistenceFailure(error) }
            }
        }
    }

    private func pauseOrFinish(finish: Bool, reply: @escaping Reply) {
        busy = true
        let stoppedAt = now
        let id = database.active!.run.id
        var next = database
        if next.active?.status == "running" { next.active?.pause(now: stoppedAt) }
        do { try commit(next) } catch { busy = false; reply(.failure(error)); return }
        location.stopUpdatingLocation()
        if activeGymID == nil { _ = band.stopScan() }
        finalizeSteps(at: Date(timeIntervalSince1970: stoppedAt / 1000)) { [weak self] count in
            guard let self else { return }
            defer { self.busy = false }
            guard self.database.active?.run.id == id else {
                reply(.failure(Failure.message("Пробежка изменилась."))); return
            }
            var next = self.database
            next.active?.run.steps = count
            do {
                if finish {
                    var run = next.active!.run
                    run.finishedAt = stoppedAt
                    next.completed.insert(run, at: 0)
                    next.active = nil
                    try self.commit(next)
                    reply(.success(try self.object(run)))
                } else {
                    try self.commit(next)
                    reply(.success(try self.state()))
                }
            } catch { reply(.failure(error)) }
        }
    }

    private func finalizeSteps(at end: Date, completion: @escaping (Int?) -> Void) {
        pedometer.stopUpdates()
        stepToken = UUID()
        let fallback = database.active?.run.steps
        guard let start = stepStart, CMPedometer.isStepCountingAvailable() else {
            stepStart = nil
            completion(fallback)
            return
        }
        stepStart = nil
        let base = stepBase
        var replied = false
        let settle: (Int?) -> Void = { count in
            guard !replied else { return }
            replied = true
            completion(count)
        }
        pedometer.queryPedometerData(from: start, to: end) { data, error in
            DispatchQueue.main.async {
                settle(error == nil ? data.map { base + max(0, $0.numberOfSteps.intValue) } : fallback)
            }
        }
        // A sensor query must not leave the UI busy indefinitely. Existing real
        // sensor readings remain the fallback; no estimated steps are created.
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { settle(fallback) }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard status == "running", !busy else { return }
        var next = database
        guard var active = next.active else { return }
        let receivedAt = now
        for fix in locations.sorted(by: { $0.timestamp < $1.timestamp }) {
            guard let accepted = RouteFilter.accept(latitude: fix.coordinate.latitude,
                longitude: fix.coordinate.longitude, at: fix.timestamp.timeIntervalSince1970 * 1000,
                accuracy: fix.horizontalAccuracy, now: receivedAt, previous: active.run.points.last,
                forceNewSegment: active.segmentPending) else { continue }
            // Do not replay the cached fix from before this resume/start.
            guard accepted.point.at >= active.segmentStartedAt else { continue }
            active.run.points.append(accepted.point)
            active.run.distanceMetres += accepted.distanceMetres
            active.segmentPending = false
        }
        active.checkpoint(now: receivedAt)
        next.active = active
        do { try commit(next) } catch { handlePersistenceFailure(error) }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        revision += 1
        if status == "running", [.denied, .restricted].contains(manager.authorizationStatus) {
            var next = database
            next.active?.pause(now: now)
            location.stopUpdatingLocation()
            pedometer.stopUpdates()
            stepStart = nil
            stepToken = UUID()
            do { try commit(next) } catch { handlePersistenceFailure(error) }
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Temporary GPS loss creates a timestamp gap. The next fix starts a
        // segment if >20 seconds have passed; no synthetic locations are added.
        revision += 1
    }

    func checkpoint() {
        guard status == "running", !busy else { return }
        var next = database
        next.active?.checkpoint(now: now)
        do { try commit(next) } catch { handlePersistenceFailure(error) }
    }

    private func commit(_ next: RunDatabase) throws {
        guard readableStore, let store else { throw Failure.message("Локальная история недоступна.") }
        do { try store.save(next) }
        catch { persistenceError = error.localizedDescription; throw error }
        database = next
        persistenceError = nil
        revision += 1
    }

    private func handlePersistenceFailure(_ error: Error) {
        persistenceError = "Не удалось сохранить пробежку: \(error.localizedDescription)"
        database.active?.pause(now: now)
        location.stopUpdatingLocation()
        pedometer.stopUpdates()
        stepStart = nil
        stepToken = UUID()
        revision += 1
    }

    private func object<T: Encodable>(_ value: T) throws -> Any {
        try JSONSerialization.jsonObject(with: JSONEncoder().encode(value), options: [.fragmentsAllowed])
    }

    private var authorizationName: String {
        switch location.authorizationStatus {
        case .notDetermined: return "notDetermined"
        case .restricted: return "restricted"
        case .denied: return "denied"
        case .authorizedAlways: return "always"
        case .authorizedWhenInUse: return "whenInUse"
        @unknown default: return "unknown"
        }
    }

    private var motionAuthorizationName: String {
        switch CMPedometer.authorizationStatus() {
        case .notDetermined: return "notDetermined"
        case .restricted: return "restricted"
        case .denied: return "denied"
        case .authorized: return "authorized"
        @unknown default: return "unknown"
        }
    }

    enum Failure: LocalizedError {
        case message(String)
        var errorDescription: String? { if case let .message(text) = self { return text }; return nil }
    }
}
