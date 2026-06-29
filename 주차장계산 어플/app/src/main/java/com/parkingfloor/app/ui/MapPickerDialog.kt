package com.parkingfloor.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import org.osmdroid.config.Configuration
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView

/**
 * OpenStreetMap 기반 우리집 위치 선택 다이얼로그.
 * 지도를 움직여 화면 중앙 핀을 건물 위에 맞춘 뒤 "이 위치로 등록"을 누른다.
 * (지도 중심 = 선택 좌표)
 */
@Composable
fun MapPickerDialog(
    initialLat: Double,
    initialLng: Double,
    onCurrentLocation: (() -> Pair<Double, Double>?)? = null,
    onConfirm: (Double, Double) -> Unit,
    onDismiss: () -> Unit
) {
    val ctx = LocalContext.current

    val mapView = remember {
        Configuration.getInstance().userAgentValue = ctx.packageName
        MapView(ctx).apply {
            setTileSource(TileSourceFactory.MAPNIK)
            setMultiTouchControls(true)
            controller.setZoom(18.0)
            controller.setCenter(GeoPoint(initialLat, initialLng))
        }
    }

    DisposableEffect(Unit) {
        mapView.onResume()
        onDispose {
            mapView.onPause()
            mapView.onDetach()
        }
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Surface(modifier = Modifier.fillMaxSize()) {
            Box(modifier = Modifier.fillMaxSize()) {
                AndroidView(factory = { mapView }, modifier = Modifier.fillMaxSize())

                // 화면 중앙 고정 핀 (tip이 중심을 가리키도록 위로 올림)
                Icon(
                    imageVector = Icons.Filled.Place,
                    contentDescription = "선택 위치",
                    tint = Color(0xFFD32F2F),
                    modifier = Modifier
                        .align(Alignment.Center)
                        .offset(y = (-22).dp)
                        .size(48.dp)
                )

                // 상단 안내
                Surface(
                    color = MaterialTheme.colorScheme.surface.copy(alpha = 0.9f),
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .fillMaxWidth()
                        .padding(12.dp)
                ) {
                    Text(
                        "지도를 움직여 가운데 핀을 우리집(주차장 입구) 위에 맞추세요",
                        modifier = Modifier.padding(12.dp),
                        fontSize = 14.sp
                    )
                }

                // 하단 버튼
                Column(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.9f))
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    if (onCurrentLocation != null) {
                        OutlinedButton(
                            onClick = {
                                onCurrentLocation()?.let { (la, ln) ->
                                    mapView.controller.animateTo(GeoPoint(la, ln))
                                    mapView.controller.setZoom(18.0)
                                }
                            },
                            modifier = Modifier.fillMaxWidth()
                        ) { Text("📍 현재 위치로 이동") }
                    }
                    Button(
                        onClick = {
                            val c = mapView.mapCenter
                            onConfirm(c.latitude, c.longitude)
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) { Text("이 위치를 우리집으로 등록") }
                    OutlinedButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) {
                        Text("취소")
                    }
                }
            }
        }
    }
}
