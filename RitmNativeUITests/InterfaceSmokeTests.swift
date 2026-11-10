import XCTest

final class InterfaceSmokeTests: XCTestCase {
    func testOfflineInterfaceStartsAndSettingsOpen() throws {
        let app = XCUIApplication()
        app.launch()
        let addProgram = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Добавить тренировку")).firstMatch
        XCTAssertTrue(addProgram.waitForExistence(timeout: 30), "Offline interface did not start: \(app.debugDescription)")
        let settings = app.webViews.buttons["Настройки"]
        XCTAssertTrue(settings.exists)
        settings.tap()
        let bundledStatus = app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "На iPhone")).firstMatch
        XCTAssertTrue(bundledStatus.waitForExistence(timeout: 10), "Native bridge unavailable: \(app.debugDescription)")
        app.terminate()
        app.launch()
        XCTAssertTrue(addProgram.waitForExistence(timeout: 30), "Saved empty app failed to reopen: \(app.debugDescription)")
    }
}
