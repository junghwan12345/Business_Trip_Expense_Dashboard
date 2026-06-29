package com.parkingfloor.app.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.doublePreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "parking_calibration")

/**
 * 캘리브레이션 값을 영구 저장한다.
 *
 * - hPaPerFloor : 한 층 내려갈 때 증가하는 기압(hPa). 아파트마다 층고가 달라 보정 필요.
 *                 기본값 0.30 hPa (주차장 층고 약 2.5m 가정).
 */
class CalibrationStore(private val context: Context) {

    companion object {
        private val KEY_HPA_PER_FLOOR = floatPreferencesKey("hpa_per_floor")

        // 마지막으로 자동 감지된 주차 결과
        private val KEY_LAST_FLOOR = intPreferencesKey("last_parked_floor")
        private val KEY_LAST_TIME = longPreferencesKey("last_parked_time")

        // 자동차 블루투스 기기 (등록한 것만 하차 신호로 인정)
        private val KEY_CAR_BT_ADDR = stringPreferencesKey("car_bt_address")
        private val KEY_CAR_BT_NAME = stringPreferencesKey("car_bt_name")

        // 우리집(아파트) 위치 + 자동 시작
        private val KEY_HOME_LAT = doublePreferencesKey("home_lat")
        private val KEY_HOME_LNG = doublePreferencesKey("home_lng")
        private val KEY_HOME_RADIUS = floatPreferencesKey("home_radius")
        private val KEY_AUTO_START = booleanPreferencesKey("auto_start_enabled")

        // 기압 평탄화 판정 시간(초) — 사용자 조절
        private val KEY_PLATEAU_SEC = intPreferencesKey("plateau_seconds")

        // 이번 집 방문의 지상1층 기준 기압(P0). 프로세스가 죽어도 방문 중엔 유지. 출차 시 제거.
        private val KEY_VISIT_BASELINE = floatPreferencesKey("visit_baseline")
        private val KEY_VISIT_HAS_PARKED = booleanPreferencesKey("visit_has_parked")
        private val KEY_VISIT_LAST_FLOOR = intPreferencesKey("visit_last_floor")

        // 주차 기록 이력 (최근 10건, "층:시각,층:시각,..." 형식)
        private val KEY_HISTORY = stringPreferencesKey("parking_history")

        // 첫 실행 설정 마법사 완료 여부
        private val KEY_SETUP_DONE = booleanPreferencesKey("setup_done")

        // 빠른 주차 위젯 전용 (메인 기록과 완전 별개)
        private val KEY_QUICK_FLOOR = intPreferencesKey("quick_floor")          // 현재 선택(코드)
        private val KEY_QUICK_FLOORS = stringPreferencesKey("quick_floors")     // 표시할 층 목록(코드 CSV)
        // 코드: 지상 N층 = +N (라벨 "N층"), 지하 N층 = -N (라벨 "지하 N층")
        const val DEFAULT_QUICK_FLOORS = "1,-1,-2,-3,-4"

        // 우리집 주차장 층수 (지상 N층 / 지하 N층). 각 1~5.
        private val KEY_GARAGE_ABOVE = intPreferencesKey("garage_above")  // 지상 층수
        private val KEY_GARAGE_BELOW = intPreferencesKey("garage_below")  // 지하 층수
        const val DEFAULT_GARAGE_ABOVE = 1
        const val DEFAULT_GARAGE_BELOW = 5
        const val MAX_GARAGE_FLOORS = 5

        const val DEFAULT_HPA_PER_FLOOR = 0.40f
        const val DEFAULT_HOME_RADIUS = 150f
        const val DEFAULT_PLATEAU_SEC = 12
        const val NO_FLOOR = -999
        const val OUTSIDE_FLOOR = -100   // 우리집 범위 밖 주차 (외부 주차 중)
        const val NO_COORD = 999.0

        // 층 인덱스 체계: 0=지상1층(기준), 음수=더 높은 지상(-1=지상2 …), 양수=지하(1=지하1 …)
        const val MIN_FLOOR_INDEX = 0
        const val MAX_FLOOR_INDEX = 5

        /** 지상 층수 → 최소 인덱스(가장 높은 지상층). 지상1=0, 지상5=-4 */
        fun minFloorIndex(garageAbove: Int): Int = -(garageAbove - 1)
    }

    val hPaPerFloor: Flow<Float> = context.dataStore.data.map { prefs ->
        prefs[KEY_HPA_PER_FLOOR] ?: DEFAULT_HPA_PER_FLOOR
    }

    suspend fun setHPaPerFloor(value: Float) {
        context.dataStore.edit { prefs ->
            prefs[KEY_HPA_PER_FLOOR] = value
        }
    }

    /** 마지막 주차 결과 (층 인덱스, 감지 시각millis). 없으면 floor=NO_FLOOR */
    val lastParked: Flow<ParkedResult> = context.dataStore.data.map { prefs ->
        ParkedResult(
            floorIndex = prefs[KEY_LAST_FLOOR] ?: NO_FLOOR,
            timeMillis = prefs[KEY_LAST_TIME] ?: 0L
        )
    }

    suspend fun clearParked() {
        context.dataStore.edit { prefs ->
            prefs[KEY_LAST_FLOOR] = NO_FLOOR
            prefs[KEY_LAST_TIME] = 0L
        }
    }

    /** 최근 주차 기록 이력 (최대 10건, 최신순) */
    val parkingHistory: Flow<List<ParkedResult>> = context.dataStore.data.map { prefs ->
        prefs[KEY_HISTORY]?.split(",")?.filter { it.isNotBlank() }?.mapNotNull { entry ->
            val parts = entry.split(":")
            if (parts.size == 2) ParkedResult(
                floorIndex = parts[0].toIntOrNull() ?: return@mapNotNull null,
                timeMillis = parts[1].toLongOrNull() ?: return@mapNotNull null
            ) else null
        }?.filter { it.hasResult } ?: emptyList()
    }

    /** 주차 기록 추가 — 이력 앞에 삽입하고 10건 초과분 제거. lastParked 도 함께 갱신. */
    suspend fun appendParked(floorIndex: Int, timeMillis: Long) {
        if (floorIndex == OUTSIDE_FLOOR) return
        context.dataStore.edit { prefs ->
            prefs[KEY_LAST_FLOOR] = floorIndex
            prefs[KEY_LAST_TIME] = timeMillis
            val existing = prefs[KEY_HISTORY]?.split(",")?.filter { it.isNotBlank() } ?: emptyList()
            val updated = (listOf("$floorIndex:$timeMillis") + existing).take(10)
            prefs[KEY_HISTORY] = updated.joinToString(",")
        }
    }

    /** 하위 호환 래퍼 — appendParked 를 호출한다. */
    suspend fun saveParked(floorIndex: Int, timeMillis: Long) = appendParked(floorIndex, timeMillis)

    // ---- 자동차 블루투스 기기 ----

    val carBtDevice: Flow<CarBtDevice?> = context.dataStore.data.map { prefs ->
        val addr = prefs[KEY_CAR_BT_ADDR]
        if (addr.isNullOrBlank()) null
        else CarBtDevice(addr, prefs[KEY_CAR_BT_NAME] ?: addr)
    }

    suspend fun setCarBtDevice(address: String, name: String) {
        context.dataStore.edit { prefs ->
            prefs[KEY_CAR_BT_ADDR] = address
            prefs[KEY_CAR_BT_NAME] = name
        }
    }

    suspend fun clearCarBtDevice() {
        context.dataStore.edit { prefs ->
            prefs.remove(KEY_CAR_BT_ADDR)
            prefs.remove(KEY_CAR_BT_NAME)
        }
    }

    /** 서비스에서 동기적으로 등록된 차 BT 주소를 읽는다 (없으면 null) */
    suspend fun carBtAddressOnce(): String? = carBtDevice.first()?.address

    // ---- 우리집 위치 + 자동 시작 ----

    val homeLocation: Flow<HomeLocation?> = context.dataStore.data.map { prefs ->
        val lat = prefs[KEY_HOME_LAT] ?: NO_COORD
        val lng = prefs[KEY_HOME_LNG] ?: NO_COORD
        if (lat == NO_COORD || lng == NO_COORD) null
        else HomeLocation(lat, lng, prefs[KEY_HOME_RADIUS] ?: DEFAULT_HOME_RADIUS)
    }

    suspend fun setHomeLocation(lat: Double, lng: Double, radius: Float = DEFAULT_HOME_RADIUS) {
        context.dataStore.edit { prefs ->
            prefs[KEY_HOME_LAT] = lat
            prefs[KEY_HOME_LNG] = lng
            prefs[KEY_HOME_RADIUS] = radius
        }
    }

    val homeRadius: Flow<Float> = context.dataStore.data.map { prefs ->
        prefs[KEY_HOME_RADIUS] ?: DEFAULT_HOME_RADIUS
    }

    suspend fun setHomeRadius(radius: Float) {
        context.dataStore.edit { prefs -> prefs[KEY_HOME_RADIUS] = radius }
    }

    suspend fun homeRadiusOnce(): Float = homeRadius.first()

    val autoStartEnabled: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[KEY_AUTO_START] ?: false
    }

    suspend fun setAutoStartEnabled(enabled: Boolean) {
        context.dataStore.edit { prefs -> prefs[KEY_AUTO_START] = enabled }
    }

    val plateauSeconds: Flow<Int> = context.dataStore.data.map { prefs ->
        prefs[KEY_PLATEAU_SEC] ?: DEFAULT_PLATEAU_SEC
    }

    suspend fun setPlateauSeconds(sec: Int) {
        context.dataStore.edit { prefs -> prefs[KEY_PLATEAU_SEC] = sec }
    }

    suspend fun plateauSecondsOnce(): Int = plateauSeconds.first()

    // ---- 이번 방문 기준 기압(P0) 영구 저장 (프로세스 사망 대비) ----

    /** 저장된 방문 기준 기압. 없으면 NaN. */
    suspend fun visitBaselineOnce(): Float =
        context.dataStore.data.first()[KEY_VISIT_BASELINE] ?: Float.NaN

    suspend fun setVisitBaseline(pressure: Float) {
        context.dataStore.edit { prefs -> prefs[KEY_VISIT_BASELINE] = pressure }
    }

    suspend fun clearVisitBaseline() {
        context.dataStore.edit { prefs -> prefs.remove(KEY_VISIT_BASELINE) }
    }

    suspend fun visitHasParkedOnce(): Boolean =
        context.dataStore.data.first()[KEY_VISIT_HAS_PARKED] ?: false

    suspend fun visitLastFloorOnce(): Int =
        context.dataStore.data.first()[KEY_VISIT_LAST_FLOOR] ?: NO_FLOOR

    suspend fun setVisitParked(floorIndex: Int) {
        context.dataStore.edit { prefs ->
            prefs[KEY_VISIT_HAS_PARKED] = true
            prefs[KEY_VISIT_LAST_FLOOR] = floorIndex
        }
    }

    suspend fun clearVisitState() {
        context.dataStore.edit { prefs ->
            prefs.remove(KEY_VISIT_HAS_PARKED)
            prefs.remove(KEY_VISIT_LAST_FLOOR)
            prefs.remove(KEY_VISIT_BASELINE)
        }
    }

    // ---- 첫 실행 설정 마법사 ----

    /**
     * 초기 설정 완료 플래그(명시적). 없으면 false.
     * (기존 사용자 구분은 ViewModel에서 "앱 시작 시 집 위치가 이미 있었는지" 스냅샷으로 처리)
     */
    val setupDoneFlag: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[KEY_SETUP_DONE] ?: false
    }

    suspend fun setSetupComplete(done: Boolean) {
        context.dataStore.edit { prefs -> prefs[KEY_SETUP_DONE] = done }
    }

    // ---- 빠른 주차 위젯 전용 (독립) ----

    suspend fun quickFloorOnce(): Int =
        context.dataStore.data.first()[KEY_QUICK_FLOOR] ?: NO_FLOOR

    suspend fun setQuickFloor(code: Int) {
        context.dataStore.edit { prefs -> prefs[KEY_QUICK_FLOOR] = code }
    }

    /** 위젯에 표시할 층 코드 목록 (최대 10개). */
    suspend fun quickFloorsOnce(): List<Int> =
        (context.dataStore.data.first()[KEY_QUICK_FLOORS] ?: DEFAULT_QUICK_FLOORS)
            .split(",").mapNotNull { it.trim().toIntOrNull() }.take(10)

    suspend fun setQuickFloors(codes: List<Int>) {
        context.dataStore.edit { prefs -> prefs[KEY_QUICK_FLOORS] = codes.joinToString(",") }
    }

    // ---- 우리집 주차장 층수 (지상/지하) ----

    val garageAbove: Flow<Int> = context.dataStore.data.map { prefs ->
        (prefs[KEY_GARAGE_ABOVE] ?: DEFAULT_GARAGE_ABOVE).coerceIn(1, MAX_GARAGE_FLOORS)
    }
    val garageBelow: Flow<Int> = context.dataStore.data.map { prefs ->
        (prefs[KEY_GARAGE_BELOW] ?: DEFAULT_GARAGE_BELOW).coerceIn(1, MAX_GARAGE_FLOORS)
    }

    suspend fun setGarageFloors(above: Int, below: Int) {
        context.dataStore.edit { prefs ->
            prefs[KEY_GARAGE_ABOVE] = above.coerceIn(1, MAX_GARAGE_FLOORS)
            prefs[KEY_GARAGE_BELOW] = below.coerceIn(1, MAX_GARAGE_FLOORS)
        }
    }

    suspend fun garageAboveOnce(): Int = garageAbove.first()
    suspend fun garageBelowOnce(): Int = garageBelow.first()

    /** 특정 기록(시각으로 식별)의 층을 수정. 최신 기록이면 lastParked도 함께 갱신. */
    suspend fun editRecordFloor(timeMillis: Long, newFloorIndex: Int) {
        context.dataStore.edit { prefs ->
            val entries = prefs[KEY_HISTORY]?.split(",")?.filter { it.isNotBlank() } ?: return@edit
            val updated = entries.map { entry ->
                val parts = entry.split(":")
                if (parts.size == 2 && parts[1].toLongOrNull() == timeMillis) "$newFloorIndex:$timeMillis"
                else entry
            }
            prefs[KEY_HISTORY] = updated.joinToString(",")
            // 최신(맨 앞) 기록이면 lastParked도 갱신
            if (prefs[KEY_LAST_TIME] == timeMillis) prefs[KEY_LAST_FLOOR] = newFloorIndex
        }
    }
}

/** 등록된 자동차 블루투스 기기 */
data class CarBtDevice(val address: String, val name: String)

/** 우리집(아파트) 위치 */
data class HomeLocation(val lat: Double, val lng: Double, val radius: Float)

/** 마지막 주차 결과 */
data class ParkedResult(val floorIndex: Int, val timeMillis: Long) {
    val hasResult: Boolean get() =
        floorIndex != CalibrationStore.NO_FLOOR &&
            floorIndex != CalibrationStore.OUTSIDE_FLOOR
}

/**
 * 층 인덱스를 사람이 읽는 문자열로.
 * 0 -> "지상 1층", -1 -> "지상 2층", 1 -> "지하 1층", OUTSIDE -> "외부 주차 중"
 */
fun floorIndexToLabel(index: Int): String {
    return when {
        index == CalibrationStore.OUTSIDE_FLOOR -> "외부 주차 중"
        index <= 0 -> "지상 ${1 - index}층"
        else -> "지하 ${index}층"
    }
}
