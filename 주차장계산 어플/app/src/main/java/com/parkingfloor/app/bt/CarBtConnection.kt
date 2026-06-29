package com.parkingfloor.app.bt

import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.Context

/**
 * 등록된 차 BT가 "지금 실제로 연결돼 있는지"를 공식 프로파일 API(A2DP/HEADSET)로 확인한다.
 *
 * 기존엔 숨김 API `BluetoothDevice.isConnected()`(리플렉션)로 읽었는데, 최신 안드로이드에서
 * 제한/불안정해 연결돼 있어도 false를 주는 경우가 있었다(음악 재생 중인데 "연결 안 됨" 표시).
 * A2DP(음악)/HEADSET(통화) 프로파일의 connectedDevices 목록으로 보면 확실하다.
 */
class CarBtConnection(context: Context) {

    private val appCtx = context.applicationContext

    @Volatile private var a2dp: BluetoothProfile? = null
    @Volatile private var headset: BluetoothProfile? = null

    private val adapter
        get() = (appCtx.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    private val listener = object : BluetoothProfile.ServiceListener {
        override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) {
            when (profile) {
                BluetoothProfile.A2DP -> a2dp = proxy
                BluetoothProfile.HEADSET -> headset = proxy
            }
        }
        override fun onServiceDisconnected(profile: Int) {
            when (profile) {
                BluetoothProfile.A2DP -> a2dp = null
                BluetoothProfile.HEADSET -> headset = null
            }
        }
    }

    fun start() {
        runCatching {
            val ad = adapter ?: return
            if (a2dp == null) ad.getProfileProxy(appCtx, listener, BluetoothProfile.A2DP)
            if (headset == null) ad.getProfileProxy(appCtx, listener, BluetoothProfile.HEADSET)
        }
    }

    fun stop() {
        val ad = adapter
        runCatching { a2dp?.let { ad?.closeProfileProxy(BluetoothProfile.A2DP, it) } }
        runCatching { headset?.let { ad?.closeProfileProxy(BluetoothProfile.HEADSET, it) } }
        a2dp = null
        headset = null
    }

    /** 등록 주소가 현재 연결돼 있는지. 프록시 준비 전/권한 없음이면 null(불명). */
    @SuppressLint("MissingPermission")
    fun isConnected(address: String?): Boolean? {
        if (address.isNullOrBlank()) return null
        val a = a2dp
        val h = headset
        if (a == null && h == null) return null
        return runCatching {
            val inA2dp = a?.connectedDevices?.any { it.address == address } ?: false
            val inHeadset = h?.connectedDevices?.any { it.address == address } ?: false
            inA2dp || inHeadset
        }.getOrNull()
    }
}
