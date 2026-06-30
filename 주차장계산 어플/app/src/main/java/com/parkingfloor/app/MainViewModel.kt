package com.parkingfloor.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Application
import android.bluetooth.BluetoothManager
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.parkingfloor.app.bt.CarBtConnection
import com.parkingfloor.app.data.CalibrationStore
import com.parkingfloor.app.data.CarBtDevice
import com.parkingfloor.app.data.FloorCalculator
import com.parkingfloor.app.data.HomeLocation
import com.parkingfloor.app.data.ParkedResult
import com.parkingfloor.app.sensor.PressureManager
import com.parkingfloor.app.service.ParkingTrackingService
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * 1단계 화면 상태.
 *  - 실시간 기압 표시
 *  - "여기가 지상1층(입구)" 기준점 설정
 *  - 기준점 대비 추정 층수 계산
 */
class MainViewModel(app: Application) : AndroidViewModel(app) {

    private val pressureManager = PressureManager(app)
    private val calibrationStore = CalibrationStore(app)

    val sensorAvailable: Boolean = pressureManager.isAvailable

    /** 현재(필터링된) 기압 hPa. 센서 없으면 NaN. */
    val currentPressure: StateFlow<Float> =
        pressureManager.pressureFlow().stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = Float.NaN
        )

    /** 지상1층 입구 기준 기압 P0. null이면 아직 설정 안 됨. */
    private val _baselinePressure = MutableStateFlow<Float?>(null)
    val baselinePressure: StateFlow<Float?> = _baselinePressure.asStateFlow()

    /** 층당 기압차 (캘리브레이션 값) */
    private val _hPaPerFloor = MutableStateFlow(CalibrationStore.DEFAULT_HPA_PER_FLOOR)
    val hPaPerFloor: StateFlow<Float> = _hPaPerFloor.asStateFlow()

    private val _entryPressureCorrection = MutableStateFlow(CalibrationStore.DEFAULT_ENTRY_PRESSURE_CORRECTION)
    val entryPressureCorrection: StateFlow<Float> = _entryPressureCorrection.asStateFlow()

    /** 앱(프로세스) 시작 시점에 우리집 위치가 이미 등록돼 있었는지 스냅샷. null=확인 전. */
    private val _hadHomeAtStart = MutableStateFlow<Boolean?>(null)

    init {
        viewModelScope.launch {
            _hPaPerFloor.value = calibrationStore.hPaPerFloor.first()
        }
        viewModelScope.launch {
            calibrationStore.entryPressureCorrection.collect {
                _entryPressureCorrection.value = it
            }
        }
        viewModelScope.launch {
            _hadHomeAtStart.value = calibrationStore.homeLocation.first() != null
        }
    }

    /** "여기가 지상1층" 버튼: 현재 기압을 기준점으로 저장 */
    fun setBaselineHere() {
        val p = currentPressure.value
        if (!p.isNaN()) {
            _baselinePressure.value = p
        }
    }

    fun clearBaseline() {
        _baselinePressure.value = null
    }

    /** 층당 기압차 조정 (튜닝용) */
    fun updateHPaPerFloor(value: Float) {
        _hPaPerFloor.value = value
        viewModelScope.launch { calibrationStore.setHPaPerFloor(value) }
    }

    fun updateEntryPressureCorrection(value: Float) {
        _entryPressureCorrection.value = value
        viewModelScope.launch { calibrationStore.setEntryPressureCorrection(value) }
    }

    val floorPressureSamples: StateFlow<Map<Int, Float>> =
        calibrationStore.floorPressureSamples.stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = emptyMap()
        )

    fun recordFloorPressure(floorIndex: Int) {
        val p = currentPressure.value
        if (p.isNaN()) return
        viewModelScope.launch { calibrationStore.saveFloorPressureSample(floorIndex, p) }
    }

    /**
     * 추정 층 인덱스. 기준점/센서값 없으면 null.
     * 지하로 갈수록 기압이 오르므로 (현재 - 기준) / 층당기압차.
     */
    fun estimatedFloorIndex(): Int? {
        val base = _baselinePressure.value ?: return null
        val now = currentPressure.value
        if (now.isNaN()) return null
        val perFloor = _hPaPerFloor.value
        if (perFloor <= 0f) return null
        return FloorCalculator.floorIndex(base, now, perFloor)
    }

    // ---- 2단계: 백그라운드 자동 추적 ----

    /** 서비스 추적 상태 (서비스 companion에서 관찰) */
    val isTracking: StateFlow<Boolean> = ParkingTrackingService.isTracking
    val trackingStatus: StateFlow<String> = ParkingTrackingService.statusText

    /** 마지막 자동 감지된 주차 결과 */
    val lastParked: StateFlow<ParkedResult> =
        calibrationStore.lastParked.stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = ParkedResult(CalibrationStore.NO_FLOOR, 0L)
        )

    /** 주차 기록 이력 (최신순, 최대 10건) */
    val parkingHistory: StateFlow<List<ParkedResult>> =
        calibrationStore.parkingHistory.stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = emptyList()
        )

    /** 층 수동 수정 — 현재 시각으로 새 기록 추가 */
    fun overrideFloor(index: Int) {
        viewModelScope.launch {
            calibrationStore.appendParked(index, System.currentTimeMillis())
            com.parkingfloor.app.widget.ParkingWidgetProvider.updateAll(getApplication())
        }
    }

    /** 기존 기록의 층 수정 (기록 목록에서) */
    fun editRecordFloor(timeMillis: Long, newIndex: Int) {
        viewModelScope.launch {
            calibrationStore.editRecordFloor(timeMillis, newIndex)
            com.parkingfloor.app.widget.ParkingWidgetProvider.updateAll(getApplication())
        }
    }

    // ---- 우리집 주차장 층수 (지상/지하) ----

    val garageAbove: StateFlow<Int> = calibrationStore.garageAbove.stateIn(
        viewModelScope, SharingStarted.WhileSubscribed(5000), CalibrationStore.DEFAULT_GARAGE_ABOVE
    )
    val garageBelow: StateFlow<Int> = calibrationStore.garageBelow.stateIn(
        viewModelScope, SharingStarted.WhileSubscribed(5000), CalibrationStore.DEFAULT_GARAGE_BELOW
    )

    fun setGarageFloors(above: Int, below: Int) {
        viewModelScope.launch { calibrationStore.setGarageFloors(above, below) }
    }

    fun startTracking() {
        val ctx = getApplication<Application>()
        val intent = Intent(ctx, ParkingTrackingService::class.java).apply {
            action = ParkingTrackingService.ACTION_START
        }
        ContextCompat.startForegroundService(ctx, intent)
    }

    fun stopTracking() {
        val ctx = getApplication<Application>()
        val intent = Intent(ctx, ParkingTrackingService::class.java).apply {
            action = ParkingTrackingService.ACTION_STOP
        }
        ctx.startService(intent)
    }

    fun clearParked() {
        viewModelScope.launch { calibrationStore.clearParked() }
    }

    /** 출차/다시 감지: 서비스 잠금 해제 + 기록 비우기 (+ 자동 모드면 즉시 재시작) */
    fun rearm() {
        val ctx = getApplication<Application>()
        ContextCompat.startForegroundService(
            ctx,
            Intent(ctx, ParkingTrackingService::class.java)
                .apply { action = ParkingTrackingService.ACTION_REARM }
        )
    }

    // ---- 3단계: 자동차 블루투스 등록 ----

    val carBtDevice: StateFlow<CarBtDevice?> =
        calibrationStore.carBtDevice.stateIn(
            viewModelScope, SharingStarted.WhileSubscribed(5000), null
        )

    /** 페어링된 블루투스 기기 목록 (권한 없으면 빈 목록) */
    @SuppressLint("MissingPermission")
    fun bondedDevices(): List<CarBtDevice> {
        val mgr = getApplication<Application>()
            .getSystemService(BluetoothManager::class.java) ?: return emptyList()
        val adapter = mgr.adapter ?: return emptyList()
        return try {
            adapter.bondedDevices?.map { CarBtDevice(it.address, it.name ?: it.address) }
                ?.sortedBy { it.name } ?: emptyList()
        } catch (e: SecurityException) {
            emptyList()
        }
    }

    fun setCarBtDevice(device: CarBtDevice) {
        viewModelScope.launch { calibrationStore.setCarBtDevice(device.address, device.name) }
    }

    fun clearCarBtDevice() {
        viewModelScope.launch { calibrationStore.clearCarBtDevice() }
    }

    // ---- 4단계: 우리집 위치 + 자동 시작 ----

    val homeLocation: StateFlow<HomeLocation?> =
        calibrationStore.homeLocation.stateIn(
            viewModelScope, SharingStarted.WhileSubscribed(5000), null
        )

    val autoStartEnabled: StateFlow<Boolean> =
        calibrationStore.autoStartEnabled.stateIn(
            viewModelScope, SharingStarted.WhileSubscribed(5000), false
        )

    /**
     * 첫 실행 설정 마법사 완료 여부. null = 로딩 중(깜빡임 방지).
     * - 명시적 완료 플래그가 true → 완료
     * - 아니면, 앱 시작 시 이미 집이 있었던 기존 사용자 → 완료(업데이트 시 마법사 스킵)
     * - 신규 사용자(시작 시 집 없음)는 온보딩 중 집을 등록해도 튕기지 않음
     */
    val setupComplete: StateFlow<Boolean?> =
        combine(calibrationStore.setupDoneFlag, _hadHomeAtStart) { flag, hadHome ->
            when {
                flag -> true
                hadHome == null -> null
                hadHome -> true
                else -> false
            }
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    fun completeSetup() {
        viewModelScope.launch { calibrationStore.setSetupComplete(true) }
    }

    val isAutoEnabled: StateFlow<Boolean> = ParkingTrackingService.isAutoEnabled

    /** 지도에서 고른 좌표를 우리집으로 등록 (현재 반경 유지). */
    fun saveHome(lat: Double, lng: Double) {
        viewModelScope.launch {
            calibrationStore.setHomeLocation(lat, lng, calibrationStore.homeRadiusOnce())
        }
    }

    val homeRadius: StateFlow<Float> =
        calibrationStore.homeRadius.stateIn(
            viewModelScope, SharingStarted.WhileSubscribed(5000),
            CalibrationStore.DEFAULT_HOME_RADIUS
        )

    fun setHomeRadius(radius: Float) {
        viewModelScope.launch { calibrationStore.setHomeRadius(radius) }
    }

    fun enableAutoStart() {
        val ctx = getApplication<Application>()
        ContextCompat.startForegroundService(
            ctx,
            Intent(ctx, ParkingTrackingService::class.java)
                .apply { action = ParkingTrackingService.ACTION_ENABLE_AUTO }
        )
    }

    /**
     * 앱 실행 시 호출: 자동 모드가 켜져 있는데 서비스가 죽어 있으면(설치/업데이트/강제종료 후) 되살린다.
     * 토글을 껐다 켜야만 동작하던 버그 해결.
     */
    fun resurrectAutoIfNeeded() {
        viewModelScope.launch {
            val enabled = calibrationStore.autoStartEnabled.first()
            if (enabled && !ParkingTrackingService.isAutoEnabled.value) {
                enableAutoStart()
            }
        }
    }

    fun disableAutoStart() {
        val ctx = getApplication<Application>()
        ctx.startService(
            Intent(ctx, ParkingTrackingService::class.java)
                .apply { action = ParkingTrackingService.ACTION_DISABLE_AUTO }
        )
    }

    // ---- 디버그: 실시간 위치/거리 + 추적 신호 ----

    /** 추적 중 내부 신호 (서비스에서 발행) */
    val trackDebug: StateFlow<ParkingTrackingService.TrackDebug?> = ParkingTrackingService.debug

    private val _currentLatLng = MutableStateFlow<Pair<Double, Double>?>(null)

    /** 우리집까지 거리(m). 위치/집 없으면 null */
    val distanceToHome: StateFlow<Float?> =
        combine(_currentLatLng, homeLocation) { cur, h ->
            if (cur != null && h != null) {
                val out = FloatArray(1)
                Location.distanceBetween(cur.first, cur.second, h.lat, h.lng, out)
                out[0]
            } else null
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    /** 지오펜스 안에 있는지 (거리 <= 반경) */
    val insideGeofence: StateFlow<Boolean?> =
        combine(distanceToHome, homeLocation) { d, h ->
            if (d != null && h != null) d <= h.radius else null
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    // 안드로이드 기본 위치 시스템(LocationManager) — Google Play Services에 의존하지 않음
    private val locationManager by lazy {
        getApplication<Application>()
            .getSystemService(android.content.Context.LOCATION_SERVICE) as android.location.LocationManager
    }
    private val nativeListener = object : android.location.LocationListener {
        override fun onLocationChanged(location: Location) {
            _currentLatLng.value = location.latitude to location.longitude
        }
        override fun onProviderEnabled(provider: String) {}
        override fun onProviderDisabled(provider: String) {}
        @Deprecated("deprecated in API 29")
        override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) {}
    }
    private var locationUpdatesActive = false

    /** 사용 가능한 모든 제공자에서 가장 최근의 마지막 위치를 가져와 표시 */
    @SuppressLint("MissingPermission")
    private fun seedLastKnown() {
        runCatching {
            var best: Location? = null
            for (p in locationManager.getProviders(true)) {
                val l = locationManager.getLastKnownLocation(p) ?: continue
                if (best == null || l.time > best!!.time) best = l
            }
            if (best != null) _currentLatLng.value = best!!.latitude to best!!.longitude
        }
    }

    @SuppressLint("MissingPermission")
    fun startLocationDebug() {
        if (!hasLocationPermission()) return
        seedLastKnown()
        if (locationUpdatesActive) return
        runCatching {
            val lm = locationManager
            if (lm.isProviderEnabled(android.location.LocationManager.GPS_PROVIDER)) {
                lm.requestLocationUpdates(
                    android.location.LocationManager.GPS_PROVIDER, 2000L, 0f,
                    nativeListener, Looper.getMainLooper()
                )
            }
            if (lm.isProviderEnabled(android.location.LocationManager.NETWORK_PROVIDER)) {
                lm.requestLocationUpdates(
                    android.location.LocationManager.NETWORK_PROVIDER, 2000L, 0f,
                    nativeListener, Looper.getMainLooper()
                )
            }
            locationUpdatesActive = true
        }
    }

    /** 새로고침 버튼: 마지막 위치 다시 읽기 + 업데이트 재가동 */
    fun requestFreshFix() {
        seedLastKnown()
        if (!locationUpdatesActive) startLocationDebug()
    }

    fun stopLocationDebug() {
        runCatching { locationManager.removeUpdates(nativeListener) }
        locationUpdatesActive = false
    }

    override fun onCleared() {
        stopLocationDebug()
        stopBtMonitor()
        super.onCleared()
    }

    // ---- 평탄화 시간(초) 설정 ----

    val plateauSeconds: StateFlow<Int> =
        calibrationStore.plateauSeconds.stateIn(
            viewModelScope, SharingStarted.WhileSubscribed(5000),
            CalibrationStore.DEFAULT_PLATEAU_SEC
        )

    fun setPlateauSeconds(sec: Int) {
        viewModelScope.launch { calibrationStore.setPlateauSeconds(sec) }
    }

    // ---- 위치 권한/GPS 상태 (진단용) ----

    val currentLatLng: StateFlow<Pair<Double, Double>?> = _currentLatLng.asStateFlow()

    fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(
            getApplication(), Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

    fun isGpsEnabled(): Boolean {
        val lm = getApplication<Application>()
            .getSystemService(android.content.Context.LOCATION_SERVICE) as android.location.LocationManager
        return runCatching {
            lm.isProviderEnabled(android.location.LocationManager.GPS_PROVIDER) ||
                lm.isProviderEnabled(android.location.LocationManager.NETWORK_PROVIDER)
        }.getOrDefault(false)
    }

    // ---- 자동차 BT 현재 연결 상태 (실시간 표시, #3) ----

    private val _carBtConnected = MutableStateFlow<Boolean?>(null)
    val carBtConnected: StateFlow<Boolean?> = _carBtConnected.asStateFlow()

    private var btMonitorReceiver: android.content.BroadcastReceiver? = null
    private val carBtConn = CarBtConnection(app)
    private var btRefreshJob: Job? = null

    @SuppressLint("MissingPermission")
    fun startBtMonitor() {
        if (btMonitorReceiver != null) return
        carBtConn.start()
        // 초기 상태 + 주기적 재확인(8초) — 어긋난 상태 자동 복구
        refreshBtConnected()
        btRefreshJob?.cancel()
        btRefreshJob = viewModelScope.launch {
            while (true) {
                delay(8_000L)
                refreshBtConnected()
            }
        }
        val r = object : android.content.BroadcastReceiver() {
            override fun onReceive(c: android.content.Context?, intent: Intent?) {
                val addr = carBtDevice.value?.address ?: return
                @Suppress("DEPRECATION")
                val dev: android.bluetooth.BluetoothDevice? =
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU)
                        intent?.getParcelableExtra(android.bluetooth.BluetoothDevice.EXTRA_DEVICE,
                            android.bluetooth.BluetoothDevice::class.java)
                    else intent?.getParcelableExtra(android.bluetooth.BluetoothDevice.EXTRA_DEVICE)
                if (dev?.address != addr) return
                when (intent?.action) {
                    android.bluetooth.BluetoothDevice.ACTION_ACL_CONNECTED -> _carBtConnected.value = true
                    android.bluetooth.BluetoothDevice.ACTION_ACL_DISCONNECTED -> _carBtConnected.value = false
                }
            }
        }
        val filter = android.content.IntentFilter().apply {
            addAction(android.bluetooth.BluetoothDevice.ACTION_ACL_CONNECTED)
            addAction(android.bluetooth.BluetoothDevice.ACTION_ACL_DISCONNECTED)
        }
        runCatching { getApplication<Application>().registerReceiver(r, filter) }
        btMonitorReceiver = r
    }

    fun stopBtMonitor() {
        btRefreshJob?.cancel()
        btRefreshJob = null
        carBtConn.stop()
        btMonitorReceiver?.let { r -> runCatching { getApplication<Application>().unregisterReceiver(r) } }
        btMonitorReceiver = null
    }

    /** A2DP/HEADSET 프로파일로 실제 연결 확인. 불명(null)이면 기존 값 유지. */
    fun refreshBtConnected() {
        val addr = carBtDevice.value?.address
        if (addr == null) { _carBtConnected.value = null; return }
        val state = carBtConn.isConnected(addr)
        if (state != null) _carBtConnected.value = state
    }
}
