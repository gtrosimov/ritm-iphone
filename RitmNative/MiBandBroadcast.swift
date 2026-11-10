import Foundation

/// Decoder for the opt-in manufacturer-data heart-rate broadcast observed on
/// compatible Mi Band firmware. This is not an authenticated device protocol.
/// Protocol observation: https://github.com/Tnze/miband-heart-rate/blob/miband-4-to-7/src/main.rs
/// CoreBluetooth's manufacturer Data includes the two-byte company identifier;
/// the source's manufacturer payload[3] is consequently raw[5] here.
enum MiBandBroadcastParser {
    static func bpm(from manufacturerData: Data) -> Int? {
        // Data slices need not have a zero startIndex. Convert before indexing.
        let raw = [UInt8](manufacturerData)
        guard raw.count >= 6, raw[0] == 0x57, raw[1] == 0x01 else { return nil }
        let value = Int(raw[5])
        // A one-byte field cannot encode >255; 0 and 0xFF are treated as unknown.
        guard value != 0xFF, (20...260).contains(value) else { return nil }
        return value
    }
}

#if canImport(CoreBluetooth)
import CoreBluetooth

/// Passive discovery only: no connect, pair, authentication, key or GATT write.
/// CoreBluetooth may coalesce duplicates in the background, so coverage is always
/// advertised as intermittent. The owner must stop scanning outside a workout.
@MainActor
final class MiBandBroadcastManager: NSObject, CBCentralManagerDelegate {
    /// Unix milliseconds and a real observed BPM, emitted only for the selected
    /// candidate. Repeated advertisements are sampled at most once per second.
    var onMeasurement: ((Double, Int) -> Void)?

    private struct Candidate {
        let id: UUID
        var name: String
        var rssi: Int
        var bpm: Int
        var lastSeenAt: Double
    }

    private struct Reading {
        let at: Double
        let bpm: Int
    }

    private let defaults: UserDefaults
    private let selectionKey = "ritm.native.miband.broadcast.selectedUUID"
    private var central: CBCentralManager?
    private var scanRequested = false
    private var selectedID: UUID?
    private var candidates: [UUID: Candidate] = [:]
    private var latestReading: Reading?
    private var lastEmittedAt: Double?
    private var lastError: String?
    private let freshnessMilliseconds: Double = 30_000
    private var now: Double { Date().timeIntervalSince1970 * 1000 }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if let stored = defaults.string(forKey: selectionKey) {
            selectedID = UUID(uuidString: stored)
        }
        super.init()
        // Deliberately do not create CBCentralManager here: its initialization
        // can request Bluetooth permission. Only an explicit startScan may do so.
    }

    @discardableResult
    func startScan() throws -> [String: Any] {
        guard ![.denied, .restricted].contains(CBManager.authorization) else {
            throw fail("Разрешите Bluetooth для Ритм в настройках iPhone.")
        }
        lastError = nil
        if let central {
            switch central.state {
            case .poweredOff: throw fail("Включите Bluetooth в настройках iPhone.")
            case .unauthorized: throw fail("Разрешите Bluetooth для Ритм в настройках iPhone.")
            case .unsupported: throw fail("На этом устройстве недоступен Bluetooth Low Energy.")
            case .poweredOn:
                scanRequested = true
                beginScan(central)
            case .unknown, .resetting:
                scanRequested = true
            @unknown default: throw fail("Неизвестное состояние Bluetooth.")
            }
        } else {
            scanRequested = true
            // Initial state is delivered asynchronously. state() reports starting
            // until then, followed by scanning or an explicit lastError.
            central = CBCentralManager(delegate: self, queue: .main,
                options: [CBCentralManagerOptionShowPowerAlertKey: false])
        }
        return state()
    }

    @discardableResult
    func stopScan() -> [String: Any] {
        scanRequested = false
        central?.stopScan()
        latestReading = nil
        lastEmittedAt = nil
        return state()
    }

    /// nil clears the choice. An arbitrary identifier cannot be selected: the
    /// device must have appeared among the bounded discovery results first.
    /// A previously confirmed selection is restored locally, without auto-scan.
    @discardableResult
    func select(id: String?) throws -> [String: Any] {
        if let id {
            guard let uuid = UUID(uuidString: id), candidates[uuid] != nil else {
                throw BroadcastError.message("Выберите устройство из результатов поиска.")
            }
            selectedID = uuid
            defaults.set(uuid.uuidString, forKey: selectionKey)
        } else {
            selectedID = nil
            defaults.removeObject(forKey: selectionKey)
        }
        // Do not retroactively store discovery readings taken before selection.
        latestReading = nil
        lastEmittedAt = nil
        return state()
    }

    func state() -> [String: Any] {
        let timestamp = now
        if let reading = latestReading, !fresh(reading.at, at: timestamp) {
            latestReading = nil
        }
        let rows: [[String: Any]] = candidates.values.sorted {
            if $0.lastSeenAt == $1.lastSeenAt { return $0.id.uuidString < $1.id.uuidString }
            return $0.lastSeenAt > $1.lastSeenAt
        }.map { candidate in
            ["id": candidate.id.uuidString, "name": candidate.name, "rssi": candidate.rssi,
             "bpm": fresh(candidate.lastSeenAt, at: timestamp) ? candidate.bpm as Any : NSNull(),
             "lastSeenAt": candidate.lastSeenAt]
        }
        let reading: Any = latestReading.map { item -> Any in
            ["at": item.at, "bpm": item.bpm] as [String: Any]
        } ?? NSNull()
        return ["scanning": central?.isScanning ?? false,
                "starting": scanRequested && (central == nil || central?.state == .unknown || central?.state == .resetting),
                "bluetoothState": bluetoothStateName,
                "authorization": authorizationName,
                "selectedId": selectedID.map { $0.uuidString as Any } ?? NSNull(),
                "candidates": rows, "reading": reading,
                "lastError": lastError.map { $0 as Any } ?? NSNull(),
                "coverage": "intermittent", "source": "miband-advertisement"]
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn:
            if scanRequested { beginScan(central) }
        case .unknown, .resetting:
            latestReading = nil
        case .poweredOff:
            _ = fail("Включите Bluetooth в настройках iPhone.")
        case .unauthorized:
            _ = fail("Разрешите Bluetooth для Ритм в настройках iPhone.")
        case .unsupported:
            _ = fail("На этом устройстве недоступен Bluetooth Low Energy.")
        @unknown default:
            _ = fail("Неизвестное состояние Bluetooth.")
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        guard scanRequested, central.isScanning,
              let manufacturer = advertisementData[CBAdvertisementDataManufacturerDataKey] as? Data,
              let bpm = MiBandBroadcastParser.bpm(from: manufacturer) else { return }
        let timestamp = now
        let identifier = peripheral.identifier
        if candidates[identifier] == nil, candidates.count >= 64 {
            // Prefer retaining the user's selected device in discovery results.
            if let oldest = candidates.values.filter({ $0.id != selectedID })
                .min(by: { $0.lastSeenAt < $1.lastSeenAt }) {
                candidates.removeValue(forKey: oldest.id)
            }
        }
        let advertisedName = advertisementData[CBAdvertisementDataLocalNameKey] as? String
        let rawName = advertisedName ?? peripheral.name ?? "Устройство 0x0157"
        let cleanedName = String(String.UnicodeScalarView(rawName.unicodeScalars.filter {
            !CharacterSet.controlCharacters.contains($0)
        }))
        let name = String(cleanedName.prefix(80))
        candidates[identifier] = Candidate(id: identifier, name: name.isEmpty ? "Устройство 0x0157" : name,
            rssi: RSSI.intValue, bpm: bpm, lastSeenAt: timestamp)
        guard identifier == selectedID else { return }
        latestReading = Reading(at: timestamp, bpm: bpm)
        if let lastEmittedAt, timestamp >= lastEmittedAt, timestamp - lastEmittedAt < 1000 { return }
        lastEmittedAt = timestamp
        onMeasurement?(timestamp, bpm)
    }

    private func beginScan(_ central: CBCentralManager) {
        guard scanRequested, central.state == .poweredOn else { return }
        if !central.isScanning {
            // Broad scanning is needed because this broadcast is manufacturer
            // data, not a guaranteed advertised standard heart-rate service.
            central.scanForPeripherals(withServices: nil,
                options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
        }
    }

    private func fresh(_ at: Double, at timestamp: Double) -> Bool {
        let age = timestamp - at
        return age >= 0 && age <= freshnessMilliseconds
    }

    private func fail(_ message: String) -> BroadcastError {
        scanRequested = false
        central?.stopScan()
        latestReading = nil
        lastEmittedAt = nil
        lastError = message
        return .message(message)
    }

    private var bluetoothStateName: String {
        guard let central else { return "notInitialized" }
        switch central.state {
        case .unknown: return "unknown"
        case .resetting: return "resetting"
        case .unsupported: return "unsupported"
        case .unauthorized: return "unauthorized"
        case .poweredOff: return "poweredOff"
        case .poweredOn: return "poweredOn"
        @unknown default: return "unknown"
        }
    }

    private var authorizationName: String {
        switch CBManager.authorization {
        case .notDetermined: return "notDetermined"
        case .restricted: return "restricted"
        case .denied: return "denied"
        case .allowedAlways: return "allowedAlways"
        @unknown default: return "unknown"
        }
    }

    enum BroadcastError: LocalizedError {
        case message(String)
        var errorDescription: String? {
            if case let .message(message) = self { return message }
            return nil
        }
    }
}
#endif
