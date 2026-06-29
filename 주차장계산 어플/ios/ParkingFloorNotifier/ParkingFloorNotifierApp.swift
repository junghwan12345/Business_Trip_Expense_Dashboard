import SwiftUI

@main
struct ParkingFloorNotifierApp: App {
    @StateObject private var model = ParkingAppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
        }
    }
}
