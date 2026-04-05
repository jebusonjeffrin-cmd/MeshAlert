package com.meshalert

import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.util.Base64
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

class ServiceModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx) {

    override fun getName(): String = "ServiceModule"

    // ── Foreground Service ───────────────────────────────────────────────────────

    @ReactMethod
    fun startService() {
        Log.d("ServiceModule", "startService called from JS")
        val intent = Intent(ctx, MeshForegroundService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(intent)
        } else {
            ctx.startService(intent)
        }
    }

    @ReactMethod
    fun stopService() {
        Log.d("ServiceModule", "stopService called from JS")
        ctx.stopService(Intent(ctx, MeshForegroundService::class.java))
    }

    // ── Battery Optimization Exemption ──────────────────────────────────────────

    // ── Base64 file helper (for audio playback without RNFS) ────────────────────

    @ReactMethod
    fun writeBase64ToTempFile(base64Data: String, extension: String, promise: Promise) {
        try {
            val bytes = Base64.decode(base64Data, Base64.DEFAULT)
            val file = File(ctx.cacheDir, "voice_${System.currentTimeMillis()}.$extension")
            file.writeBytes(bytes)
            promise.resolve(file.absolutePath)
        } catch (e: Exception) {
            promise.reject("WRITE_ERROR", e.message)
        }
    }

    // ── Battery Optimization Exemption ──────────────────────────────────────────

    @ReactMethod
    fun requestBatteryExemption() {
        val pm = ctx.getSystemService(PowerManager::class.java) ?: return
        val pkg = ctx.packageName
        if (pm.isIgnoringBatteryOptimizations(pkg)) {
            Log.d("ServiceModule", "Already ignoring battery optimizations")
            return
        }
        Log.d("ServiceModule", "Requesting battery optimization exemption")
        val intent = Intent(
            android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            android.net.Uri.parse("package:$pkg")
        ).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            ctx.startActivity(intent)
        } catch (e: Exception) {
            Log.w("ServiceModule", "Could not open battery settings: ${e.message}")
        }
    }
}
