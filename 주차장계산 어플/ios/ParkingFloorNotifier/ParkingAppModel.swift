import Combine
import CoreLocation
import Foundation
import UserNotifications

@MainActor
final class ParkingAppModel: ObservableObject {
    @Published var settings: ParkingSettings
    @Published var history: [ParkedResult]
    @Published var baselinePressure: Double?
    @Published var isTracking = false
    @Published var maxRiseHPa = 0.0
    @Published var selectedTab = 0

    let pressure = PressureMonitor()
    let location = LocationMonitor()

    private let store = ParkingStore()
    private var cancellables = Set<AnyCancellable>()

    init() {
        settings = store.loadSettings()
        history = store.loadHistory()
        pressure.objectWillChange
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &cancellables)
        location.objectWillChange
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &cancellables)
        pressure.start()
        location.start()
        requestNotifications()
    }

    var lastParked: ParkedResult? {
        history.first(where: { $0.hasResult })
    }

    var floorRange: ClosedRange<Int> {
        FloorConstants.minFloorIndex(garageAbove: settings.garageAbove)...settings.garageBelow
    }

    var currentFloor: Int? {
        guard let baselinePressure,
              let current = pressure.currentPressureHPa else { return nil }
        return FloorCalculator.floorIndex(
            baseline: baselinePressure,
            current: current,
            hPaPerFloor: settings.hPaPerFloor,
            minIndex: floorRange.lowerBound,
            maxIndex: floorRange.upperBound
        )
    }

    var distanceToHome: Double? {
        guard let home = settings.homeLocation,
              let current = location.currentLocation else { return nil }
        let homeLocation = CLLocation(latitude: home.latitude, longitude: home.longitude)
        return current.distance(from: homeLocation)
    }

    var isInsideHome: Bool? {
        guard let distance = distanceToHome,
              let radius = settings.homeLocation?.radius else { return nil }
        return distance <= radius
    }

    func updateFromPressure() {
        guard isTracking,
              let baselinePressure,
              let current = pressure.currentPressureHPa else { return }
        maxRiseHPa = max(maxRiseHPa, current - baselinePressure)
    }

    func setBaselineHere() {
        baselinePressure = pressure.currentPressureHPa
        maxRiseHPa = 0
    }

    func startTracking() {
        if baselinePressure == nil {
            setBaselineHere()
        }
        isTracking = true
    }

    func stopTracking() {
        isTracking = false
    }

    func saveCurrentFloor() {
        guard let floor = currentFloor else { return }
        saveParked(floorIndex: floor)
        isTracking = false
    }

    func saveParked(floorIndex: Int) {
        guard floorIndex != FloorConstants.outsideFloor else { return }
        let record = ParkedResult(floorIndex: floorIndex, timeMillis: currentTimeMillis())
        history = ([record] + history).prefix(10).map { $0 }
        store.saveHistory(history)
        sendParkedNotification(floorIndex: floorIndex)
    }

    func editRecord(_ record: ParkedResult, floorIndex: Int) {
        history = history.map {
            $0.timeMillis == record.timeMillis
            ? ParkedResult(floorIndex: floorIndex, timeMillis: record.timeMillis)
            : $0
        }
        store.saveHistory(history)
    }

    func clearHistory() {
        history = []
        store.saveHistory(history)
    }

    func saveHomeFromCurrentLocation() {
        guard let current = location.currentLocation else {
            location.requestPermission()
            location.requestOnce()
            return
        }
        settings.homeLocation = HomeLocation(
            latitude: current.coordinate.latitude,
            longitude: current.coordinate.longitude,
            radius: settings.homeLocation?.radius ?? FloorConstants.defaultHomeRadius
        )
        saveSettings()
    }

    func setGarageFloors(above: Int, below: Int) {
        settings.garageAbove = min(max(above, 1), FloorConstants.maxGarageFloors)
        settings.garageBelow = min(max(below, 1), FloorConstants.maxGarageFloors)
        saveSettings()
    }

    func completeSetup(initialFloor: Int?) {
        if let initialFloor {
            saveParked(floorIndex: initialFloor)
        }
        settings.setupComplete = true
        saveSettings()
    }

    func saveSettings() {
        store.saveSettings(settings)
    }

    private func requestNotifications() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    private func sendParkedNotification(floorIndex: Int) {
        let content = UNMutableNotificationContent()
        content.title = "\(floorIndexToLabel(floorIndex)) 주차 완료"
        content.body = "방금 기록한 주차층을 저장했어요."
        content.sound = .default
        let request = UNNotificationRequest(
            identifier: "parked-\(currentTimeMillis())",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }
}
