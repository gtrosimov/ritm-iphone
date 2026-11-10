import SwiftUI

@main
@MainActor
struct RitmNativeApp: App {
    @StateObject private var engine = RunEngine()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            VStack(spacing: 0) {
                if let error = engine.persistenceError {
                    Text(error).font(.caption).foregroundColor(.white)
                        .padding(10).frame(maxWidth: .infinity).background(Color.red)
                }
                AppWebView(engine: engine)
            }
            .background(Color(red: 0.063, green: 0.078, blue: 0.078))
            .preferredColorScheme(.dark)
            .onChange(of: scenePhase) { phase in
                if phase != .active { engine.checkpoint() }
            }
        }
    }
}
