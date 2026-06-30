package com.parkingfloor.app.service

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothDevice
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.parkingfloor.app.MainActivity
import com.parkingfloor.app.bt.CarBtConnection
import com.parkingfloor.app.data.CalibrationStore
import com.parkingfloor.app.data.FloorCalculator
import com.parkingfloor.app.data.ParkingDecider
import com.parkingfloor.app.data.floorIndexToLabel
import com.parkingfloor.app.sensor.PressureManager
import com.parkingfloor.app.signal.SignalBus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch

/**
 * 주차 자동 감지 Foreground Service.
 *
 * 두 가지 모드로 동작한다:
 *  - 대기(IDLE)  : 자동 시작이 켜져 있으면 항상 떠서 위치(우리집 반경)와 차 블루투스를 감시.
 *                 우리집 반경 진입 또는 차 BT 연결 시 스스로 추적 모드로 전환.
 *  - 추적(ACTIVE): 기압으로 층을 추정하고, 차 BT 끊김(시동 OFF) 또는 기압 평탄화로 주차를 확정.
 */
class ParkingTrackingService : Service() {

    companion object {
        const val ACTION_START = "com.parkingfloor.app.START_TRACKING"        // 추적 시작(수동/도착)
        const val ACTION_STOP = "com.parkingfloor.app.STOP_TRACKING"          // 추적 중지
        const val ACTION_ENABLE_AUTO = "com.parkingfloor.app.ENABLE_AUTO"     // 자동 모드 켜기(대기)
        const val ACTION_DISABLE_AUTO = "com.parkingfloor.app.DISABLE_AUTO"   // 자동 모드 끄기
        const val ACTION_REARM = "com.parkingfloor.app.REARM"                 // 출차/재무장(기록 비우고 다시 감지)

        private const val CHANNEL_ID = "parking_fg_min"        // 상시 백그라운드(거의 안 보임, MIN)
        private const val CHANNEL_DONE = "parking_done"        // 주차 완료(팝업, HIGH)
        private const val NOTI_ID = 1001

        private const val TAG = "ParkingTrack"
        private const val NOISE_HPA = 0.05f
        private const val SIGNAL_WINDOW_MS = 90_000L

        // GPS 튐 대비: 출차는 '반경 + 여유'를 '확정 시간' 이상 벗어났을 때만. 부정확한 샘플은 무시.
        private const val EXIT_MARGIN_M = 200f       // 반경 + 200m 밖이어야 이탈 후보
        private const val EXIT_CONFIRM_MS = 30_000L  // 30초 이상 지속돼야 출차 확정
        private const val MAX_ACCURACY_M = 100f      // 오차 100m 초과 측정은 판정 제외
        private const val SAME_FLOOR_DUPLICATE_MS = 3 * 60_000L
        private const val AUTO_START_RADIUS_M = 15f

        /** 추적(ACTIVE) 중인지 */
        val isTracking = MutableStateFlow(false)
        /** 자동 모드(대기 포함)로 떠 있는지 */
        val isAutoEnabled = MutableStateFlow(false)
        val statusText = MutableStateFlow("")
        /** 실시간 디버그 상태 (추적 중에만 채워짐) */
        val debug = MutableStateFlow<TrackDebug?>(null)
    }

    /** 추적 중 내부 신호 스냅샷 (디버그 화면용) */
    data class TrackDebug(
        val current: Float,
        val baseline: Float,
        val rise: Float,
        val maxRise: Float,
        val floor: Int,
        val descended: Boolean,
        val pressureStable: Boolean,
        val stableForMs: Long,
        val plateauMs: Long,
        val btRecent: Boolean,
        val elapsedMs: Long,
        val reason: String
    )

    private val scope = CoroutineScope(SupervisorJob())
    private var trackingJob: Job? = null

    private lateinit var pressureManager: PressureManager
    private lateinit var store: CalibrationStore

    @Volatile private var carBtAddress: String? = null
    @Volatile private var carBtConnected = false
    private val carBtConn by lazy { CarBtConnection(this) }
    private var autoMode = false
    @Volatile private var parkedThisVisit = false
    // 위치 폴링/업데이트가 갱신하는 "집 범위 안" 캐시 — BT연결 시 lastKnown이 null이어도 판단 가능
    @Volatile private var lastInsideHome = false
    @Volatile private var lastInsideAutoStart = false
    // '여유 반경 밖'에 진입한 시각 (출차 확정 타이머용). -1 = 여유 반경 안.
    @Volatile private var farOutsideSince = -1L
    // 이번 집 방문의 지상1층 기준 기압(P0). 범위 안에서 재주차해도 유지, 범위 벗어나면 초기화.
    @Volatile private var visitBaseline = Float.NaN
    // 주차완료 알림 ID — 매번 달라야 매 주차마다 팝업이 새로 뜸
    private var doneNotiCounter = 0
    private var btReceiver: BroadcastReceiver? = null

    private val locationManager by lazy {
        getSystemService(Context.LOCATION_SERVICE) as android.location.LocationManager
    }
    private var autoLocationListener: android.location.LocationListener? = null
    private var autoJob: Job? = null
    private var homeLat = 0.0
    private var homeLng = 0.0
    private var homeRadius = CalibrationStore.DEFAULT_HOME_RADIUS

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        pressureManager = PressureManager(this)
        store = CalibrationStore(this)
        createChannel()
        // 프로세스가 죽었다 살아난 경우, 이번 방문 기준 기압을 복원
        scope.launch {
            val saved = store.visitBaselineOnce()
            if (!saved.isNaN()) visitBaseline = saved
            parkedThisVisit = store.visitHasParkedOnce()
            Log.d(TAG, "방문 상태 복원: parkedThisVisit=$parkedThisVisit baseline=$visitBaseline")
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_ENABLE_AUTO -> enableAuto()
            ACTION_DISABLE_AUTO -> disableAuto()
            ACTION_START -> startActiveTracking()
            ACTION_STOP -> stopActiveOrAll(userStopped = true)
            ACTION_REARM -> rearm()
            else -> startActiveTracking()
        }
        return START_STICKY
    }

    /** 출차/재무장: 잠금 해제 + 기록 비우기. 자동 모드이고 아직 추적 중이 아니면 즉시 다시 시작. */
    private fun rearm() {
        parkedThisVisit = false
        visitBaseline = Float.NaN   // 새 기준으로 다시 시작
        scope.launch { store.clearParked(); store.clearVisitState() }
        if (autoMode && !isTracking.value) startActiveTracking()
    }

    // ---- 자동 모드(대기) ----

    private fun enableAuto() {
        autoMode = true
        isAutoEnabled.value = true
        startForegroundCompat(foregroundNotification())
        statusText.value = "우리집 도착 대기 중"
        carBtConn.start()
        scope.launch {
            store.setAutoStartEnabled(true)
            carBtAddress = store.carBtAddressOnce()
            statusText.value = if (carBtAddress == null) "차량 블루투스 등록 필요" else "우리집 위치 대기 중"
            refreshCarBtConnected()
        }
        startAutoLocationCheck()
        // 대기 중에도 차 BT 감시: 연결=운전 시작, 끊김=시동OFF(주차)
        registerBluetoothReceiver()
    }

    private fun disableAuto() {
        autoMode = false
        isAutoEnabled.value = false
        scope.launch { store.setAutoStartEnabled(false) }
        stopAutoLocationCheck()
        stopActiveTracking()
        carBtConn.stop()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    // ---- 추적(ACTIVE) ----

    private fun startActiveTracking() {
        if (trackingJob?.isActive == true) return
        startForegroundCompat(foregroundNotification())
        isTracking.value = true
        if (!autoMode) isAutoEnabled.value = false
        statusText.value = "기준 기압 측정 중..."

        SignalBus.reset()
        registerBluetoothReceiver()

        trackingJob = scope.launch {
            val hPaPerFloor = store.hPaPerFloor.first()
            val entryCorrection = store.entryPressureCorrectionOnce()
            carBtAddress = store.carBtAddressOnce()
            refreshCarBtConnected()
            val plateauMs = store.plateauSecondsOnce() * 1000L
            // 우리집 주차장 층수 → 추정 가능한 층 범위
            val minIdx = CalibrationStore.minFloorIndex(store.garageAboveOnce())
            val maxIdx = store.garageBelowOnce()

            // 재주차 판정: 이 방문에서 이미 주차했었다면(=집 안에서 시동 ON) 재주차다.
            // 출발 위치(직전 층)를 알고 있으므로, 첫 기압으로 '지금의 지상 기준'을 다시 계산한다.
            val lastParked = store.lastParked.first()
            val storedVisitHasParked = store.visitHasParkedOnce()
            val storedVisitFloor = store.visitLastFloorOnce()
            val reparkFloor = when {
                parkedThisVisit && lastParked.hasResult -> lastParked.floorIndex
                storedVisitHasParked &&
                    storedVisitFloor != CalibrationStore.NO_FLOOR &&
                    storedVisitFloor != CalibrationStore.OUTSIDE_FLOOR -> storedVisitFloor
                storedVisitHasParked && lastParked.hasResult -> lastParked.floorIndex
                else -> CalibrationStore.NO_FLOOR
            }
            val isRepark = reparkFloor != CalibrationStore.NO_FLOOR
            parkedThisVisit = false
            Log.d(
                TAG,
                "추적 시작: isRepark=$isRepark reparkFloor=$reparkFloor lastFloor=${lastParked.floorIndex} " +
                    "storedVisitHasParked=$storedVisitHasParked storedVisitFloor=$storedVisitFloor " +
                    "visitBaseline=$visitBaseline"
            )

            // 초기 도착: 이번 방문 기준(P0) 재사용/복원. 재주차: 첫 기압으로 재보정(아래 onEach).
            var baseline = if (isRepark) Float.NaN else visitBaseline
            if (!isRepark && baseline.isNaN()) {
                val saved = store.visitBaselineOnce()
                if (!saved.isNaN()) { baseline = saved; visitBaseline = saved }
            }
            var maxRise = 0f
            val startTime = System.currentTimeMillis()

            val window = ArrayDeque<Float>()
            val windowSize = 60
            var stableSince = -1L

            pressureManager.pressureFlow()
                .onEach { p ->
                    if (baseline.isNaN()) {
                        // 재주차면 직전 층 기준으로 지상 기압을 역산(날씨 변동·지하 출발 보정)
                        baseline = if (isRepark) p - reparkFloor * hPaPerFloor else p + entryCorrection
                        visitBaseline = baseline
                        scope.launch { store.setVisitBaseline(baseline) }  // 영구 저장(프로세스 사망 대비)
                        statusText.value = "기준 설정됨 · 하강 감지 대기"
                        Log.d(
                            TAG,
                            "기준 설정: mode=${if (isRepark) "repark" else "fresh"} " +
                                "pressure=%.2f baseline=%.2f reparkFloor=%d hPaPerFloor=%.3f entryCorrection=%+.2f"
                                    .format(p, baseline, reparkFloor, hPaPerFloor, entryCorrection)
                        )
                    }
                    window.addLast(p)
                    while (window.size > windowSize) window.removeFirst()

                    val now = System.currentTimeMillis()
                    val elapsed = now - startTime
                    val rise = p - baseline
                    if (rise > maxRise) maxRise = rise
                    val floor = FloorCalculator.floorIndex(baseline, p, hPaPerFloor, minIdx, maxIdx)

                    // 기압 평탄화(차가 멈춤) 판정 — 사람 움직임과 무관
                    val spread = if (window.size >= 10) (window.max() - window.min()) else Float.MAX_VALUE
                    val pressureStable = spread <= ParkingDecider.NOISE_HPA
                    if (pressureStable) { if (stableSince < 0) stableSince = now } else stableSince = -1L
                    val stableFor = if (stableSince > 0) now - stableSince else 0L

                    val descended = ParkingDecider.descended(maxRise)
                    val btRecent = recent(SignalBus.btDisconnectedAt.value, now)
                    // 평탄화 폴백은 BT 미등록 사용자 전용.
                    // 차를 등록한 사용자는 오직 시동 OFF(BT 끊김)로만 주차 확정 → 집에 가만히 있을 때 오등록 방지.
                    val plateauAllowed = carBtAddress == null

                    val signals = buildList {
                        if (descended) add("하강확인")
                        if (btRecent) add("블투끊김")
                        if (pressureStable) add("기압평탄 ${stableFor / 1000}s")
                    }.joinToString("·")
                    statusText.value = "추정 ${floorIndexToLabel(floor)} · $signals"
                    // 추적 중 알림 갱신 안 함 (사용자 요청: 추적 팝업 제거, 완료 시에만 알림)

                    val reason = ParkingDecider.reasonNotParked(
                        elapsed, maxRise, btRecent, stableFor, plateauMs, plateauAllowed
                    )
                    debug.value = TrackDebug(
                        current = p, baseline = baseline, rise = rise, maxRise = maxRise,
                        floor = floor, descended = descended, pressureStable = pressureStable,
                        stableForMs = stableFor, plateauMs = plateauMs,
                        btRecent = btRecent, elapsedMs = elapsed, reason = reason
                    )
                    Log.d(
                        TAG,
                        "P=%.2f base=%.2f rise=%+.2f max=%.2f floor=%d stable=%b stableFor=%d bt=%b el=%d :: %s"
                            .format(p, baseline, rise, maxRise, floor, pressureStable, stableFor,
                                btRecent, elapsed, reason)
                    )

                    if (ParkingDecider.shouldPark(elapsed, maxRise, btRecent, stableFor, plateauMs, plateauAllowed)) {
                        Log.d(TAG, "===> 주차 확정! floor=$floor bt=$btRecent")
                        onParked(floor, btRecent)
                    }
                }
                .launchIn(this)
        }
    }

    private fun recent(eventAt: Long, now: Long): Boolean =
        eventAt > 0 && (now - eventAt) in 0..SIGNAL_WINDOW_MS

    private suspend fun onParked(floorIndex: Int, strong: Boolean) {
        val time = System.currentTimeMillis()
        val last = store.lastParked.first()
        val duplicateSameFloor = last.hasResult &&
            last.floorIndex == floorIndex &&
            time - last.timeMillis in 0..SAME_FLOOR_DUPLICATE_MS

        if (duplicateSameFloor) {
            Log.d(
                TAG,
                "중복 주차 무시: floor=$floorIndex elapsed=${time - last.timeMillis}ms " +
                    "lastTime=${last.timeMillis}"
            )
            parkedThisVisit = true
            store.setVisitParked(floorIndex)
            statusText.value = "중복 주차 무시: ${floorIndexToLabel(floorIndex)}"
            stopActiveTracking()
            if (autoMode) {
                startForegroundCompat(foregroundNotification())
                statusText.value = "주차 기록됨 · 대기 중"
            } else {
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
            return
        }

        Log.d(TAG, "주차 저장: floor=$floorIndex strong=$strong time=$time")
        store.appendParked(floorIndex, time)
        store.setVisitParked(floorIndex)
        statusText.value = "주차 감지: ${floorIndexToLabel(floorIndex)}"
        // 홈 위젯 즉시 갱신
        com.parkingfloor.app.widget.ParkingWidgetProvider.updateAll(this)

        parkedThisVisit = true
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // 매 주차마다 새 ID로 알림 → 두 번째 이후에도 팝업이 다시 뜸
        nm.notify(
            NOTI_ID + 100 + (doneNotiCounter++),
            NotificationCompat.Builder(this, CHANNEL_DONE)
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentTitle("🚗 ${floorIndexToLabel(floorIndex)} 주차 완료")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_EVENT)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setAutoCancel(true)
                .setContentIntent(mainPendingIntent())
                .build()
        )

        // 추적 종료. 자동 모드면 다시 대기 상태로 복귀(재무장), 아니면 서비스 종료.
        stopActiveTracking()
        if (autoMode) {
            startForegroundCompat(foregroundNotification())
            statusText.value = "주차 기록됨 · 대기 중"
        } else {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    private fun stopActiveTracking() {
        trackingJob?.cancel()
        trackingJob = null
        // 자동 모드면 대기 중에도 BT(연결/끊김)를 계속 감시해야 하므로 유지
        if (!autoMode) unregisterBluetoothReceiver()
        isTracking.value = false
        debug.value = null
        if (!autoMode) statusText.value = ""
    }

    private fun stopActiveOrAll(userStopped: Boolean) {
        stopActiveTracking()
        if (autoMode) {
            startForegroundCompat(foregroundNotification())
            statusText.value = "우리집 도착 대기 중"
        } else {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    override fun onDestroy() {
        unregisterBluetoothReceiver()
        carBtConn.stop()
        scope.cancel()
        super.onDestroy()
    }

    private fun hasFineLocation(): Boolean =
        ContextCompat.checkSelfPermission(
            this, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

    // ---- 자동 모드: 위치(우리집 반경) 직접 확인으로 도착 감지 ----

    private fun evaluateDistance(loc: Location) {
        // 부정확한 GPS 샘플(지하 등, 오차 100m 초과)은 판정에서 제외 — 엉뚱한 위치로 인한 오작동 방지
        if (loc.hasAccuracy() && loc.accuracy > MAX_ACCURACY_M) {
            Log.d(TAG, "위치 무시: 정확도 낮음(±%.0fm)".format(loc.accuracy))
            return
        }

        val out = FloatArray(1)
        Location.distanceBetween(loc.latitude, loc.longitude, homeLat, homeLng, out)
        val dist = out[0]
        val inside = dist <= homeRadius
        val insideAutoStart = dist <= AUTO_START_RADIUS_M
        lastInsideHome = inside
        lastInsideAutoStart = insideAutoStart

        if (inside) {
            // 집 반경 안 → 이탈 타이머 리셋, 필요 시 추적 시작
            farOutsideSince = -1L
            val inCar = carBtAddress != null && carBtConnected
            if (carBtAddress == null) {
                statusText.value = "차량 블루투스 등록 필요"
            }
            val reparkReady = parkedThisVisit || !visitBaseline.isNaN()
            val canStartTracking = if (reparkReady) true else insideAutoStart
            if (!isTracking.value && inCar && canStartTracking) {
                Log.d(TAG, "자동: 반경 진입(%.0fm, inCar=%b) → 추적 시작".format(dist, inCar))
                startActiveTracking()
            }
            return
        }

        // 반경 밖 — '여유 반경(+EXIT_MARGIN)' 안이면 GPS 튐으로 보고 아무것도 안 함(P0·추적 유지)
        val farOutside = dist > homeRadius + EXIT_MARGIN_M
        if (!farOutside) {
            farOutsideSince = -1L
            return
        }

        // 여유 반경 밖 — 일정 시간(EXIT_CONFIRM_MS) 이상 지속돼야 '출차'로 확정
        val now = System.currentTimeMillis()
        if (farOutsideSince < 0) farOutsideSince = now
        if (now - farOutsideSince < EXIT_CONFIRM_MS) return   // 아직 확정 전 → 유지

        // 출차 확정: 차가 켜져 이동 중일 때만 기준·현재 주차값 초기화.
        // 시동 OFF 후 사용자가 집으로 올라가며 GPS가 튀는 경우에는 주차값을 유지한다.
        val drivingExit = carBtConnected || isTracking.value
        farOutsideSince = -1L
        if (drivingExit && isTracking.value) {
            Log.d(TAG, "자동: 출차 확정(%.0fm, %.0f초) → 추적 중지".format(dist, EXIT_CONFIRM_MS / 1000f))
            stopActiveTracking()
            startForegroundCompat(foregroundNotification())
            statusText.value = "우리집 도착 대기 중"
        }
        if (drivingExit) {
            val hadVisitState = parkedThisVisit || !visitBaseline.isNaN()
            parkedThisVisit = false
            visitBaseline = Float.NaN
            scope.launch {
                val hasParkedRecord = store.lastParked.first().hasResult
                if (hadVisitState || hasParkedRecord) {
                    store.clearParked()
                    store.clearVisitState()
                    com.parkingfloor.app.widget.ParkingWidgetProvider.updateAll(this@ParkingTrackingService)
                }
            }
            // 출차 확정 → 위젯도 '기록 없음'으로 갱신
        } else if (!drivingExit) {
            Log.d(TAG, "GPS 이탈 무시: 시동 OFF 상태이므로 주차 위치 유지")
        }
    }

    /** 마지막 위치가 집 반경 안인지 */
    private fun isInsideHome(): Boolean {
        val loc = bestLastKnown() ?: return false
        if (homeRadius <= 0f && homeLat == 0.0) return false
        val out = FloatArray(1)
        Location.distanceBetween(loc.latitude, loc.longitude, homeLat, homeLng, out)
        return out[0] <= homeRadius
    }

    private fun isInsideAutoStartRadius(): Boolean {
        val loc = bestLastKnown() ?: return false
        if (homeRadius <= 0f && homeLat == 0.0) return false
        val out = FloatArray(1)
        Location.distanceBetween(loc.latitude, loc.longitude, homeLat, homeLng, out)
        return out[0] <= AUTO_START_RADIUS_M
    }

    @android.annotation.SuppressLint("MissingPermission")
    private fun bestLastKnown(): Location? {
        var best: Location? = null
        runCatching {
            for (p in locationManager.getProviders(true)) {
                val l = locationManager.getLastKnownLocation(p) ?: continue
                if (best == null || l.time > best!!.time) best = l
            }
        }
        return best
    }

    @android.annotation.SuppressLint("MissingPermission")
    private fun startAutoLocationCheck() {
        if (!hasFineLocation()) return
        scope.launch {
            val home = store.homeLocation.first() ?: return@launch
            homeLat = home.lat; homeLng = home.lng; homeRadius = home.radius

            // 1) 위치 업데이트 콜백 (오면 즉시 평가)
            if (autoLocationListener == null) {
                val listener = object : android.location.LocationListener {
                    override fun onLocationChanged(location: Location) = evaluateDistance(location)
                    override fun onProviderEnabled(provider: String) {}
                    override fun onProviderDisabled(provider: String) {}
                    @Deprecated("deprecated in API 29")
                    override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) {}
                }
                autoLocationListener = listener
                runCatching {
                    val lm = locationManager
                    if (lm.isProviderEnabled(android.location.LocationManager.GPS_PROVIDER))
                        lm.requestLocationUpdates(android.location.LocationManager.GPS_PROVIDER, 5_000L, 0f, listener, Looper.getMainLooper())
                    if (lm.isProviderEnabled(android.location.LocationManager.NETWORK_PROVIDER))
                        lm.requestLocationUpdates(android.location.LocationManager.NETWORK_PROVIDER, 5_000L, 0f, listener, Looper.getMainLooper())
                }
            }

            // 2) 주기적 폴링 (콜백이 안 와도 6초마다 마지막 위치로 평가 → 확실한 도착 감지)
            autoJob?.cancel()
            autoJob = scope.launch {
                while (true) {
                    bestLastKnown()?.let { evaluateDistance(it) }
                    refreshCarBtConnected()   // 6초마다 실제 연결 상태 재확인(self-heal)
                    kotlinx.coroutines.delay(6_000L)
                }
            }
        }
    }

    private fun stopAutoLocationCheck() {
        autoLocationListener?.let { runCatching { locationManager.removeUpdates(it) } }
        autoLocationListener = null
        autoJob?.cancel()
        autoJob = null
    }

    // ---- 블루투스 끊김 감지 (등록한 차 기기만) ----

    private fun registerBluetoothReceiver() {
        if (btReceiver != null) return
        val r = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                val action = intent?.action ?: return
                val registered = carBtAddress ?: return
                @Suppress("DEPRECATION")
                val device: BluetoothDevice? =
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
                        intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
                    else
                        intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                if (device?.address != registered) return
                when (action) {
                    BluetoothDevice.ACTION_ACL_CONNECTED -> {
                        carBtConnected = true
                        // 집 범위 '안'에서 시동 켬 = 차 옮김(재주차) → 추적 재시작.
                        // 범위 '밖'(출퇴근)이면 시작하지 않음.
                        // 캐시(lastInsideHome) 우선 — 콜드스타트로 lastKnown이 없어도 판단 가능.
                        val reparkReady = parkedThisVisit || !visitBaseline.isNaN()
                        val insideForStart = if (reparkReady) (lastInsideHome || isInsideHome()) else (lastInsideAutoStart || isInsideAutoStartRadius())
                        if (!isTracking.value && insideForStart) {
                            Log.d(TAG, "집 범위 안 시동 ON → 재주차 추적 시작")
                            startActiveTracking()
                        } else {
                            Log.d(TAG, "차 BT 연결됨(범위 밖이거나 이미 추적중) — 시작 안 함")
                        }
                    }
                    BluetoothDevice.ACTION_ACL_DISCONNECTED -> {
                        // 시동 OFF → 주차 신호
                        Log.d(TAG, "차 BT 끊김(시동 OFF) → 주차 신호")
                        carBtConnected = false
                        SignalBus.onBluetoothDisconnected()
                        // 추적이 안 돌고 있었더라도, 이번 방문 기준(P0)이 있고 집 범위 안이면
                        // 즉시 추적을 켜서 첫 읽기에서 블투끊김으로 주차를 확정한다(누락 방지).
                        val insideNow = lastInsideHome || isInsideHome()
                        if (!isTracking.value && autoMode && !visitBaseline.isNaN() && insideNow) {
                            Log.d(TAG, "추적 꺼짐+시동 OFF(집 안, 기준 있음) → 추적 시작해 즉시 확정")
                            startActiveTracking()
                        } else if (autoMode && !insideNow && !isTracking.value) {
                            Log.d(TAG, "범위 밖 시동 OFF → 외부 주차 기록 안 함")
                        }
                    }
                }
            }
        }
        val filter = IntentFilter().apply {
            addAction(BluetoothDevice.ACTION_ACL_CONNECTED)
            addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED)
        }
        registerReceiver(r, filter)
        btReceiver = r
    }

    private fun unregisterBluetoothReceiver() {
        btReceiver?.let { runCatching { unregisterReceiver(it) } }
        btReceiver = null
    }

    /** 등록된 차 BT가 지금 연결돼 있는지 A2DP/HEADSET 프로파일로 확인. 불명이면 기존 값 유지. */
    private fun refreshCarBtConnected() {
        val addr = carBtAddress ?: run { carBtConnected = false; return }
        carBtConn.start()  // 프록시 미준비면 준비 시작(이미 준비됐으면 무시)
        carBtConn.isConnected(addr)?.let { carBtConnected = it }
    }

    // ---- 알림 ----

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "백그라운드 실행", NotificationManager.IMPORTANCE_MIN)
                    .apply {
                        description = "주차 자동 감지를 위해 항상 실행 (거의 보이지 않음)"
                        setShowBadge(false)
                    }
            )
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_DONE, "주차 완료 알림", NotificationManager.IMPORTANCE_HIGH)
                    .apply { description = "주차가 감지되면 팝업으로 알림" }
            )
        }
    }

    private fun mainPendingIntent(): PendingIntent {
        val intent = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        return PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
    }

    /** 서비스 상시 표시용 고정 무음 알림 (추적/대기 구분 없이 항상 동일) */
    private fun foregroundNotification(): Notification =
        buildNotification("주차 자동 감지 켜짐", "집에 도착하면 자동으로 기록해요")

    private fun buildNotification(title: String, text: String): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setContentIntent(mainPendingIntent())
            .build()

    private fun startForegroundCompat(notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTI_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTI_ID, notification)
        }
    }
}
