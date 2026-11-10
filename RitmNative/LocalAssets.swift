import Foundation
import WebKit

final class LocalAssets: NSObject, WKURLSchemeHandler {
    private struct Manifest: Decodable { let files: [String] }
    private let root: URL?
    private let manifest: Manifest

    override init() {
        root = Bundle.main.resourceURL?.appendingPathComponent("WebAssets", isDirectory: true)
        if let root, let data = try? Data(contentsOf: root.appendingPathComponent("asset-manifest.json")),
           let decoded = try? JSONDecoder().decode(Manifest.self, from: data) {
            manifest = decoded
        } else { manifest = Manifest(files: []) }
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        do {
            guard let url = urlSchemeTask.request.url, url.scheme == "ritm", url.host == "app",
                  url.user == nil, url.password == nil, url.port == nil,
                  let root else { throw URLError(.badURL) }
            let path = url.path.hasPrefix("/") ? String(url.path.dropFirst()) : url.path
            let pathComponents = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
            guard !pathComponents.contains(".."), !pathComponents.contains(".local"),
                  !pathComponents.contains(where: { $0.hasPrefix(".") || $0.contains("\\") || $0.isEmpty }),
                  manifest.files.contains(path) else { throw URLError(.noPermissionsToReadFile) }
            let base = root.resolvingSymlinksInPath().standardizedFileURL
            let file = root.appendingPathComponent(path).resolvingSymlinksInPath().standardizedFileURL
            guard file.path.hasPrefix(base.path + "/") else { throw URLError(.noPermissionsToReadFile) }
            let data = try Data(contentsOf: file)
            let mime = Self.mime(file.pathExtension.lowercased())
            // CORS permits ES module loading from the app's custom local scheme.
            // Only bundled, allowlisted files can be returned here.
            let response: URLResponse = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": mime, "Content-Length": String(data.count),
                               "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store",
                               "X-Content-Type-Options": "nosniff"])!
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch { urlSchemeTask.didFailWithError(error) }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // Responses are completed synchronously; there is no outstanding task.
    }

    private static func mime(_ extensionName: String) -> String {
        switch extensionName {
        case "html": return "text/html; charset=utf-8"
        case "mjs", "js": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "webmanifest": return "application/manifest+json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "webp": return "image/webp"
        case "gif": return "image/gif"
        case "mp4": return "video/mp4"
        case "woff2": return "font/woff2"
        case "txt": return "text/plain; charset=utf-8"
        default: return "application/octet-stream"
        }
    }
}
