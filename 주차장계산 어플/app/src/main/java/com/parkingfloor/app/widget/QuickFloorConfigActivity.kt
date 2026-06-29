package com.parkingfloor.app.widget

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import com.parkingfloor.app.data.CalibrationStore
import kotlinx.coroutines.launch

/** 빠른 주차 위젯 추가 시 표시할 층(지상1~5 / 지하1~5)을 고르는 설정 화면. */
class QuickFloorConfigActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val appWidgetId = intent?.extras?.getInt(
            AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID
        ) ?: AppWidgetManager.INVALID_APPWIDGET_ID
        // 취소(뒤로가기) 시 위젯 추가 안 됨
        setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId))

        val store = CalibrationStore(this)

        setContent {
            MaterialTheme {
                ConfigScreen(
                    store = store,
                    onSave = { codes ->
                        lifecycleScope.launch {
                            store.setQuickFloors(codes)
                            QuickFloorWidgetProvider.updateAll(this@QuickFloorConfigActivity)
                            setResult(
                                RESULT_OK,
                                Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
                            )
                            finish()
                        }
                    }
                )
            }
        }
    }
}

private val Purple = Color(0xFF7A5CFF)
private val TextPrimary = Color(0xFF1A1033)
private val TextSecondary = Color(0xFF6B7280)

// 표시 순서(고정): 지상 1~5, 지하 1~5
private val ALL_CODES = listOf(1, 2, 3, 4, 5, -1, -2, -3, -4, -5)

private fun codeLabel(code: Int): String = if (code > 0) "${code}층" else "지하 ${-code}층"

@Composable
private fun ConfigScreen(store: CalibrationStore, onSave: (List<Int>) -> Unit) {
    var selected by remember { mutableStateOf<Set<Int>>(emptySet()) }
    var loaded by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        selected = store.quickFloorsOnce().toSet()
        loaded = true
    }

    Surface(modifier = Modifier.fillMaxSize(), color = Color(0xFFFAF9FE)) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(24.dp)
        ) {
            Text("표시할 주차층 선택", color = TextPrimary, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
            Spacer(Modifier.height(4.dp))
            Text("위젯에 보일 층을 고르세요 (지상 5층 ~ 지하 5층, 최대 10개)", color = TextSecondary, fontSize = 13.sp)
            Spacer(Modifier.height(20.dp))

            Text("지상", color = Purple, fontSize = 14.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(4.dp))
            for (n in 1..5) {
                CheckRow(codeLabel(n), selected.contains(n), enabled = loaded) {
                    selected = if (selected.contains(n)) selected - n else selected + n
                }
            }

            Spacer(Modifier.height(14.dp))
            Text("지하", color = Purple, fontSize = 14.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(4.dp))
            for (n in 1..5) {
                val code = -n
                CheckRow(codeLabel(code), selected.contains(code), enabled = loaded) {
                    selected = if (selected.contains(code)) selected - code else selected + code
                }
            }

            Spacer(Modifier.height(24.dp))
            Button(
                onClick = { onSave(ALL_CODES.filter { selected.contains(it) }) },
                enabled = selected.isNotEmpty(),
                modifier = Modifier.fillMaxWidth().height(52.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Purple)
            ) {
                Text("저장", fontSize = 16.sp, fontWeight = FontWeight.Bold)
            }
            if (selected.isEmpty()) {
                Spacer(Modifier.height(8.dp))
                Text("최소 1개 층을 선택하세요", color = Color(0xFFFF9500), fontSize = 12.sp)
            }
        }
    }
}

@Composable
private fun CheckRow(label: String, checked: Boolean, enabled: Boolean, onToggle: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = enabled) { onToggle() }
            .background(Color.White, MaterialTheme.shapes.medium)
            .padding(horizontal = 12.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Start
    ) {
        Checkbox(
            checked = checked,
            onCheckedChange = null,
            enabled = enabled,
            colors = CheckboxDefaults.colors(checkedColor = Purple)
        )
        Spacer(Modifier.width(4.dp))
        Text(label, color = TextPrimary, fontSize = 15.sp)
    }
}
