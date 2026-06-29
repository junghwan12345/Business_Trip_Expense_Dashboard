import Foundation

struct ParkingSettings: Codable, Equatable {
    var hPaPerFloor = FloorConstants.defaultHPaPerFloor
    var homeLocation: HomeLocation?
    var garageAbove = 1
    var garageBelow = 5
    var setupComplete = false
    var autoStartEnabled = false
}

final class ParkingStore {
    private enum Key {
        static let settings = "parking.settings"
        static let history = "parking.history"
    }

    private let defaults = UserDefaults.standard
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    func loadSettings() -> ParkingSettings {
        guard let data = defaults.data(forKey: Key.settings),
              let settings = try? decoder.decode(ParkingSettings.self, from: data) else {
            return ParkingSettings()
        }
        return settings
    }

    func saveSettings(_ settings: ParkingSettings) {
        guard let data = try? encoder.encode(settings) else { return }
        defaults.set(data, forKey: Key.settings)
    }

    func loadHistory() -> [ParkedResult] {
        guard let data = defaults.data(forKey: Key.history),
              let history = try? decoder.decode([ParkedResult].self, from: data) else {
            return []
        }
        return history
    }

    func saveHistory(_ history: [ParkedResult]) {
        guard let data = try? encoder.encode(history) else { return }
        defaults.set(data, forKey: Key.history)
    }
}
