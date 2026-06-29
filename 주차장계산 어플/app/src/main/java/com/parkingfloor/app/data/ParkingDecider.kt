package com.parkingfloor.app.data

/**
 * 주차 완료 판단 로직.
 *
 * 자동 기록은 등록된 차량 블루투스가 끊긴 시점만 확정 신호로 사용한다.
 * 기압은 주차한 층을 계산하는 데 사용하고, 기압 평탄화만으로 주차 완료를 확정하지 않는다.
 */
object ParkingDecider {

    const val MIN_TRACK_MS = 6_000L
    const val MIN_DESCENT_HPA = 0.20f
    const val NOISE_HPA = 0.06f
    const val DEFAULT_PLATEAU_SEC = 12
    const val MIN_PLATEAU_SEC = 5
    const val MAX_PLATEAU_SEC = 30

    fun descended(maxRiseHpa: Float): Boolean = maxRiseHpa >= MIN_DESCENT_HPA

    fun shouldPark(
        elapsedMs: Long,
        maxRiseHpa: Float,
        btDisconnected: Boolean,
        pressureStableForMs: Long,
        plateauMs: Long,
        plateauAllowed: Boolean
    ): Boolean = btDisconnected

    fun reasonNotParked(
        elapsedMs: Long,
        maxRiseHpa: Float,
        btDisconnected: Boolean,
        pressureStableForMs: Long,
        plateauMs: Long,
        plateauAllowed: Boolean
    ): String = when {
        btDisconnected -> "블루투스 연결 해제 감지 - 기록 직전"
        plateauAllowed -> "차량 블루투스 미등록 - 자동 기록 제한"
        else -> "차량 블루투스 연결 중 - 시동을 끄면 기록"
    }
}
