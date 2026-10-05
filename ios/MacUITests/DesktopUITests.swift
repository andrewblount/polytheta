import XCTest

final class DesktopUITests: XCTestCase {
    @MainActor
    func testArchiveDetailDoesNotTrapSidebarNavigation() throws {
        let app = XCUIApplication()
        app.launch()
        if !app.windows.firstMatch.waitForExistence(timeout: 3) {
            app.menuBars.menuBarItems["File"].click()
            app.menuItems["New Window"].click()
        }
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Archive")).firstMatch.click()
        let basket = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "2026-")).firstMatch
        XCTAssertTrue(basket.waitForExistence(timeout: 20), "The configured archive must load")
        basket.click()
        XCTAssertTrue(app.buttons["Back"].waitForExistence(timeout: 5))
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Settings")).firstMatch.click()
        XCTAssertTrue(app.descendants(matching: .any)["settings.panels"].waitForExistence(timeout: 5), "Sidebar selection must replace an open archive detail")
    }

    @MainActor
    func testInitialBasketLoadIsNotCancelledByDesktopNavigation() throws {
        let app = XCUIApplication()
        app.launch()
        if !app.windows.firstMatch.waitForExistence(timeout: 3) {
            app.menuBars.menuBarItems["File"].click()
            app.menuItems["New Window"].click()
        }
        let basket = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Basket")).firstMatch
        XCTAssertTrue(basket.waitForExistence(timeout: 5))
        let cancelled = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] %@", "cancelled")).firstMatch
        XCTAssertFalse(cancelled.waitForExistence(timeout: 3), "Opening a screen must not surface a cancelled loading task")
    }

    @MainActor
    func testRefreshAndTradeFormAreAvailableOnDesktop() throws {
        let app = XCUIApplication()
        app.launch()
        if !app.windows.firstMatch.waitForExistence(timeout: 3) {
            app.menuBars.menuBarItems["File"].click()
            app.menuItems["New Window"].click()
        }
        for title in ["Basket", "Trades", "Alerts", "Performance", "Archive"] {
            let destination = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", title)).firstMatch
            XCTAssertTrue(destination.waitForExistence(timeout: 5))
            destination.click()
            XCTAssertTrue(app.buttons["Refresh"].waitForExistence(timeout: 3), "\(title) needs a desktop refresh action")
        }
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Trades")).firstMatch.click()
        app.buttons["Log trade"].click()
        XCTAssertTrue(app.buttons["Cancel"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.scrollViews.firstMatch.exists)
        app.buttons["Cancel"].click()
    }

    @MainActor
    func testDesktopNavigationAndSettingsLayout() throws {
        let app = XCUIApplication()
        app.launch()
        if !app.windows.firstMatch.waitForExistence(timeout: 3) {
            app.menuBars.menuBarItems["File"].click()
            app.menuItems["New Window"].click()
        }
        let settings = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Settings")).firstMatch
        XCTAssertTrue(settings.waitForExistence(timeout: 10), "Desktop navigation must expose Settings")
        for destination in ["Live IB", "Basket", "Trades", "Alerts", "Performance", "Archive"] {
            XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", destination)).firstMatch.exists, "Missing iOS destination: \(destination)")
        }
        settings.click()
        let panels = app.descendants(matching: .any)["settings.panels"]
        XCTAssertTrue(panels.waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "API token")).firstMatch.exists)
        XCTAssertTrue(app.buttons["Test connection"].isHittable)
        panels.radioButtons["Model"].click()
        XCTAssertTrue(app.buttons["Save model settings"].exists)
        panels.radioButtons["Trading"].click()
        XCTAssertTrue(app.descendants(matching: .any)["broker.accountMode"].exists)
        panels.radioButtons["Notifications"].click()
        XCTAssertTrue(app.buttons["Enable Mac notifications"].exists)
        let email = app.switches["briefing_open.email"]
        let sms = app.switches["briefing_open.sms"]
        XCTAssertTrue(email.exists)
        XCTAssertTrue(sms.exists)
        XCTAssertGreaterThan(sms.frame.minY, email.frame.maxY, "Notification switches must occupy separate rows")
        XCTAssertTrue(app.scrollViews.firstMatch.exists, "Long settings must scroll")
    }
}
