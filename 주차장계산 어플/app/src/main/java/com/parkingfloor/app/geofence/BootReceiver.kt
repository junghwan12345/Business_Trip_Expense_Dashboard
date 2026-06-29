package com.parkingfloor.app.geofence

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import com.parkingfloor.app.data.CalibrationStore
import com.parkingfloor.app.service.ParkingTrackingService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * 재부팅 후 자동 모드가 켜져 있었다면 추적 서비스를 다시 대기 상태로 띄운다.
 * (지오펜스는 재부팅 시 사라지므로 서비스가 다시 등록한다)
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val enabled = CalibrationStore(context).autoStartEnabled.first()
                if (enabled) {
                    val svc = Intent(context, ParkingTrackingService::class.java).apply {
                        action = ParkingTrackingService.ACTION_ENABLE_AUTO
                    }
                    ContextCompat.startForegroundService(context, svc)
                }
            } finally {
                pending.finish()
            }
        }
    }
}
