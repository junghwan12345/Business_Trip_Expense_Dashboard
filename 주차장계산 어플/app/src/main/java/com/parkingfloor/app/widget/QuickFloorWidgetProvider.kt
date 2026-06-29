package com.parkingfloor.app.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import com.parkingfloor.app.R
import com.parkingfloor.app.data.CalibrationStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * 빠른 주차 위치 위젯 — 선택한 층(지상5~지하5 중 설정)을 칩으로 보여주고, 탭하면 그 층을 기억한다.
 * 메인 기록과 완전 독립(전용 키만 사용).
 */
class QuickFloorWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, mgr: AppWidgetManager, ids: IntArray) {
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val store = CalibrationStore(context)
                val floors = store.quickFloorsOnce()
                val selected = store.quickFloorOnce()
                ids.forEach { id -> render(context, mgr, id, floors, selected) }
            } finally {
                pending.finish()
            }
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_SET_FLOOR) {
            val code = intent.getIntExtra(EXTRA_FLOOR, Int.MIN_VALUE)
            if (code != Int.MIN_VALUE) {
                val pending = goAsync()
                CoroutineScope(Dispatchers.IO).launch {
                    try {
                        CalibrationStore(context).setQuickFloor(code)
                    } finally {
                        updateAll(context)
                        pending.finish()
                    }
                }
            }
        }
    }

    companion object {
        const val ACTION_SET_FLOOR = "com.parkingfloor.app.QUICK_SET_FLOOR"
        const val EXTRA_FLOOR = "floor"

        // 칩 = 단일 TextView (한 줄 6칸 × 2줄). 마지막 사용 칸은 '+' 수정 버튼.
        private val chipIds = intArrayOf(
            R.id.chip0, R.id.chip1, R.id.chip2, R.id.chip3, R.id.chip4, R.id.chip5,
            R.id.chip6, R.id.chip7, R.id.chip8, R.id.chip9, R.id.chip10, R.id.chip11
        )

        /** 코드 → 라벨: 지상 N층="N층", 지하 N층="지하 N층". */
        // 지상 = "N층", 지하 = "B1·B2…"
        fun label(code: Int): String = if (code > 0) "${code}층" else "B${-code}"

        fun updateAll(context: Context) {
            val mgr = AppWidgetManager.getInstance(context)
            val ids = mgr.getAppWidgetIds(ComponentName(context, QuickFloorWidgetProvider::class.java))
            if (ids.isEmpty()) return
            val intent = Intent(context, QuickFloorWidgetProvider::class.java).apply {
                action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
            }
            context.sendBroadcast(intent)
        }

        private fun render(
            context: Context,
            mgr: AppWidgetManager,
            id: Int,
            floors: List<Int>,
            selected: Int
        ) {
            val views = RemoteViews(context.packageName, R.layout.widget_quick_floor)
            val normalText = Color.parseColor("#3C2E7A")
            val editColor = Color.parseColor("#6A4CF0")

            // 설정 화면 열기 PendingIntent ('+' 버튼 + 빈 영역 공용)
            val editPi = PendingIntent.getActivity(
                context, 999,
                Intent(context, QuickFloorConfigActivity::class.java).apply {
                    action = "com.parkingfloor.app.QUICK_EDIT"
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                },
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )

            val n = floors.size.coerceAtMost(11)  // 마지막 1칸은 '+' 용
            for (slot in 0..11) {
                when {
                    slot < n -> {
                        val code = floors[slot]
                        views.setViewVisibility(chipIds[slot], View.VISIBLE)
                        views.setTextViewText(chipIds[slot], label(code))
                        if (code == selected) {
                            views.setInt(chipIds[slot], "setBackgroundResource", R.drawable.chip_bg_selected)
                            views.setTextColor(chipIds[slot], Color.WHITE)
                        } else {
                            views.setInt(chipIds[slot], "setBackgroundResource", R.drawable.chip_bg_normal)
                            views.setTextColor(chipIds[slot], normalText)
                        }
                        val pi = PendingIntent.getBroadcast(
                            context, code + 100,
                            Intent(context, QuickFloorWidgetProvider::class.java).apply {
                                action = ACTION_SET_FLOOR
                                putExtra(EXTRA_FLOOR, code)
                                data = Uri.parse("quickfloor://$code")
                            },
                            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
                        )
                        views.setOnClickPendingIntent(chipIds[slot], pi)
                    }
                    slot == n -> {
                        // '+' 수정 버튼 (항상 마지막 칸)
                        views.setViewVisibility(chipIds[slot], View.VISIBLE)
                        views.setTextViewText(chipIds[slot], "+")
                        views.setInt(chipIds[slot], "setBackgroundResource", R.drawable.chip_bg_edit)
                        views.setTextColor(chipIds[slot], editColor)
                        views.setOnClickPendingIntent(chipIds[slot], editPi)
                    }
                    else -> views.setViewVisibility(chipIds[slot], View.GONE)
                }
            }
            // '+' 포함 총 칸 수가 6 초과면 둘째 줄 표시
            views.setViewVisibility(R.id.chipRow2, if (n + 1 > 6) View.VISIBLE else View.GONE)
            // 빈 영역 탭도 설정 열기
            views.setOnClickPendingIntent(R.id.widgetRoot, editPi)

            mgr.updateAppWidget(id, views)
        }
    }
}
