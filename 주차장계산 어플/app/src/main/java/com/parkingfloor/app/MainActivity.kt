package com.parkingfloor.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color as AndroidColor
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.result.contract.ActivityResultContracts.RequestPermission
import androidx.activity.viewModels
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.AutoFixHigh
import androidx.compose.material.icons.filled.Bluetooth
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.HelpOutline
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SignalCellularAlt
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.TrackChanges
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.parkingfloor.app.data.CalibrationStore
import com.parkingfloor.app.data.CarBtDevice
import com.parkingfloor.app.data.HomeLocation
import com.parkingfloor.app.data.ParkedResult
import com.parkingfloor.app.data.floorIndexToLabel
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import kotlin.math.abs

// ---- 컬러 팔레트 ----
private val Purple        = Color(0xFF7A5CFF)
private val PurpleDark    = Color(0xFF5B3FD6)
private val PurpleLight   = Color(0xFFEDE9FF)
private val BgColor       = Color(0xFFFAF9FE)
private val SuccessGreen  = Color(0xFF2ECC8F)
private val OrangeColor   = Color(0xFFFF9500)
private val YellowAccent  = Color(0xFFFFD54F)
private val TextPrimary   = Color(0xFF1A1033)
private val TextSecondary = Color(0xFF6B7280)

private fun floorShortLabel(index: Int): String = when {
    index == CalibrationStore.OUTSIDE_FLOOR -> "OUT"
    index <= 0 -> "G${1 - index}"
    else -> "B$index"
}

/** "오늘 11:42 PM" / "어제 10:18 PM" / "6월 22일 09:07 PM" */
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

private enum class AppScreen { HOME, RECORDS, SETTINGS }

class MainActivity : ComponentActivity() {

    private val viewModel: MainViewModel by viewModels()

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            viewModel.startLocationDebug()
            viewModel.refreshBtConnected()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)
        window.statusBarColor = AndroidColor.rgb(250, 249, 254)
        window.navigationBarColor = AndroidColor.WHITE
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = true
            isAppearanceLightNavigationBars = true
        }
        requestRuntimePermissions()
        // 설치/업데이트/강제종료 후, 자동감지가 켜져 있었으면 서비스를 되살린다
        viewModel.resurrectAutoIfNeeded()
        setContent {
            MaterialTheme {
                val setupDone by viewModel.setupComplete.collectAsStateWithLifecycle()
                when (setupDone) {
                    true -> MainScreen(viewModel)
                    false -> OnboardingScreen(viewModel)
                    null -> Surface(modifier = Modifier.fillMaxSize().systemBarsPadding(), color = BgColor) {}
                }
            }
        }
    }

    private fun requestRuntimePermissions() {
        val needed = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            needed += Manifest.permission.POST_NOTIFICATIONS
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            needed += Manifest.permission.BLUETOOTH_CONNECT
        }
        needed += Manifest.permission.ACCESS_FINE_LOCATION
        val toRequest = needed.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (toRequest.isNotEmpty()) {
            permissionLauncher.launch(toRequest.toTypedArray())
        }
    }
}

// ════════════════════════════════════════════
// 첫 실행 설정 마법사 (온보딩)
// ════════════════════════════════════════════

@Composable
private fun OnboardingScreen(viewModel: MainViewModel) {
    val context = LocalContext.current
    val home by viewModel.homeLocation.collectAsStateWithLifecycle()
    val carBt by viewModel.carBtDevice.collectAsStateWithLifecycle()
    val currentLatLng by viewModel.currentLatLng.collectAsStateWithLifecycle()
    val garageAbove by viewModel.garageAbove.collectAsStateWithLifecycle()
    val garageBelow by viewModel.garageBelow.collectAsStateWithLifecycle()
    val minIdx = CalibrationStore.minFloorIndex(garageAbove)
    val maxIdx = garageBelow
    var showMap by remember { mutableStateOf(false) }
    var showBt by remember { mutableStateOf(false) }
    // 현재 차 위치 초기 등록: chose=선택함, initialFloor=층(0~5)·null=집밖
    var chose by remember { mutableStateOf(false) }
    var initialFloor by remember { mutableStateOf<Int?>(null) }
    val bgLocationLauncher = rememberLauncherForActivityResult(RequestPermission()) { }

    DisposableEffect(Unit) {
        viewModel.startLocationDebug()
        onDispose { }
    }

    Surface(modifier = Modifier.fillMaxSize().systemBarsPadding(), color = BgColor) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(24.dp)
        ) {
            Spacer(Modifier.height(20.dp))
            Text("환영합니다 👋", color = TextPrimary, fontSize = 28.sp, fontWeight = FontWeight.ExtraBold)
            Spacer(Modifier.height(6.dp))
            Text("주차층알리미를 쓰려면 아래만 설정하면 끝나요.", color = TextSecondary, fontSize = 14.sp)
            Spacer(Modifier.height(24.dp))

            val h = home
            val cb = carBt

            // 1. 우리집 위치 (필수)
            OnboardStep(
                icon = Icons.Filled.Home,
                title = "우리집 위치",
                badge = "필수",
                badgeColor = Purple,
                done = h != null
            ) {
                if (h != null) {
                    Text(
                        "등록 완료",
                        color = SuccessGreen, fontSize = 13.sp, fontWeight = FontWeight.SemiBold
                    )
                } else {
                    Text(
                        "집에 도착하면 자동 감지가 시작돼요. 지도에서 우리 아파트를 찍어주세요.",
                        color = TextSecondary, fontSize = 13.sp
                    )
                }
                Spacer(Modifier.height(10.dp))
                Button(
                    onClick = { showMap = true },
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Purple)
                ) {
                    Icon(Icons.Filled.Map, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(if (h == null) "지도에서 선택" else "다시 선택")
                }
            }
            Spacer(Modifier.height(12.dp))

            // 2. 차량 블루투스 (선택)
            OnboardStep(
                icon = Icons.Filled.Bluetooth,
                title = "차량 블루투스",
                badge = "권장",
                badgeColor = TextSecondary,
                done = cb != null
            ) {
                if (cb != null) {
                    Text(
                        "${cb.name} 등록됨",
                        color = SuccessGreen, fontSize = 13.sp, fontWeight = FontWeight.SemiBold
                    )
                } else {
                    Text(
                        "등록하면 시동 ON/OFF를 감지해 더 정확해져요. 없어도 기압 변화 기준으로 시작할 수 있습니다.",
                        color = TextSecondary, fontSize = 13.sp
                    )
                }
                Spacer(Modifier.height(10.dp))
                OutlinedButton(
                    onClick = { showBt = true },
                    shape = RoundedCornerShape(12.dp),
                    border = BorderStroke(1.5.dp, Purple)
                ) {
                    Text(if (cb == null) "기기 선택" else "기기 변경", color = Purple)
                }
            }
            Spacer(Modifier.height(12.dp))
            // 3. 우리집 주차장 층수 (필수)
            OnboardStep(
                icon = Icons.Filled.Home,
                title = "우리집 주차장 층수",
                badge = "필수",
                badgeColor = Purple,
                done = true
            ) {
                Text("지상·지하 각각 몇 층까지 있나요? (최대 5층)", color = TextSecondary, fontSize = 13.sp)
                Spacer(Modifier.height(12.dp))
                GarageStepperRow("지상", garageAbove) { viewModel.setGarageFloors(it, garageBelow) }
                Spacer(Modifier.height(8.dp))
                GarageStepperRow("지하", garageBelow) { viewModel.setGarageFloors(garageAbove, it) }
            }

            Spacer(Modifier.height(12.dp))
            // 4. 현재 주차 위치 (선택)
            OnboardStep(
                icon = Icons.Filled.DirectionsCar,
                title = "현재 주차 위치",
                badge = "선택",
                badgeColor = TextSecondary,
                done = chose
            ) {
                Text(
                    "지금 차가 어디에 있나요? 나중에 바뀌면 자동으로 갱신돼요.",
                    color = TextSecondary, fontSize = 13.sp
                )
                Spacer(Modifier.height(10.dp))
                (minIdx..maxIdx).toList().chunked(3).forEach { rowFloors ->
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        rowFloors.forEach { idx ->
                            OnboardChip(
                                floorIndexToLabel(idx),
                                selected = chose && initialFloor == idx,
                                modifier = Modifier.weight(1f)
                            ) { chose = true; initialFloor = idx }
                        }
                        repeat(3 - rowFloors.size) { Spacer(Modifier.weight(1f)) }
                    }
                    Spacer(Modifier.height(8.dp))
                }
                OnboardChip(
                    "집 밖 (회사 등)",
                    selected = chose && initialFloor == null,
                    modifier = Modifier.fillMaxWidth()
                ) { chose = true; initialFloor = null }
            }

            Spacer(Modifier.height(16.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.AutoFixHigh, contentDescription = null, tint = Purple, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text(
                    "자동 감지는 자동으로 켜집니다. (설정에서 끌 수 있어요)",
                    color = TextSecondary, fontSize = 12.sp
                )
            }

            Spacer(Modifier.height(20.dp))
            Button(
                onClick = {
                    // 현재 주차 위치 초기 등록 (층 선택 시 기록, 집밖이면 기록 없음)
                    if (chose && initialFloor != null) {
                        viewModel.overrideFloor(initialFloor!!)
                    }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        bgLocationLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                    }
                    viewModel.enableAutoStart()
                    viewModel.completeSetup()
                },
                enabled = h != null,
                modifier = Modifier.fillMaxWidth().height(56.dp),
                shape = RoundedCornerShape(16.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Purple)
            ) {
                Text("시작하기", fontSize = 16.sp, fontWeight = FontWeight.Bold)
            }
            if (h == null) {
                Spacer(Modifier.height(8.dp))
                Text(
                    "우리집 위치를 먼저 등록해주세요",
                    color = OrangeColor, fontSize = 12.sp,
                    modifier = Modifier.fillMaxWidth(),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center
                )
            }
            Spacer(Modifier.height(20.dp))
        }
    }

    if (showMap) {
        val startLat = home?.lat ?: currentLatLng?.first ?: 37.5665
        val startLng = home?.lng ?: currentLatLng?.second ?: 126.9780
        com.parkingfloor.app.ui.MapPickerDialog(
            initialLat = startLat,
            initialLng = startLng,
            onCurrentLocation = { currentLatLng },
            onConfirm = { lat, lng ->
                viewModel.saveHome(lat, lng)
                showMap = false
                Toast.makeText(context, "우리집 위치가 등록되었습니다", Toast.LENGTH_SHORT).show()
            },
            onDismiss = { showMap = false }
        )
    }
    if (showBt) {
        BtPickerDialog(
            devices = viewModel.bondedDevices(),
            onSelect = { viewModel.setCarBtDevice(it); showBt = false },
            onDismiss = { showBt = false }
        )
    }
}

@Composable
private fun OnboardStep(
    icon: ImageVector,
    title: String,
    badge: String,
    badgeColor: Color,
    done: Boolean,
    content: @Composable ColumnScope.() -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(2.dp)
    ) {
        Row(modifier = Modifier.padding(20.dp), verticalAlignment = Alignment.Top) {
            Box(
                modifier = Modifier
                    .size(56.dp)
                    .clip(CircleShape)
                    .background(if (done) SuccessGreen.copy(alpha = 0.15f) else PurpleLight),
                contentAlignment = Alignment.Center
            ) {
                if (done) {
                    Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = SuccessGreen, modifier = Modifier.size(30.dp))
                } else {
                    Icon(icon, contentDescription = null, tint = Purple, modifier = Modifier.size(28.dp))
                }
            }
            Spacer(Modifier.width(16.dp))
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(title, color = TextPrimary, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.width(8.dp))
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(50))
                            .background(badgeColor.copy(alpha = 0.12f))
                            .padding(horizontal = 8.dp, vertical = 2.dp)
                    ) {
                        Text(badge, color = badgeColor, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    }
                }
                Spacer(Modifier.height(8.dp))
                content()
            }
        }
    }
}

/** 온보딩 '현재 주차 위치' 선택 칩 */
@Composable
private fun OnboardChip(
    label: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) Purple else PurpleLight)
            .clickable { onClick() }
            .padding(vertical = 12.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            label,
            color = if (selected) Color.White else Purple,
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 1
        )
    }
}

/** 지상/지하 층수 조절 행 (- N층 +) */
@Composable
private fun GarageStepperRow(label: String, value: Int, onChange: (Int) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Text(label, color = TextPrimary, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.weight(1f))
        StepBtn("−") { if (value > 1) onChange(value - 1) }
        Text(
            "${value}층", color = Purple, fontSize = 16.sp, fontWeight = FontWeight.Bold,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            modifier = Modifier.width(56.dp)
        )
        StepBtn("+") { if (value < CalibrationStore.MAX_GARAGE_FLOORS) onChange(value + 1) }
    }
}

@Composable
private fun StepBtn(text: String, onClick: () -> Unit) {
    Box(
        modifier = Modifier.size(36.dp).clip(CircleShape).background(PurpleLight).clickable { onClick() },
        contentAlignment = Alignment.Center
    ) {
        Text(text, color = Purple, fontSize = 20.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun MainScreen(viewModel: MainViewModel) {
    val pressure         by viewModel.currentPressure.collectAsStateWithLifecycle()
    val baseline         by viewModel.baselinePressure.collectAsStateWithLifecycle()
    val hPaPerFloor      by viewModel.hPaPerFloor.collectAsStateWithLifecycle()
    val entryCorrection  by viewModel.entryPressureCorrection.collectAsStateWithLifecycle()
    val floorSamples     by viewModel.floorPressureSamples.collectAsStateWithLifecycle()
    val isTracking       by viewModel.isTracking.collectAsStateWithLifecycle()
    val trackingStatus   by viewModel.trackingStatus.collectAsStateWithLifecycle()
    val lastParked       by viewModel.lastParked.collectAsStateWithLifecycle()
    val carBt            by viewModel.carBtDevice.collectAsStateWithLifecycle()
    val home             by viewModel.homeLocation.collectAsStateWithLifecycle()
    val autoStartEnabled by viewModel.autoStartEnabled.collectAsStateWithLifecycle()
    val distance         by viewModel.distanceToHome.collectAsStateWithLifecycle()
    val inside           by viewModel.insideGeofence.collectAsStateWithLifecycle()
    val track            by viewModel.trackDebug.collectAsStateWithLifecycle()
    val carBtConnected   by viewModel.carBtConnected.collectAsStateWithLifecycle()
    val currentLatLng    by viewModel.currentLatLng.collectAsStateWithLifecycle()
    val plateauSeconds   by viewModel.plateauSeconds.collectAsStateWithLifecycle()
    val homeRadius       by viewModel.homeRadius.collectAsStateWithLifecycle()
    val parkingHistory   by viewModel.parkingHistory.collectAsStateWithLifecycle()
    val garageAbove      by viewModel.garageAbove.collectAsStateWithLifecycle()
    val garageBelow      by viewModel.garageBelow.collectAsStateWithLifecycle()
    val minFloorIndex = CalibrationStore.minFloorIndex(garageAbove)
    val maxFloorIndex = garageBelow

    val context = LocalContext.current
    var screen          by remember { mutableStateOf(AppScreen.HOME) }
    var showBtPicker    by remember { mutableStateOf(false) }
    var showMapPicker   by remember { mutableStateOf(false) }
    var showDiagDialog  by remember { mutableStateOf(false) }
    var showPermDialog  by remember { mutableStateOf(false) }
    val backgroundLocationLauncher = rememberLauncherForActivityResult(RequestPermission()) { }

    DisposableEffect(Unit) {
        viewModel.startLocationDebug()
        viewModel.startBtMonitor()
        onDispose {
            viewModel.stopLocationDebug()
            viewModel.stopBtMonitor()
        }
    }

    val floorIndex = rememberFloorIndex(pressure, baseline, hPaPerFloor, viewModel)

    val toggleAuto: (Boolean) -> Unit = { enable ->
        if (enable) {
            if (home == null) {
                Toast.makeText(context, "먼저 [설정]에서 우리집 위치를 등록하세요", Toast.LENGTH_SHORT).show()
            } else {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    backgroundLocationLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                }
                viewModel.enableAutoStart()
            }
        } else viewModel.disableAutoStart()
    }

    if (!viewModel.sensorAvailable) {
        Surface(modifier = Modifier.fillMaxSize().systemBarsPadding(), color = BgColor) {
            Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(24.dp)) {
                ErrorCard("이 기기에는 기압 센서가 없어 동작할 수 없습니다 😢")
            }
        }
        return
    }

    Scaffold(
        modifier = Modifier.systemBarsPadding(),
        containerColor = BgColor,
        bottomBar = {
            NavigationBar(containerColor = Color.White) {
                val navColors = NavigationBarItemDefaults.colors(
                    indicatorColor = PurpleLight,
                    selectedIconColor = Purple,
                    selectedTextColor = Purple,
                    unselectedIconColor = TextSecondary,
                    unselectedTextColor = TextSecondary
                )
                NavigationBarItem(
                    icon = { Icon(Icons.Filled.Home, contentDescription = "홈") },
                    label = { Text("홈", fontSize = 11.sp) },
                    selected = screen == AppScreen.HOME,
                    onClick = { screen = AppScreen.HOME },
                    colors = navColors
                )
                NavigationBarItem(
                    icon = { Icon(Icons.Filled.Schedule, contentDescription = "기록") },
                    label = { Text("기록", fontSize = 11.sp) },
                    selected = screen == AppScreen.RECORDS,
                    onClick = { screen = AppScreen.RECORDS },
                    colors = navColors
                )
                NavigationBarItem(
                    icon = { Icon(Icons.Filled.Settings, contentDescription = "설정") },
                    label = { Text("설정", fontSize = 11.sp) },
                    selected = screen == AppScreen.SETTINGS,
                    onClick = { screen = AppScreen.SETTINGS },
                    colors = navColors
                )
            }
        }
    ) { innerPadding ->
        when (screen) {
            AppScreen.HOME -> HomeContent(
                modifier = Modifier.padding(innerPadding),
                isTracking = isTracking,
                trackingFloorIndex = track?.floor,
                parked = lastParked,
                autoOn = autoStartEnabled,
                inside = inside,
                distance = distance,
                carBtConnected = carBtConnected,
                homeRadius = homeRadius,
                carBt = carBt,
                parkingHistory = parkingHistory,
                onGoSettings = { screen = AppScreen.SETTINGS },
                onOpenDiag = { showDiagDialog = true },
                onSeeAll = { screen = AppScreen.RECORDS },
                minFloorIndex = minFloorIndex,
                maxFloorIndex = maxFloorIndex,
                onEditRecord = { time, idx -> viewModel.editRecordFloor(time, idx) }
            )
            AppScreen.RECORDS -> RecordsContent(
                modifier = Modifier.padding(innerPadding),
                parkingHistory = parkingHistory,
                minFloorIndex = minFloorIndex,
                maxFloorIndex = maxFloorIndex,
                onEditRecord = { time, idx -> viewModel.editRecordFloor(time, idx) }
            )
            AppScreen.SETTINGS -> SettingsContent(
                modifier = Modifier.padding(innerPadding),
                home = home,
                homeRadius = homeRadius,
                carBt = carBt,
                carBtConnected = carBtConnected,
                autoOn = autoStartEnabled,
                viewModel = viewModel,
                context = context,
                onPickMap = { showMapPicker = true },
                onPickBt = { showBtPicker = true },
                onRadiusChange = { viewModel.setHomeRadius(it) },
                onToggleAuto = toggleAuto,
                onOpenDiag = { showDiagDialog = true },
                onOpenPermission = { showPermDialog = true }
            )
        }
    }

    if (showMapPicker) {
        val startLat = home?.lat ?: currentLatLng?.first ?: 37.5665
        val startLng = home?.lng ?: currentLatLng?.second ?: 126.9780
        com.parkingfloor.app.ui.MapPickerDialog(
            initialLat = startLat,
            initialLng = startLng,
            onCurrentLocation = { currentLatLng },
            onConfirm = { lat, lng ->
                viewModel.saveHome(lat, lng)
                showMapPicker = false
                Toast.makeText(context, "지도에서 우리집 위치가 등록되었습니다", Toast.LENGTH_SHORT).show()
            },
            onDismiss = { showMapPicker = false }
        )
    }

    if (showBtPicker) {
        BtPickerDialog(
            devices = viewModel.bondedDevices(),
            onSelect = { viewModel.setCarBtDevice(it); showBtPicker = false },
            onDismiss = { showBtPicker = false }
        )
    }

    if (showDiagDialog) {
        DiagnosticsDialog(
            viewModel = viewModel,
            context = context,
            distance = distance,
            inside = inside,
            track = track,
            currentLatLng = currentLatLng,
            isTracking = isTracking,
            autoStartEnabled = autoStartEnabled,
            trackingStatus = trackingStatus,
            lastParked = lastParked,
            pressure = pressure,
            baseline = baseline,
            hPaPerFloor = hPaPerFloor,
            entryCorrection = entryCorrection,
            floorSamples = floorSamples,
            garageBelow = garageBelow,
            plateauSeconds = plateauSeconds,
            floorIndex = floorIndex,
            onDismiss = { showDiagDialog = false }
        )
    }

    if (showPermDialog) {
        PermissionDialog(
            hasLocation = viewModel.hasLocationPermission(),
            gpsEnabled = viewModel.isGpsEnabled(),
            onOpenSettings = {
                runCatching {
                    context.startActivity(
                        Intent(
                            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.fromParts("package", context.packageName, null)
                        )
                    )
                }
            },
            onDismiss = { showPermDialog = false }
        )
    }
}

// ════════════════════════════════════════════
// 공통 위젯
// ════════════════════════════════════════════

@Composable
private fun IconCircle(
    icon: ImageVector,
    size: Dp = 56.dp,
    iconSize: Dp = 28.dp,
    bg: Color = PurpleLight,
    tint: Color = Purple
) {
    Box(
        modifier = Modifier.size(size).clip(CircleShape).background(bg),
        contentAlignment = Alignment.Center
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(iconSize))
    }
}

/** 자동차 아래에서 퍼지는 레이더 펄스 (감지 중 표시) */
@Composable
private fun RadarPulse(modifier: Modifier = Modifier, color: Color = Color.White) {
    val transition = rememberInfiniteTransition(label = "radar")
    val progress by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(durationMillis = 3800, easing = LinearEasing)),
        label = "progress"
    )
    Canvas(modifier = modifier) {
        val cx = size.width / 2f
        val cy = size.height * 0.66f          // 자동차 바퀴/바닥 라인 (차 아래에서 퍼지도록)
        val maxRx = size.width * 0.46f
        for (i in 0..3) {
            val phase = (progress + i / 4f) % 1f
            val rx = maxRx * (0.35f + 0.65f * phase)
            val ry = rx * 0.30f               // 납작한 타원(바닥 파동)
            val alpha = (1f - phase) * 0.40f
            drawOval(
                color = color.copy(alpha = alpha),
                topLeft = Offset(cx - rx, cy - ry),
                size = Size(rx * 2f, ry * 2f),
                style = Stroke(width = 1.5.dp.toPx())
            )
        }
    }
}

private enum class ParkingAlertState { DETECTING, COMPLETED, OUTSIDE }

/** 메인 주차 알림 카드 — 감지중 / 주차완료 / 집근처 벗어남 3상태 통일 디자인 */
@Composable
private fun ParkingAlertCard(
    isTracking: Boolean,
    trackingFloorIndex: Int?,
    parked: ParkedResult,
    modifier: Modifier = Modifier
) {
    val state = when {
        isTracking -> ParkingAlertState.DETECTING
        parked.hasResult -> ParkingAlertState.COMPLETED
        else -> ParkingAlertState.OUTSIDE
    }
    val shape = RoundedCornerShape(28.dp)
    val shadowColor = Color(0x385B3FD6)
    Box(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 272.dp)
            .shadow(20.dp, shape, spotColor = shadowColor, ambientColor = shadowColor)
            .clip(shape)
            .background(
                Brush.linearGradient(
                    0.0f to Color(0xFF8B6CFF),
                    0.45f to Color(0xFF6F4EFF),
                    1.0f to Color(0xFF4E35C9)
                )
            )
    ) {
        when (state) {
            ParkingAlertState.DETECTING -> {
                // 자동차 + 펄스 (더 크게 + 세로 중앙 정렬)
                Box(
                    modifier = Modifier.align(Alignment.CenterEnd).padding(end = 6.dp).size(196.dp)
                ) {
                    RadarPulse(modifier = Modifier.matchParentSize())
                    Image(
                        painter = painterResource(R.drawable.car_front),
                        contentDescription = null,
                        modifier = Modifier.align(Alignment.Center).size(164.dp).alpha(1.0f)
                    )
                }
                Column(modifier = Modifier.align(Alignment.CenterStart).padding(start = 28.dp, top = 24.dp, bottom = 24.dp, end = 12.dp)) {
                    CardLabel("현재 위치 감지")
                    Spacer(Modifier.height(20.dp))
                    Text("🔍 주차 감지 중", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1)
                    Spacer(Modifier.height(12.dp))
                    Row(
                        modifier = Modifier.clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.18f)).padding(horizontal = 14.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("추정 층수 : ", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        Text(trackingFloorIndex?.let { floorIndexToLabel(it) } ?: "측정 중", color = YellowAccent, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                    }
                    Spacer(Modifier.height(16.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        androidx.compose.material3.CircularProgressIndicator(modifier = Modifier.size(13.dp), color = Color.White, strokeWidth = 2.dp)
                        Spacer(Modifier.width(8.dp))
                        Text("주차가 완료되면 자동으로 기록할게요", color = Color.White.copy(alpha = 0.8f), fontSize = 12.sp)
                    }
                }
            }
            ParkingAlertState.COMPLETED -> {
                // 자동차 + P핀(지붕 위) — 우측 세로 중앙 대칭
                Box(
                    modifier = Modifier.align(Alignment.CenterEnd).padding(end = 10.dp).size(width = 192.dp, height = 222.dp)
                ) {
                    Image(
                        painter = painterResource(R.drawable.car_front),
                        contentDescription = null,
                        modifier = Modifier.align(Alignment.BottomCenter).size(180.dp).alpha(1.0f)
                    )
                    ParkingPin(
                        heightDp = 60.dp,
                        modifier = Modifier.align(Alignment.TopCenter).padding(top = 30.dp)
                    )
                }
                Column(modifier = Modifier.align(Alignment.CenterStart).padding(start = 28.dp, top = 24.dp, bottom = 24.dp).fillMaxWidth(0.6f)) {
                    CardLabel("현재 위치 감지")
                    Spacer(Modifier.height(14.dp))
                    Text("주차가 완료됐어요", color = Color.White.copy(alpha = 0.9f), fontSize = 12.sp)
                    Spacer(Modifier.height(6.dp))
                    Text("${floorIndexToLabel(parked.floorIndex)}에\n주차했어요", color = Color.White, fontSize = 29.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 34.sp)
                    Spacer(Modifier.height(14.dp))
                    CardBadge(prefix = "기록 완료 : ", accent = floorIndexToLabel(parked.floorIndex))
                }
            }
            ParkingAlertState.OUTSIDE -> {
                Image(
                    painter = painterResource(R.drawable.outside_background),
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.matchParentSize().alpha(0.75f)
                )
                Box(
                    modifier = Modifier.matchParentSize().background(
                        Brush.horizontalGradient(0.0f to Color(0xE64E35C9), 0.55f to Color.Transparent)
                    )
                )
                Image(
                    painter = painterResource(R.drawable.car_front),
                    contentDescription = null,
                    modifier = Modifier.align(Alignment.BottomEnd).padding(end = 14.dp, bottom = 12.dp).size(150.dp).alpha(1.0f)
                )
                Column(modifier = Modifier.align(Alignment.CenterStart).padding(start = 28.dp, top = 24.dp, bottom = 24.dp).fillMaxWidth(0.62f)) {
                    CardLabel("현재 위치 감지")
                    Spacer(Modifier.height(14.dp))
                    Text("우리집 근처를 벗어났어요", color = Color.White.copy(alpha = 0.9f), fontSize = 15.sp)
                    Spacer(Modifier.height(6.dp))
                    Text("감지를\n종료했어요", color = Color.White, fontSize = 27.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 32.sp)
                    Spacer(Modifier.height(12.dp))
                    Row(
                        modifier = Modifier.clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.16f)).border(1.dp, Color.White.copy(alpha = 0.28f), RoundedCornerShape(50)).padding(horizontal = 14.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("현재는 ", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        Text("우리집 주차장 밖", color = YellowAccent, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        Text("이에요", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

@Composable
private fun CardLabel(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Filled.LocationOn, contentDescription = null, tint = Color.White.copy(alpha = 0.85f), modifier = Modifier.size(13.dp))
        Spacer(Modifier.width(6.dp))
        Text(text, color = Color.White.copy(alpha = 0.85f), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun CardBadge(prefix: String, accent: String) {
    Row(
        modifier = Modifier.clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.16f)).border(1.dp, Color.White.copy(alpha = 0.28f), RoundedCornerShape(50)).padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(prefix, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
        Text(accent, color = YellowAccent, fontSize = 13.sp, fontWeight = FontWeight.Bold)
    }
}

/** 코드로 그린 흰 주차 핀(부드러운 물방울, 끝 둥글기 26) + 보라 P */
@Composable
private fun ParkingPin(heightDp: androidx.compose.ui.unit.Dp, modifier: Modifier = Modifier) {
    val w = heightDp * 0.78f
    Box(modifier = modifier.size(width = w, height = heightDp)) {
        Canvas(modifier = Modifier.matchParentSize()) {
            val sx = size.width / 100f
            val sy = size.height / 128f
            fun px(x: Float) = x * sx
            fun py(y: Float) = y * sy
            // viewBox 100x128 물방울 (끝 둥글기 26 반영)
            val path = Path().apply {
                moveTo(px(50f), py(6f))
                cubicTo(px(26f), py(6f), px(8f), py(24f), px(8f), py(48f))
                cubicTo(px(8f), py(72f), px(31.9f), py(94.96f), px(50f), py(117.3f))
                cubicTo(px(68.1f), py(94.96f), px(92f), py(72f), px(92f), py(48f))
                cubicTo(px(92f), py(24f), px(74f), py(6f), px(50f), py(6f))
                close()
            }
            drawPath(path, Color.White)
        }
        Text(
            "P",
            color = Purple,
            fontSize = (heightDp.value * 0.34f).sp,
            fontWeight = FontWeight.ExtraBold,
            modifier = Modifier.align(Alignment.TopCenter).padding(top = heightDp * 0.14f)
        )
    }
}

@Composable
private fun WhiteCard(content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(2.dp)
    ) {
        Column(modifier = Modifier.padding(20.dp), content = content)
    }
}

/** 왼쪽 원형 아이콘 + 오른쪽 컨텐츠 카드 (설정 화면용) */
@Composable
private fun IconCard(icon: ImageVector, content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(2.dp)
    ) {
        Row(
            modifier = Modifier.padding(20.dp),
            verticalAlignment = Alignment.Top
        ) {
            IconCircle(icon)
            Spacer(Modifier.width(16.dp))
            Column(modifier = Modifier.weight(1f), content = content)
        }
    }
}

// ════════════════════════════════════════════
// 홈 화면
// ════════════════════════════════════════════

@Composable
private fun HomeContent(
    modifier: Modifier = Modifier,
    isTracking: Boolean,
    trackingFloorIndex: Int?,
    parked: ParkedResult,
    autoOn: Boolean,
    inside: Boolean?,
    distance: Float?,
    carBtConnected: Boolean?,
    homeRadius: Float,
    carBt: CarBtDevice?,
    parkingHistory: List<ParkedResult>,
    onGoSettings: () -> Unit,
    onOpenDiag: () -> Unit,
    onSeeAll: () -> Unit,
    minFloorIndex: Int,
    maxFloorIndex: Int,
    onEditRecord: (Long, Int) -> Unit
) {
    var editing by remember { mutableStateOf<ParkedResult?>(null) }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp)
    ) {
        // 헤더
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("주차층알리미", color = Purple, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
            Box(
                modifier = Modifier.size(40.dp).clip(CircleShape).background(Color.White),
                contentAlignment = Alignment.Center
            ) {
                IconButton(onClick = onGoSettings) {
                    Icon(Icons.Filled.Settings, contentDescription = "설정", tint = TextSecondary)
                }
            }
        }

        Spacer(Modifier.height(16.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.LocationOn, contentDescription = null, tint = Purple, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text("오늘 주차 위치", color = TextPrimary, fontSize = 16.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.height(10.dp))

        val btRegistered = carBt != null
        val engineOn = carBtConnected == true
        val grayDot = Color(0xFFBBBBBB)
        val distText = distance?.let {
            if (it < 1000f) "${it.toInt()}m" else "%.1fkm".format(it / 1000f)
        }
        val rangeText = when (inside) {
            true -> "우리집 범위 안 입니다" + (distText?.let { " ($it)" } ?: "")
            false -> "우리집 범위 밖 입니다" + (distText?.let { " ($it)" } ?: "")
            null -> "우리집 범위 확인 중…"
        }
        val statusLine = when {
            !btRegistered -> "차량 블루투스 미등록 · 자동 기록 제한"
            !engineOn -> "시동을 켜면 감지를 시작해요"
            inside == true -> "주차 탐색 중"
            inside == false -> "우리집 ${homeRadius.toInt()}m 범위안에서 자동탐지 시작"
            else -> "위치 확인 중…"
        }

        // 빅 주차 알림 카드 (감지중 / 주차완료 / 집근처 벗어남)
        ParkingAlertCard(
            isTracking = isTracking,
            trackingFloorIndex = trackingFloorIndex,
            parked = parked
        )

        Spacer(Modifier.height(16.dp))

        // 감지 상태 카드 (탭하면 진단)
        Card(
            modifier = Modifier.fillMaxWidth().clickable { onOpenDiag() },
            shape = RoundedCornerShape(18.dp),
            colors = CardDefaults.cardColors(containerColor = Color.White),
            elevation = CardDefaults.cardElevation(2.dp)
        ) {
            Row(
                modifier = Modifier.padding(16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconCircle(Icons.Filled.VerifiedUser, size = 48.dp, iconSize = 24.dp)
                Spacer(Modifier.width(14.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text("감지 상태", color = TextPrimary, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(8.dp).clip(CircleShape).background(if (btRegistered && engineOn) SuccessGreen else grayDot))
                        Spacer(Modifier.width(6.dp))
                        Text(if (!btRegistered) "차량 블루투스 미등록" else "시동 ${if (engineOn) "켜짐" else "꺼짐"}", color = TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    }
                    Spacer(Modifier.height(4.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(8.dp).clip(CircleShape).background(if (inside == true) SuccessGreen else grayDot))
                        Spacer(Modifier.width(6.dp))
                        Text(rangeText, color = TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(statusLine, color = if (!btRegistered) OrangeColor else if (engineOn) Purple else TextSecondary, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                }
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = TextSecondary)
            }
        }

        // 최근 기록
        Spacer(Modifier.height(28.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("최근 기록", color = TextPrimary, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.clickable { onSeeAll() }
                ) {
                    Text("전체 보기", color = Purple, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Purple, modifier = Modifier.size(18.dp))
                }
            }
            Spacer(Modifier.height(8.dp))
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = Color.White),
                elevation = CardDefaults.cardElevation(2.dp)
            ) {
                val recent = parkingHistory.take(3)
                if (recent.isEmpty()) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 18.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        IconCircle(Icons.Filled.Schedule, size = 36.dp, iconSize = 18.dp)
                        Spacer(Modifier.width(12.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text("주차 기록 없음", color = TextPrimary, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                            Spacer(Modifier.height(2.dp))
                            Text("주차가 기록되면 여기에 표시됩니다.", color = TextSecondary, fontSize = 12.sp)
                        }
                    }
                }
                recent.forEachIndexed { idx, record ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { editing = record }
                            .padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        IconCircle(Icons.Filled.Schedule, size = 36.dp, iconSize = 18.dp)
                        Spacer(Modifier.width(12.dp))
                        Text(relativeTime(record.timeMillis), color = TextPrimary, fontSize = 14.sp, modifier = Modifier.weight(1f))
                        Text(
                            floorIndexToLabel(record.floorIndex),
                            color = if (idx == 0) Purple else TextPrimary,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Spacer(Modifier.width(4.dp))
                        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = TextSecondary, modifier = Modifier.size(18.dp))
                    }
                    if (idx < recent.size - 1) {
                        HorizontalDivider(color = PurpleLight, thickness = 1.dp, modifier = Modifier.padding(horizontal = 16.dp))
                    }
                }
            }

        Spacer(Modifier.height(16.dp))
    }

    editing?.let { rec ->
        FloorPickerDialog(
            currentFloorIndex = rec.floorIndex,
            minFloorIndex = minFloorIndex,
            maxFloorIndex = maxFloorIndex,
            onSelect = { onEditRecord(rec.timeMillis, it); editing = null },
            onDismiss = { editing = null }
        )
    }
}

// ════════════════════════════════════════════
// 기록 화면
// ════════════════════════════════════════════

@Composable
private fun RecordsContent(
    modifier: Modifier = Modifier,
    parkingHistory: List<ParkedResult>,
    minFloorIndex: Int,
    maxFloorIndex: Int,
    onEditRecord: (Long, Int) -> Unit
) {
    var editing by remember { mutableStateOf<ParkedResult?>(null) }
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp)
    ) {
        Text("주차 기록", color = TextPrimary, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
        Spacer(Modifier.height(4.dp))
        Text("기록을 누르면 층을 수정할 수 있어요. (최근 10건 저장)", color = TextSecondary, fontSize = 13.sp)
        Spacer(Modifier.height(16.dp))

        if (parkingHistory.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxWidth().padding(top = 60.dp),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("🚗", fontSize = 48.sp)
                    Spacer(Modifier.height(12.dp))
                    Text("아직 기록이 없어요", color = TextPrimary, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(4.dp))
                    Text("주차가 감지되면 여기에 쌓입니다", color = TextSecondary, fontSize = 13.sp)
                }
            }
        } else {
            parkingHistory.forEach { record ->
                Card(
                    modifier = Modifier.fillMaxWidth().clickable { editing = record },
                    shape = RoundedCornerShape(18.dp),
                    colors = CardDefaults.cardColors(containerColor = Color.White),
                    elevation = CardDefaults.cardElevation(2.dp)
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier.size(48.dp).clip(CircleShape).background(PurpleLight),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(floorShortLabel(record.floorIndex), color = Purple, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                        }
                        Spacer(Modifier.width(14.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(floorIndexToLabel(record.floorIndex), color = TextPrimary, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                            Text(
                                SimpleDateFormat("yyyy년 M월 d일 a h:mm", Locale.KOREA).format(Date(record.timeMillis)),
                                color = TextSecondary, fontSize = 12.sp
                            )
                        }
                    }
                }
                Spacer(Modifier.height(10.dp))
            }
        }
    }

    editing?.let { rec ->
        FloorPickerDialog(
            currentFloorIndex = rec.floorIndex,
            minFloorIndex = minFloorIndex,
            maxFloorIndex = maxFloorIndex,
            onSelect = { onEditRecord(rec.timeMillis, it); editing = null },
            onDismiss = { editing = null }
        )
    }
}

// ════════════════════════════════════════════
// 설정 화면
// ════════════════════════════════════════════

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsContent(
    modifier: Modifier = Modifier,
    home: HomeLocation?,
    homeRadius: Float,
    carBt: CarBtDevice?,
    carBtConnected: Boolean?,
    autoOn: Boolean,
    viewModel: MainViewModel,
    context: android.content.Context,
    onPickMap: () -> Unit,
    onPickBt: () -> Unit,
    onRadiusChange: (Float) -> Unit,
    onToggleAuto: (Boolean) -> Unit,
    onOpenDiag: () -> Unit,
    onOpenPermission: () -> Unit
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp)
    ) {
        // 헤더
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("주차층알리미", color = Purple, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
            Box(
                modifier = Modifier.size(40.dp).clip(CircleShape).background(Color.White),
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Filled.Settings, contentDescription = null, tint = TextSecondary)
            }
        }

        Spacer(Modifier.height(16.dp))
        Text("설정", color = TextPrimary, fontSize = 28.sp, fontWeight = FontWeight.ExtraBold)
        Spacer(Modifier.height(2.dp))
        Text("앱 환경과 감지 설정을 관리해요.", color = TextSecondary, fontSize = 13.sp)
        Spacer(Modifier.height(20.dp))

        // 1. 우리집 위치
        IconCard(Icons.Filled.Home) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("우리집 위치", color = TextPrimary, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(4.dp))
                    if (home != null) {
                        Text("등록 완료", color = SuccessGreen, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    } else {
                        Text("미등록", color = TextSecondary, fontSize = 13.sp)
                    }
                }
                Spacer(Modifier.width(8.dp))
                OutlinedButton(
                    onClick = onPickMap,
                    shape = RoundedCornerShape(12.dp),
                    border = BorderStroke(1.5.dp, Purple),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp, vertical = 8.dp)
                ) {
                    Icon(Icons.Filled.Map, contentDescription = null, tint = Purple, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(if (home == null) "지도에서 선택" else "지도에서 다시 선택", color = Purple, fontSize = 13.sp)
                }
            }
        }
        Spacer(Modifier.height(12.dp))

        // 2. 도착 감지 반경
        IconCard(Icons.Filled.TrackChanges) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("도착 감지 반경", color = TextPrimary, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                Text("${homeRadius.toInt()} m", color = Purple, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
            }
            Spacer(Modifier.height(18.dp))
            Slider(
                value = homeRadius.coerceIn(50f, 300f),
                onValueChange = onRadiusChange,
                valueRange = 50f..300f,
                steps = 24,
                colors = SliderDefaults.colors(
                    thumbColor = Purple,
                    activeTrackColor = Purple,
                    inactiveTrackColor = PurpleLight,
                    activeTickColor = Color.Transparent,
                    inactiveTickColor = Color.Transparent
                ),
                thumb = { _ ->
                    Box(contentAlignment = Alignment.Center) {
                        Box(
                            modifier = Modifier
                                .offset(y = (-28).dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(Purple)
                                .padding(horizontal = 9.dp, vertical = 4.dp)
                        ) {
                            Text(
                                "${homeRadius.toInt()} m",
                                color = Color.White,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                        Box(
                            modifier = Modifier
                                .size(22.dp)
                                .clip(CircleShape)
                                .background(Purple)
                                .border(3.dp, Color.White, CircleShape)
                        )
                    }
                }
            )
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("50 m", color = TextSecondary, fontSize = 12.sp)
                Text("300 m", color = TextSecondary, fontSize = 12.sp)
            }
            Spacer(Modifier.height(6.dp))
            Text("이 반경은 집 근처 확인용이고, 자동 감지는 15m 안에서 시작돼요.", color = TextSecondary, fontSize = 11.sp)
        }
        Spacer(Modifier.height(12.dp))

        // 2-2. 우리집 주차장 층수
        val garageAbove by viewModel.garageAbove.collectAsStateWithLifecycle()
        val garageBelow by viewModel.garageBelow.collectAsStateWithLifecycle()
        IconCard(Icons.Filled.Home) {
            Text("우리집 주차장 층수", color = TextPrimary, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(4.dp))
            Text("지상·지하 각각 최대 5층까지 설정할 수 있어요.", color = TextSecondary, fontSize = 12.sp)
            Spacer(Modifier.height(14.dp))
            GarageStepperRow("지상", garageAbove) { viewModel.setGarageFloors(it, garageBelow) }
            Spacer(Modifier.height(10.dp))
            GarageStepperRow("지하", garageBelow) { viewModel.setGarageFloors(garageAbove, it) }
        }
        Spacer(Modifier.height(12.dp))

        // 3. 내 차량 블루투스
        IconCard(Icons.Filled.Bluetooth) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("내 차량 블루투스", color = TextPrimary, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(4.dp))
                    if (carBt != null) {
                        Text("${carBt.name} 등록됨", color = Purple, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(4.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(8.dp).clip(CircleShape).background(if (carBtConnected == true) SuccessGreen else Color(0xFFBBBBBB)))
                            Spacer(Modifier.width(6.dp))
                            Text(
                                when (carBtConnected) {
                                    true  -> "시동 켜짐 · 운전 중"
                                    false -> "시동 꺼짐 · 감지 가능"
                                    null  -> "확인 중..."
                                },
                                color = TextSecondary, fontSize = 12.sp,
                                maxLines = 1, softWrap = false
                            )
                        }
                    } else {
                        Text("등록 없음 (선택사항)", color = TextSecondary, fontSize = 13.sp)
                    }
                }
                Spacer(Modifier.width(8.dp))
                Column(horizontalAlignment = Alignment.End) {
                    Button(
                        onClick = onPickBt,
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Purple),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 18.dp, vertical = 8.dp)
                    ) {
                        Text(if (carBt == null) "기기 선택" else "기기 변경", fontSize = 13.sp)
                    }
                    if (carBt != null) {
                        Spacer(Modifier.height(6.dp))
                        OutlinedButton(
                            onClick = { viewModel.clearCarBtDevice() },
                            shape = RoundedCornerShape(12.dp),
                            border = BorderStroke(1.dp, Purple),
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 18.dp, vertical = 8.dp)
                        ) {
                            Text("등록 해제", color = Purple, fontSize = 13.sp)
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(12.dp))

        // 4. 자동 감지
        IconCard(Icons.Filled.AutoFixHigh) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("자동 감지", color = TextPrimary, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "자동 기록은 차량 블루투스가 끊기는 시점을 기준으로 합니다. 미등록 시 자동 기록은 제한돼요.",
                        color = TextSecondary, fontSize = 12.sp
                    )
                }
                Spacer(Modifier.width(8.dp))
                Switch(checked = autoOn, onCheckedChange = onToggleAuto)
            }
            if (carBt == null) {
                Spacer(Modifier.height(10.dp))
                Text("자동 기록을 쓰려면 차량 블루투스를 등록하세요.", color = OrangeColor, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
        }
        Spacer(Modifier.height(12.dp))

        // 5. 앱 점검
        IconCard(Icons.Filled.HelpOutline) {
            Text("앱 점검", color = TextPrimary, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(4.dp))
            Text("자동 감지가 안 될 때만 확인하는 진단 메뉴입니다.", color = TextSecondary, fontSize = 12.sp)
            Spacer(Modifier.height(8.dp))
            TroubleRow(Icons.Filled.SignalCellularAlt, "현재 감지 상태 보기", onOpenDiag)
            HorizontalDivider(color = PurpleLight, thickness = 1.dp)
            TroubleRow(Icons.Filled.VerifiedUser, "권한과 배터리 설정 확인", onOpenPermission)
        }

        Spacer(Modifier.height(20.dp))
    }
}

@Composable
private fun TroubleRow(icon: ImageVector, label: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(icon, contentDescription = null, tint = Purple, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(12.dp))
        Text(label, color = TextPrimary, fontSize = 14.sp, modifier = Modifier.weight(1f))
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = TextSecondary, modifier = Modifier.size(20.dp))
    }
}

// ════════════════════════════════════════════
// 다이얼로그
// ════════════════════════════════════════════

@Composable
private fun FloorPickerDialog(
    currentFloorIndex: Int,
    minFloorIndex: Int,
    maxFloorIndex: Int,
    onSelect: (Int) -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("주차 층 수정", fontWeight = FontWeight.Bold) },
        text = {
            Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                (minFloorIndex..maxFloorIndex).forEach { i ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onSelect(i) }
                            .padding(vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        RadioButton(selected = currentFloorIndex == i, onClick = { onSelect(i) })
                        Spacer(Modifier.width(8.dp))
                        Text(floorIndexToLabel(i), fontSize = 15.sp)
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("닫기") } }
    )
}

@Composable
private fun BtPickerDialog(
    devices: List<CarBtDevice>,
    onSelect: (CarBtDevice) -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("자동차 블루투스 기기 선택") },
        text = {
            if (devices.isEmpty()) {
                Text("페어링된 블루투스 기기가 없거나 권한이 없습니다.\n차에 폰을 블루투스로 연결한 적이 있어야 목록에 나타납니다.")
            } else {
                Column {
                    devices.forEach { d ->
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onSelect(d) }
                                .padding(vertical = 12.dp)
                        ) {
                            Text(d.name, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                            Text(d.address, fontSize = 11.sp, color = TextSecondary)
                        }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("닫기") } }
    )
}

@Composable
private fun PermissionDialog(
    hasLocation: Boolean,
    gpsEnabled: Boolean,
    onOpenSettings: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("권한 확인", fontWeight = FontWeight.Bold) },
        text = {
            Column {
                DebugRow("위치 권한", if (hasLocation) "✅ 허용" else "⛔ 없음")
                DebugRow("GPS/위치 켜짐", if (gpsEnabled) "✅ 켜짐" else "⛔ 꺼짐")
                Spacer(Modifier.height(12.dp))
                Text(
                    "자동 감지가 안 되면 앱 설정에서 위치를 '항상 허용'으로, 배터리는 '제한 없음'으로 바꿔주세요.",
                    fontSize = 12.sp, color = TextSecondary
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onOpenSettings(); onDismiss() }) { Text("앱 설정 열기") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("닫기") } }
    )
}

@Composable
private fun DiagnosticsDialog(
    viewModel: MainViewModel,
    context: android.content.Context,
    distance: Float?,
    inside: Boolean?,
    track: com.parkingfloor.app.service.ParkingTrackingService.TrackDebug?,
    currentLatLng: Pair<Double, Double>?,
    isTracking: Boolean,
    autoStartEnabled: Boolean,
    trackingStatus: String,
    lastParked: ParkedResult,
    pressure: Float,
    baseline: Float?,
    hPaPerFloor: Float,
    entryCorrection: Float,
    floorSamples: Map<Int, Float>,
    garageBelow: Int,
    plateauSeconds: Int,
    floorIndex: Int?,
    onDismiss: () -> Unit
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = true
        )
    ) {
        Surface(modifier = Modifier.fillMaxSize().systemBarsPadding(), color = BgColor) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(20.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("감지 상태 확인", color = TextPrimary, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
                    TextButton(onClick = onDismiss) { Text("닫기", color = Purple) }
                }
                Spacer(Modifier.height(12.dp))
                DiagnosticsContent(
                    viewModel = viewModel,
                    context = context,
                    distance = distance,
                    inside = inside,
                    track = track,
                    currentLatLng = currentLatLng,
                    isTracking = isTracking,
                    autoStartEnabled = autoStartEnabled,
                    trackingStatus = trackingStatus,
                    lastParked = lastParked,
                    pressure = pressure,
                    baseline = baseline,
                    hPaPerFloor = hPaPerFloor,
                    entryCorrection = entryCorrection,
                    floorSamples = floorSamples,
                    garageBelow = garageBelow,
                    plateauSeconds = plateauSeconds,
                    floorIndex = floorIndex
                )
                Spacer(Modifier.height(72.dp))
            }
        }
    }
}

// ════════════════════════════════════════════
// 진단 내용
// ════════════════════════════════════════════

@Composable
private fun DiagnosticsContent(
    viewModel: MainViewModel,
    context: android.content.Context,
    distance: Float?,
    inside: Boolean?,
    track: com.parkingfloor.app.service.ParkingTrackingService.TrackDebug?,
    currentLatLng: Pair<Double, Double>?,
    isTracking: Boolean,
    autoStartEnabled: Boolean,
    trackingStatus: String,
    lastParked: ParkedResult,
    pressure: Float,
    baseline: Float?,
    hPaPerFloor: Float,
    entryCorrection: Float,
    floorSamples: Map<Int, Float>,
    garageBelow: Int,
    plateauSeconds: Int,
    floorIndex: Int?
) {
    DebugCard(
        distance = distance,
        inside = inside,
        track = track,
        hasLocationPermission = viewModel.hasLocationPermission(),
        gpsEnabled = viewModel.isGpsEnabled(),
        latLng = currentLatLng,
        onRefreshLocation = {
            viewModel.startLocationDebug()
            viewModel.requestFreshFix()
            Toast.makeText(context, "위치 새로고침 시도 중...", Toast.LENGTH_SHORT).show()
        }
    )

    Spacer(Modifier.height(12.dp))

    AutoTrackingCard(
        isTracking = isTracking,
        autoEnabled = autoStartEnabled,
        status = trackingStatus,
        lastParked = lastParked,
        onStart = { viewModel.startTracking() },
        onStop = { viewModel.stopTracking() },
        onClear = { viewModel.clearParked() }
    )

    Spacer(Modifier.height(12.dp))

    DiagnosticSection(
        icon = Icons.Filled.Speed,
        title = "실시간 추정",
        subtitle = "현재 센서값으로 계산한 층입니다."
    ) {
        val displayFloor = track?.floor ?: floorIndex
        Text(
            displayFloor?.let { floorIndexToLabel(it) } ?: "기준점 미설정",
            fontSize = 28.sp, fontWeight = FontWeight.ExtraBold, color = Purple
        )
        Spacer(Modifier.height(10.dp))
        DebugRow("현재 기압", if (pressure.isNaN()) "측정 중" else "%.2f hPa".format(pressure))
        val activeBaseline = track?.baseline ?: baseline
        val tableBaseline = activeBaseline ?: if (!pressure.isNaN()) pressure + entryCorrection else null
        DebugRow("기준(P0)", activeBaseline?.let { "%.2f hPa".format(it) } ?: "미설정")
        DebugRow("진입 보정", "%+.2f hPa".format(entryCorrection))
        activeBaseline?.let { b ->
            if (!pressure.isNaN()) DebugRow("상승폭", "%+.2f hPa".format(pressure - b))
        }
        if (tableBaseline != null) {
            Spacer(Modifier.height(12.dp))
            FloorPressureTable(
                baseline = tableBaseline,
                currentPressure = pressure,
                hPaPerFloor = hPaPerFloor,
                floorSamples = floorSamples,
                garageBelow = garageBelow,
                onRecord = { viewModel.recordFloorPressure(it) }
            )
        }
    }

    Spacer(Modifier.height(12.dp))

    DiagnosticSection(
        icon = Icons.Filled.Settings,
        title = "층당 기압차",
        subtitle = "실제 층과 다르면 이 값을 조금씩 조정하세요."
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("보정값", color = TextSecondary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Text("%.2f hPa / 층".format(hPaPerFloor), fontSize = 20.sp, color = Purple, fontWeight = FontWeight.ExtraBold)
        }
        Spacer(Modifier.height(10.dp))
        Slider(
            value = hPaPerFloor,
            onValueChange = { viewModel.updateHPaPerFloor(it) },
            valueRange = 0.15f..1.00f,
            colors = SliderDefaults.colors(
                thumbColor = Purple,
                activeTrackColor = Purple,
                inactiveTrackColor = PurpleLight,
                activeTickColor = Color.Transparent,
                inactiveTickColor = Color.Transparent
            )
        )
        Spacer(Modifier.height(16.dp))
        HorizontalDivider(color = PurpleLight, thickness = 1.dp)
        Spacer(Modifier.height(12.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("주차장 진입 보정", color = TextSecondary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Text("%+.2f hPa".format(entryCorrection), fontSize = 20.sp, color = Purple, fontWeight = FontWeight.ExtraBold)
        }
        Spacer(Modifier.height(10.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            OutlinedButton(
                onClick = { viewModel.updateEntryPressureCorrection(entryCorrection - 0.05f) },
                modifier = Modifier.weight(1f).height(44.dp),
                shape = RoundedCornerShape(12.dp),
                border = BorderStroke(1.5.dp, Purple)
            ) {
                Text("- 0.05", color = Purple, fontWeight = FontWeight.Bold)
            }
            Button(
                onClick = { viewModel.updateEntryPressureCorrection(0f) },
                modifier = Modifier.height(44.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = PurpleLight),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp, vertical = 8.dp)
            ) {
                Text("0", color = Purple, fontWeight = FontWeight.Bold)
            }
            OutlinedButton(
                onClick = { viewModel.updateEntryPressureCorrection(entryCorrection + 0.05f) },
                modifier = Modifier.weight(1f).height(44.dp),
                shape = RoundedCornerShape(12.dp),
                border = BorderStroke(1.5.dp, Purple)
            ) {
                Text("+ 0.05", color = Purple, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun FloorPressureTable(
    baseline: Float,
    currentPressure: Float,
    hPaPerFloor: Float,
    floorSamples: Map<Int, Float>,
    garageBelow: Int,
    onRecord: (Int) -> Unit
) {
    Column {
        Text("층별 기압 기록", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = TextPrimary)
        Spacer(Modifier.height(8.dp))
        val rows = (0..garageBelow.coerceIn(1, CalibrationStore.MAX_GARAGE_FLOORS)).toList()
        rows.forEach { floor ->
            val corrected = baseline + floor * hPaPerFloor
            val actual = floorSamples[floor]
            FloorPressureRow(
                label = if (floor == 0) "지상 1층" else "지하 ${floor}층",
                correctedPressure = corrected,
                actualPressure = actual,
                currentPressure = currentPressure,
                onRecord = { onRecord(floor) }
            )
            if (floor != rows.last()) HorizontalDivider(color = PurpleLight.copy(alpha = 0.8f), thickness = 1.dp)
        }
    }
}

@Composable
private fun FloorPressureRow(
    label: String,
    correctedPressure: Float,
    actualPressure: Float?,
    currentPressure: Float,
    onRecord: () -> Unit
) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 9.dp)) {
        Text(label, fontSize = 13.sp, color = TextPrimary, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(6.dp))
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.weight(1f)) {
                Text("보정기압 %.2f hPa".format(correctedPressure), fontSize = 12.sp, color = TextSecondary)
                Text(
                    actualPressure?.let {
                        "실제기압 %.2f hPa · 차이 %+.2f".format(it, it - correctedPressure)
                    } ?: "실제기압 미기록",
                    fontSize = 12.sp,
                    color = if (actualPressure != null && abs(actualPressure - correctedPressure) >= 0.10f) OrangeColor else TextSecondary,
                    fontWeight = if (actualPressure != null) FontWeight.SemiBold else FontWeight.Normal
                )
            }
            Spacer(Modifier.width(8.dp))
            OutlinedButton(
                onClick = onRecord,
                enabled = !currentPressure.isNaN(),
                shape = RoundedCornerShape(10.dp),
                border = BorderStroke(1.dp, Purple),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 6.dp)
            ) {
                Text("기록", color = Purple, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun DiagnosticSection(
    icon: ImageVector,
    title: String,
    subtitle: String? = null,
    content: @Composable ColumnScope.() -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(2.dp)
    ) {
        Row(
            modifier = Modifier.padding(20.dp),
            verticalAlignment = Alignment.Top
        ) {
            IconCircle(icon, size = 48.dp, iconSize = 24.dp)
            Spacer(Modifier.width(14.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(title, color = TextPrimary, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                if (subtitle != null) {
                    Spacer(Modifier.height(4.dp))
                    Text(subtitle, color = TextSecondary, fontSize = 12.sp)
                }
                Spacer(Modifier.height(14.dp))
                content()
            }
        }
    }
}

@Composable
private fun AutoTrackingCard(
    isTracking: Boolean,
    autoEnabled: Boolean,
    status: String,
    lastParked: ParkedResult,
    onStart: () -> Unit,
    onStop: () -> Unit,
    onClear: () -> Unit
) {
    DiagnosticSection(
        icon = Icons.Filled.DirectionsCar,
        title = "수동 추적",
        subtitle = "실제 주차장 테스트 때 즉시 감지를 켜고 끌 수 있습니다."
    ) {
        val stateText = when {
            isTracking -> status.ifBlank { "추적 중..." }
            autoEnabled -> "자동 감지 대기 중"
            else -> "수동으로 시작할 수 있습니다."
        }
        Text(stateText, fontSize = 13.sp, color = if (isTracking) Purple else TextSecondary, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(12.dp))
        if (isTracking) {
            OutlinedButton(
                onClick = onStop,
                modifier = Modifier.fillMaxWidth().height(48.dp),
                shape = RoundedCornerShape(12.dp),
                border = BorderStroke(1.5.dp, Purple)
            ) { Text("추적 중지", color = Purple, fontWeight = FontWeight.Bold) }
        } else {
            Button(
                onClick = onStart,
                modifier = Modifier.fillMaxWidth().height(48.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Purple)
            ) { Text("지금 수동 시작", fontWeight = FontWeight.Bold) }
        }
        if (lastParked.hasResult && !isTracking) {
            Spacer(Modifier.height(8.dp))
            OutlinedButton(
                onClick = onClear,
                modifier = Modifier.fillMaxWidth().height(46.dp),
                shape = RoundedCornerShape(12.dp),
                border = BorderStroke(1.5.dp, Purple)
            ) { Text("기록 지우기", color = Purple, fontWeight = FontWeight.Bold) }
        }
    }
}

@Composable
private fun DebugCard(
    distance: Float?,
    inside: Boolean?,
    track: com.parkingfloor.app.service.ParkingTrackingService.TrackDebug?,
    hasLocationPermission: Boolean,
    gpsEnabled: Boolean,
    latLng: Pair<Double, Double>?,
    onRefreshLocation: () -> Unit
) {
    DiagnosticSection(
        icon = Icons.Filled.LocationOn,
        title = "위치 및 거리",
        subtitle = "우리집 반경 안에 들어왔는지 확인합니다."
    ) {
        DebugRow("위치 권한", if (hasLocationPermission) "허용" else "없음")
        DebugRow("GPS/위치", if (gpsEnabled) "켜짐" else "꺼짐")
        DebugRow("현재 좌표", latLng?.let { "%.5f, %.5f".format(it.first, it.second) } ?: "측정 중...")

        Spacer(Modifier.height(12.dp))
        Text("우리집까지 거리", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = TextPrimary)
        Text(
            when {
                !hasLocationPermission -> "위치 권한 필요"
                distance == null       -> "측정 중..."
                distance < 1000        -> "%.0f m".format(distance)
                else                   -> "%.1f km".format(distance / 1000f)
            },
            fontSize = 24.sp, fontWeight = FontWeight.ExtraBold, color = Purple
        )
        Text(
            when (inside) {
                true  -> "우리집 반경 안입니다."
                false -> "아직 반경 밖입니다."
                null  -> "집 위치 또는 현재 위치를 확인 중입니다."
            },
            fontSize = 12.sp, color = TextSecondary
        )
        Spacer(Modifier.height(12.dp))
        OutlinedButton(
            onClick = onRefreshLocation,
            modifier = Modifier.fillMaxWidth().height(46.dp),
            shape = RoundedCornerShape(12.dp),
            border = BorderStroke(1.5.dp, Purple)
        ) { Text("위치 새로고침", color = Purple, fontWeight = FontWeight.Bold) }

        if (track != null) {
            Spacer(Modifier.height(16.dp))
            HorizontalDivider(color = PurpleLight, thickness = 1.dp)
            Spacer(Modifier.height(12.dp))
            Text("주차 감지 신호", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = TextPrimary)
            Spacer(Modifier.height(6.dp))
            DebugRow("현재 기압", "%.2f hPa".format(track.current))
            DebugRow("기준(P0)", "%.2f hPa".format(track.baseline))
            DebugRow("상승폭 / 최대", "%+.2f / %+.2f hPa".format(track.rise, track.maxRise))
            DebugRow("추정 층", floorIndexToLabel(track.floor))
            DebugRow("내려옴", yn(track.descended))
            DebugRow("블루투스 끊김", yn(track.btRecent))
            Spacer(Modifier.height(8.dp))
            Text(track.reason, fontSize = 12.sp, color = Purple, fontWeight = FontWeight.Bold)
        }
    }
}

private fun yn(b: Boolean): String = if (b) "예" else "아니오"

@Composable
private fun DebugRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, fontSize = 12.sp, color = TextSecondary)
        Spacer(Modifier.width(12.dp))
        Text(value, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = TextPrimary)
    }
}

@Composable
private fun rememberFloorIndex(
    pressure: Float,
    baseline: Float?,
    hPaPerFloor: Float,
    viewModel: MainViewModel
): Int? {
    return remember(pressure, baseline, hPaPerFloor) {
        viewModel.estimatedFloorIndex()
    }
}

@Composable
private fun ErrorCard(message: String) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White)
    ) {
        Text(message, modifier = Modifier.padding(20.dp), color = Color.Red)
    }
}


