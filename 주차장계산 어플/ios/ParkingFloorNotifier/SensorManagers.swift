import CoreLocation
import CoreMotion
import Foundation

@MainActor
final class PressureMonitor: ObservableObject {
    @Published private(set) var currentPressureHPa: Double?
    @Published private(set) var isAvailable = CMAltimeter.isRelativeAltitudeAvailable()

    private let altimeter = CMAltimeter()

    func start() {
        guard CMAltimeter.isRelativeAltitudeAvailable() else {
            isAvailable = false
            return
        }
        altimeter.startRelativeAltitudeUpdates(to: .main) { [weak self] data, _ in
            guard let self, let pressure = data?.pressure.doubleValue else { return }
            Task { @MainActor in
                self.currentPressureHPa = pressure * 10.0
            }
        }
    }

    func stop() {
        altimeter.stopRelativeAltitudeUpdates()
    }
}

@MainActor
final class LocationMonitor: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published private(set) var currentLocation: CLLocation?
    @Published private(set) var authorizationStatus: CLAuthorizationStatus

    private let manager = CLLocationManager()

    override init() {
        authorizationStatus = manager.authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    func requestPermission() {
        manager.requestWhenInUseAuthorization()
    }

    func start() {
        manager.startUpdatingLocation()
    }

    func requestOnce() {
        manager.requestLocation()
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authorizationStatus = manager.authorizationStatus
        if authorizationStatus == .authorizedWhenInUse || authorizationStatus == .authorizedAlways {
            manager.startUpdatingLocation()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        currentLocation = locations.last
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    }
}
