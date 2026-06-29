import Foundation

enum FloorConstants {
    static let defaultHPaPerFloor = 0.40
    static let defaultHomeRadius = 150.0
    static let noFloor = -999
    static let outsideFloor = -100
    static let maxGarageFloors = 5

    static func minFloorIndex(garageAbove: Int) -> Int {
        -(max(1, garageAbove) - 1)
    }
}

struct HomeLocation: Codable, Equatable {
    var latitude: Double
    var longitude: Double
    var radius: Double
}

struct ParkedResult: Codable, Identifiable, Equatable {
    var floorIndex: Int
    var timeMillis: Int64

    var id: Int64 { timeMillis }
    var hasResult: Bool {
        floorIndex != FloorConstants.noFloor && floorIndex != FloorConstants.outsideFloor
    }
}

enum FloorCalculator {
    static func floorIndex(
        baseline: Double,
        current: Double,
        hPaPerFloor: Double,
        minIndex: Int,
        maxIndex: Int
    ) -> Int {
        guard hPaPerFloor > 0 else { return 0 }
        let raw = Int((current - baseline) / hPaPerFloor).rounded()
        return min(max(raw, minIndex), maxIndex)
    }
}

enum ParkingDecider {
    static let minDescentHPa = 0.20
    static let noiseHPa = 0.06

    static func descended(maxRiseHPa: Double) -> Bool {
        maxRiseHPa >= minDescentHPa
    }
}

func floorIndexToLabel(_ index: Int) -> String {
    if index == FloorConstants.outsideFloor { return "집 밖 주차 중" }
    if index <= 0 { return "지상 \(1 - index)층" }
    return "지하 \(index)층"
}

func floorShortLabel(_ index: Int) -> String {
    if index == FloorConstants.outsideFloor { return "OUT" }
    if index <= 0 { return "G\(1 - index)" }
    return "B\(index)"
}

func currentTimeMillis() -> Int64 {
    Int64(Date().timeIntervalSince1970 * 1000)
}
