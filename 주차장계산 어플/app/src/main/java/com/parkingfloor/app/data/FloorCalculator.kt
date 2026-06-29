package com.parkingfloor.app.data

import kotlin.math.roundToInt

/** 기압 차이로 층 인덱스를 계산하는 공용 로직 */
object FloorCalculator {

    /**
     * @param baseline 지상1층 기준 기압 P0
     * @param current  현재 기압
     * @param hPaPerFloor 층당 기압차
     * @param minIndex 최소 인덱스(가장 높은 지상층, 음수 가능)
     * @param maxIndex 최대 인덱스(가장 낮은 지하층)
     * @return 층 인덱스(음수=지상2 이상, 0=지상1, 양수=지하)
     */
    fun floorIndex(
        baseline: Float,
        current: Float,
        hPaPerFloor: Float,
        minIndex: Int = CalibrationStore.MIN_FLOOR_INDEX,
        maxIndex: Int = CalibrationStore.MAX_FLOOR_INDEX
    ): Int {
        if (hPaPerFloor <= 0f) return 0
        val raw = ((current - baseline) / hPaPerFloor).roundToInt()
        return raw.coerceIn(minIndex, maxIndex)
    }
}
