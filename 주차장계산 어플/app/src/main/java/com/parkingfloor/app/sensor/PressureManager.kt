package com.parkingfloor.app.sensor

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow

/**
 * 기압 센서를 읽어 노이즈를 줄인 값(hPa)을 흘려보낸다.
 *
 * 폰 기압 센서는 순간값이 ±0.1~0.2 hPa 흔들리므로
 * 저역통과 필터(지수이동평균)로 부드럽게 만든다.
 */
class PressureManager(context: Context) {

    private val sensorManager =
        context.getSystemService(Context.SENSOR_SERVICE) as SensorManager

    private val pressureSensor: Sensor? =
        sensorManager.getDefaultSensor(Sensor.TYPE_PRESSURE)

    /** 기기에 기압 센서가 있는지 */
    val isAvailable: Boolean get() = pressureSensor != null

    /** 필터 강도 (0~1). 작을수록 더 부드럽지만 반응이 느림. */
    private val alpha = 0.15f

    /**
     * 필터링된 기압값(hPa) 스트림.
     * collect 하는 동안만 센서가 켜진다 (배터리 절약).
     */
    fun pressureFlow(): Flow<Float> = callbackFlow {
        if (pressureSensor == null) {
            close()
            return@callbackFlow
        }

        var filtered = Float.NaN

        val listener = object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                val raw = event.values[0]
                filtered = if (filtered.isNaN()) raw
                else filtered + alpha * (raw - filtered)
                trySend(filtered)
            }

            override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
        }

        sensorManager.registerListener(
            listener,
            pressureSensor,
            SensorManager.SENSOR_DELAY_NORMAL // 약 200ms 주기
        )

        awaitClose {
            sensorManager.unregisterListener(listener)
        }
    }
}
