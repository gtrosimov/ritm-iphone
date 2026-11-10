import Foundation

final class RunStore {
    let url: URL

    init(directory: URL? = nil) throws {
        let documents = try directory ?? FileManager.default.url(for: .documentDirectory,
            in: .userDomainMask, appropriateFor: nil, create: true)
        let folder = documents.appendingPathComponent("RitmNative", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        url = folder.appendingPathComponent("runs.json")
        var resource = URLResourceValues()
        resource.isExcludedFromBackup = true
        var excludedFolder = folder
        try excludedFolder.setResourceValues(resource)
    }

    func load() throws -> RunDatabase {
        guard FileManager.default.fileExists(atPath: url.path) else { return RunDatabase() }
        let database = try JSONDecoder().decode(RunDatabase.self, from: Data(contentsOf: url))
        guard database.version == 1 else { throw StoreError.unsupportedVersion }
        return database
    }

    func save(_ database: RunDatabase) throws {
        let data = try JSONEncoder().encode(database)
        // One atomic document makes moving active -> completed an atomic operation.
        // Available after first device unlock, including a run with screen locked.
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    enum StoreError: LocalizedError {
        case unsupportedVersion
        var errorDescription: String? { "Неизвестный формат локальной истории. Файл не перезаписан." }
    }
}
