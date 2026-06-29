import SwiftUI

private let accent = Color(red: 0.37, green: 0.28, blue: 0.86)
private let softAccent = Color(red: 0.93, green: 0.91, blue: 1.0)

struct RootView: View {
    @EnvironmentObject private var model: ParkingAppModel

    var body: some View {
        Group {
            if model.settings.setupComplete {
                MainTabView()
            } else {
                OnboardingView()
            }
        }
        .tint(accent)
        .onReceive(model.pressure.$currentPressureHPa) { _ in
            model.updateFromPressure()
        }
    }
}

struct OnboardingView: View {
    @EnvironmentObject private var model: ParkingAppModel
    @State private var initialFloor: Int?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("환영합니다")
                        .font(.largeTitle.bold())
                    Text("iPhone에서 주차층을 기록하려면 기본 설정만 해두면 됩니다.")
                        .foregroundStyle(.secondary)

                    SetupCard(systemName: "house.fill", title: "우리집 위치", done: model.settings.homeLocation != nil) {
                        Text(model.settings.homeLocation == nil ? "현재 위치를 우리집 주차장 기준으로 저장합니다." : "우리집 위치가 등록되었습니다.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Button("현재 위치로 등록") {
                            model.saveHomeFromCurrentLocation()
                        }
                        .buttonStyle(.borderedProminent)
                    }

                    SetupCard(systemName: "parkingsign.circle.fill", title: "주차장 층수", done: true) {
                        Stepper("지상 \(model.settings.garageAbove)층", value: Binding(
                            get: { model.settings.garageAbove },
                            set: { model.setGarageFloors(above: $0, below: model.settings.garageBelow) }
                        ), in: 1...FloorConstants.maxGarageFloors)
                        Stepper("지하 \(model.settings.garageBelow)층", value: Binding(
                            get: { model.settings.garageBelow },
                            set: { model.setGarageFloors(above: model.settings.garageAbove, below: $0) }
                        ), in: 1...FloorConstants.maxGarageFloors)
                    }

                    SetupCard(systemName: "car.fill", title: "현재 주차 위치", done: initialFloor != nil) {
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 8) {
                            ForEach(Array(model.floorRange), id: \.self) { floor in
                                FloorButton(
                                    title: floorIndexToLabel(floor),
                                    selected: initialFloor == floor
                                ) {
                                    initialFloor = floor
                                }
                            }
                        }
                    }

                    Button("시작하기") {
                        model.completeSetup(initialFloor: initialFloor)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .frame(maxWidth: .infinity)
                    .disabled(model.settings.homeLocation == nil)
                }
                .padding(20)
            }
        }
    }
}

struct MainTabView: View {
    @EnvironmentObject private var model: ParkingAppModel

    var body: some View {
        TabView(selection: $model.selectedTab) {
            HomeView()
                .tabItem { Label("홈", systemImage: "house.fill") }
                .tag(0)
            RecordsView()
                .tabItem { Label("기록", systemImage: "clock.fill") }
                .tag(1)
            SettingsView()
                .tabItem { Label("설정", systemImage: "gearshape.fill") }
                .tag(2)
        }
    }
}

struct HomeView: View {
    @EnvironmentObject private var model: ParkingAppModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    VStack(spacing: 10) {
                        Image(systemName: "car.circle.fill")
                            .font(.system(size: 54))
                            .foregroundStyle(accent)
                        Text(model.lastParked.map { floorIndexToLabel($0.floorIndex) } ?? "기록 없음")
                            .font(.system(size: 40, weight: .black))
                        Text(model.lastParked.map { relativeTime($0.timeMillis) } ?? "아직 저장된 주차층이 없습니다.")
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(24)
                    .background(softAccent, in: RoundedRectangle(cornerRadius: 20))

                    StatusGrid()

                    VStack(spacing: 10) {
                        Button(model.isTracking ? "현재 층 기록하기" : "주차 감지 시작") {
                            model.isTracking ? model.saveCurrentFloor() : model.startTracking()
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .frame(maxWidth: .infinity)
                        .disabled(model.pressure.currentPressureHPa == nil)

                        Button("여기를 기준층으로 설정") {
                            model.setBaselineHere()
                        }
                        .buttonStyle(.bordered)
                        .frame(maxWidth: .infinity)

                        if model.isTracking {
                            Button("추적 중지") {
                                model.stopTracking()
                            }
                            .buttonStyle(.bordered)
                            .foregroundStyle(.red)
                        }
                    }

                    ManualFloorGrid()
                }
                .padding(16)
            }
            .navigationTitle("주차층알리미")
        }
    }
}

struct StatusGrid: View {
    @EnvironmentObject private var model: ParkingAppModel

    var body: some View {
        Grid(horizontalSpacing: 12, verticalSpacing: 12) {
            GridRow {
                MetricTile(title: "실시간 추정", value: model.currentFloor.map { floorIndexToLabel($0) } ?? "기준 필요")
                MetricTile(title: "현재 기압", value: model.pressure.currentPressureHPa.map { String(format: "%.2f hPa", $0) } ?? "측정 중")
            }
            GridRow {
                MetricTile(title: "집까지 거리", value: distanceText)
                MetricTile(title: "기압 상승", value: String(format: "%+.2f hPa", model.maxRiseHPa))
            }
        }
    }

    private var distanceText: String {
        guard let distance = model.distanceToHome else { return "확인 중" }
        if distance < 1000 { return String(format: "%.0f m", distance) }
        return String(format: "%.1f km", distance / 1000)
    }
}

struct ManualFloorGrid: View {
    @EnvironmentObject private var model: ParkingAppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("수동 기록")
                .font(.headline)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 8) {
                ForEach(Array(model.floorRange), id: \.self) { floor in
                    FloorButton(title: floorIndexToLabel(floor), selected: false) {
                        model.saveParked(floorIndex: floor)
                    }
                }
            }
        }
        .padding(16)
        .background(.background, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(.quaternary))
    }
}

struct RecordsView: View {
    @EnvironmentObject private var model: ParkingAppModel
    @State private var editingRecord: ParkedResult?

    var body: some View {
        NavigationStack {
            List {
                if model.history.isEmpty {
                    ContentUnavailableView("기록 없음", systemImage: "parkingsign", description: Text("주차층을 기록하면 여기에 쌓입니다."))
                } else {
                    ForEach(model.history) { record in
                        Button {
                            editingRecord = record
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(floorIndexToLabel(record.floorIndex))
                                        .font(.headline)
                                    Text(relativeTime(record.timeMillis))
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                Image(systemName: "pencil")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("최근 기록")
            .toolbar {
                Button("비우기") { model.clearHistory() }
                    .disabled(model.history.isEmpty)
            }
            .sheet(item: $editingRecord) { record in
                FloorEditView(record: record)
            }
        }
    }
}

struct FloorEditView: View {
    @EnvironmentObject private var model: ParkingAppModel
    @Environment(\.dismiss) private var dismiss
    let record: ParkedResult

    var body: some View {
        NavigationStack {
            List(Array(model.floorRange), id: \.self) { floor in
                Button {
                    model.editRecord(record, floorIndex: floor)
                    dismiss()
                } label: {
                    HStack {
                        Text(floorIndexToLabel(floor))
                        Spacer()
                        if floor == record.floorIndex {
                            Image(systemName: "checkmark")
                        }
                    }
                }
            }
            .navigationTitle("층 수정")
            .toolbar {
                Button("닫기") { dismiss() }
            }
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var model: ParkingAppModel

    var body: some View {
        NavigationStack {
            Form {
                Section("우리집") {
                    Button("현재 위치로 우리집 다시 등록") {
                        model.saveHomeFromCurrentLocation()
                    }
                    if let distance = model.distanceToHome {
                        LabeledContent("현재 거리", value: distance < 1000 ? String(format: "%.0f m", distance) : String(format: "%.1f km", distance / 1000))
                    }
                    Slider(value: Binding(
                        get: { model.settings.homeLocation?.radius ?? FloorConstants.defaultHomeRadius },
                        set: {
                            if model.settings.homeLocation == nil {
                                model.saveHomeFromCurrentLocation()
                            }
                            model.settings.homeLocation?.radius = $0
                            model.saveSettings()
                        }
                    ), in: 50...500, step: 10) {
                        Text("반경")
                    }
                    LabeledContent("반경", value: "\(Int(model.settings.homeLocation?.radius ?? FloorConstants.defaultHomeRadius)) m")
                }

                Section("주차장") {
                    Stepper("지상 \(model.settings.garageAbove)층", value: Binding(
                        get: { model.settings.garageAbove },
                        set: { model.setGarageFloors(above: $0, below: model.settings.garageBelow) }
                    ), in: 1...FloorConstants.maxGarageFloors)
                    Stepper("지하 \(model.settings.garageBelow)층", value: Binding(
                        get: { model.settings.garageBelow },
                        set: { model.setGarageFloors(above: model.settings.garageAbove, below: $0) }
                    ), in: 1...FloorConstants.maxGarageFloors)
                }

                Section("보정") {
                    Slider(value: Binding(
                        get: { model.settings.hPaPerFloor },
                        set: {
                            model.settings.hPaPerFloor = $0
                            model.saveSettings()
                        }
                    ), in: 0.15...1.0, step: 0.01) {
                        Text("층당 기압차")
                    }
                    LabeledContent("층당 기압차", value: String(format: "%.2f hPa", model.settings.hPaPerFloor))
                }

                Section("iPhone 자동화") {
                    Text("iOS는 일반 앱의 차량 블루투스 연결 해제 감지를 제한합니다. 첫 버전은 기압 추정과 수동 기록을 중심으로 동작합니다.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("설정")
        }
    }
}

struct SetupCard<Content: View>: View {
    let systemName: String
    let title: String
    let done: Bool
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: done ? "checkmark.circle.fill" : systemName)
                    .foregroundStyle(done ? .green : accent)
                    .font(.title2)
                Text(title)
                    .font(.headline)
            }
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(.quaternary))
    }
}

struct MetricTile: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.headline)
                .lineLimit(2)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity, minHeight: 76, alignment: .leading)
        .padding(14)
        .background(.background, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(.quaternary))
    }
}

struct FloorButton: View {
    let title: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.bordered)
        .background(selected ? softAccent : .clear, in: RoundedRectangle(cornerRadius: 8))
    }
}

func relativeTime(_ millis: Int64) -> String {
    let date = Date(timeIntervalSince1970: TimeInterval(millis) / 1000)
    let calendar = Calendar.current
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "ko_KR")
    formatter.dateFormat = "a h:mm"

    if calendar.isDateInToday(date) {
        return "오늘 \(formatter.string(from: date))"
    }
    if calendar.isDateInYesterday(date) {
        return "어제 \(formatter.string(from: date))"
    }
    formatter.dateFormat = "M월 d일 a h:mm"
    return formatter.string(from: date)
}
