package com.parkingfloor.app.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.parkingfloor.app.MainActivity
import com.parkingfloor.app.R
import com.parkingfloor.app.data.CalibrationStore
import com.parkingfloor.app.data.ParkedResult
import com.parkingfloor.app.data.floorIndexToLabel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * 홈 화면 위젯 — 앱에 들어가지 않고도 마지막 주차 위치를 보여준다.
 * 주차가 기록될 때마다 서비스가 updateAll() 로 갱신한다.
 */
class ParkingWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val parked = CalibrationStore(context).lastParked.first()
                appWidgetIds.forEach { id -> render(context, appWidgetManager, id, parked) }
            } finally {
                pending.finish()
            }
        }
    }

    companion object {

        /** 어디서든 호출 — 현재 배치된 모든 위젯을 즉시 갱신 */
        fun updateAll(context: Context) {
            val mgr = AppWidgetManager.getInstance(context)
            val ids = mgr.getAppWidgetIds(
                ComponentName(context, ParkingWidgetProvider::class.java)
            )
            if (ids.isEmpty()) return
            val intent = Intent(context, ParkingWidgetProvider::class.java).apply {
                action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
            }
            context.sendBroadcast(intent)
        }

        private fun render(
            context: Context,
            mgr: AppWidgetManager,
            id: Int,
            parked: ParkedResult
        ) {
            val views = RemoteViews(context.packageName, R.layout.widget_parking)
            if (parked.hasResult) {
                views.setTextViewText(R.id.widget_floor, "🚗 " + floorIndexToLabel(parked.floorIndex))
                views.setTextViewText(R.id.widget_time, relativeTime(parked.timeMillis))
            } else {
                views.setTextViewText(R.id.widget_floor, "🚗 기록 없음")
                views.setTextViewText(R.id.widget_time, "주차가 감지되면 표시돼요")
            }
            val pi = PendingIntent.getActivity(
                context, 0,
                Intent(context, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
            views.setOnClickPendingIntent(R.id.widget_root, pi)
            mgr.updateAppWidget(id, views)
        }

        private fun relativeTime(millis: Long): String {
            val now = Calendar.getInstance()
            val then = Calendar.getInstance().apply { timeInMillis = millis }
            val timePart = SimpleDateFormat("hh:mm a", Locale.ENGLISH).format(Date(millis))
            val sameDay = now.get(Calendar.YEAR) == then.get(Calendar.YEAR) &&
                now.get(Calendar.DAY_OF_YEAR) == then.get(Calendar.DAY_OF_YEAR)
            now.add(Calendar.DAY_OF_YEAR, -1)
            val yesterday = now.get(Calendar.YEAR) == then.get(Calendar.YEAR) &&
                now.get(Calendar.DAY_OF_YEAR) == then.get(Calendar.DAY_OF_YEAR)
            return when {
                sameDay -> "오늘 $timePart"
                yesterday -> "어제 $timePart"
                else -> SimpleDateFormat("M월 d일", Locale.KOREA).format(Date(millis)) + " " + timePart
            }
        }
    }
}
