package com.parkingfloor.app.signal

import kotlinx.coroutines.flow.MutableStateFlow

/**
 * 시스템 신호(자동차 블루투스 끊김)를 서비스에 전달하는 전역 버스.
 */
object SignalBus {

    /** 자동차 블루투스가 끊긴 시각(millis) = 시동 꺼짐(주차) 신호. */
    val btDisconnectedAt = MutableStateFlow(0L)

    fun onBluetoothDisconnected() {
        btDisconnectedAt.value = System.currentTimeMillis()
    }

    /** 추적 시작 시 초기화 */
    fun reset() {
        btDisconnectedAt.value = 0L
    }
}
