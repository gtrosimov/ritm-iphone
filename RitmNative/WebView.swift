import SwiftUI
import WebKit

@MainActor
struct AppWebView: UIViewRepresentable {
    let engine: RunEngine

    func makeCoordinator() -> Coordinator { Coordinator(engine: engine) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(LocalAssets(), forURLScheme: "ritm")
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.userContentController.add(context.coordinator, name: "ritm")
        let view = WKWebView(frame: .zero, configuration: configuration)
        context.coordinator.webView = view
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = UIColor(red: 0.063, green: 0.078, blue: 0.078, alpha: 1)
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.load(URLRequest(url: URL(string: "ritm://app/index.html")!))
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "ritm")
        uiView.navigationDelegate = nil
        uiView.uiDelegate = nil
        coordinator.webView = nil
    }

    @MainActor
    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
        let engine: RunEngine
        weak var webView: WKWebView?
        private var sharing = false
        init(engine: RunEngine) { self.engine = engine }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "ritm", message.frameInfo.isMainFrame,
                  message.frameInfo.securityOrigin.protocol == "ritm",
                  message.frameInfo.securityOrigin.host == "app",
                  message.frameInfo.securityOrigin.port == 0,
                  message.frameInfo.request.url?.scheme == "ritm",
                  message.frameInfo.request.url?.host == "app",
                  let body = message.body as? [String: Any],
                  let id = body["id"], id is String || id is NSNumber,
                  let action = body["action"] as? String, action.count <= 64 else { return }
            if let textID = id as? String, textID.count > 128 { return }
            let payload = body["payload"] as? [String: Any] ?? [:]
            if action == "shareFile" {
                shareFile(payload) { [weak self] result in self?.send(result, id: id) }
                return
            }
            engine.command(action, payload: payload) { [weak self] result in
                self?.send(result, id: id)
            }
        }

        private func send(_ result: Result<Any, Error>, id: Any) {
            var response: [String: Any] = ["id": id]
            switch result {
            case .success(let data): response["ok"] = true; response["data"] = data; response["error"] = NSNull()
            case .failure(let error): response["ok"] = false; response["data"] = NSNull(); response["error"] = error.localizedDescription
            }
            reply(response)
        }

        private func reply(_ response: [String: Any]) {
            guard let data = try? JSONSerialization.data(withJSONObject: response), let webView else { return }
            let encoded = data.base64EncodedString()
            // Interpolate only base64, never an untrusted id, route or error string.
            let script = "window.RitmNativeReply?.(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('\(encoded)'),c=>c.charCodeAt(0)))));"
            webView.evaluateJavaScript(script, completionHandler: nil)
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
            if url.scheme == "ritm", url.host == "app", url.user == nil, url.password == nil,
               url.port == nil, navigationAction.targetFrame?.isMainFrame == true {
                decisionHandler(.allow)
                return
            }
            // External destinations leave the embedded app and its bridge.
            if navigationAction.navigationType == .linkActivated,
               ["https", "http"].contains(url.scheme?.lowercased() ?? "") {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
            }
            decisionHandler(.cancel)
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            // target=_blank is handled by decidePolicyFor and never gets a bridge.
            return nil
        }

        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            showAlert(webView: webView, message: message, completionHandler: completionHandler)
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            guard let top = presenter(), !(top is UIAlertController) else { completionHandler(false); return }
            let alert = UIAlertController(title: "Ритм", message: String(message.prefix(2000)), preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Отмена", style: .cancel) { _ in completionHandler(false) })
            alert.addAction(UIAlertAction(title: "Продолжить", style: .default) { _ in completionHandler(true) })
            top.present(alert, animated: true)
        }

        private func presenter() -> UIViewController? {
            guard let controller = webView?.window?.rootViewController else { return nil }
            var top = controller
            while let next = top.presentedViewController { top = next }
            return top
        }

        private func shareFile(_ payload: [String: Any], completion: @escaping RunEngine.Reply) {
            do {
                guard !sharing, let top = presenter(), !(top is UIAlertController),
                      let name = payload["name"] as? String, name.count <= 120, !name.isEmpty,
                      !name.hasPrefix("."), !name.contains(".."),
                      !name.contains("/"), !name.contains("\\"),
                      name.unicodeScalars.allSatisfy({ CharacterSet.alphanumerics.contains($0) || " ._-".unicodeScalars.contains($0) }),
                      let mime = payload["mime"] as? String,
                      let content = payload["content"] as? String,
                      content.utf8.count <= 64 * 1024 * 1024 else {
                    throw RunEngine.Failure.message("Не удалось подготовить файл. Проверьте имя и размер (до 64 МиБ).")
                }
                let extensionName = (name as NSString).pathExtension.lowercased()
                guard (extensionName == "json" && mime == "application/json")
                        || (extensionName == "ics" && mime == "text/calendar") else {
                    throw RunEngine.Failure.message("Разрешены только текстовые файлы JSON и ICS.")
                }
                var folder = FileManager.default.temporaryDirectory.appendingPathComponent("RitmShare-" + UUID().uuidString, isDirectory: true)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                var values = URLResourceValues()
                values.isExcludedFromBackup = true
                try folder.setResourceValues(values)
                let file = folder.appendingPathComponent(name, isDirectory: false)
                do { try Data(content.utf8).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
                catch { try? FileManager.default.removeItem(at: folder); throw error }
                let activity = UIActivityViewController(activityItems: [file], applicationActivities: nil)
                activity.popoverPresentationController?.sourceView = top.view
                activity.popoverPresentationController?.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.midY, width: 1, height: 1)
                sharing = true
                activity.completionWithItemsHandler = { [weak self] _, _, _, _ in
                    try? FileManager.default.removeItem(at: folder)
                    self?.sharing = false
                }
                top.present(activity, animated: true) { completion(.success(["presented": true])) }
            } catch { completion(.failure(error)) }
        }

        private func showAlert(webView: WKWebView, message: String, completionHandler: @escaping () -> Void) {
            guard let controller = webView.window?.rootViewController else { completionHandler(); return }
            var top = controller
            while let next = top.presentedViewController { top = next }
            let alert = UIAlertController(title: "Ритм", message: String(message.prefix(1000)), preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Хорошо", style: .default) { _ in completionHandler() })
            top.present(alert, animated: true)
        }
    }
}
