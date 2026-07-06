package com.pape.nativeapp

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import java.util.Calendar
import java.util.Timer
import java.util.TimerTask

class AlarmService : Service() {
    private val timer = Timer()

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val channelId = "pape_alarm_channel"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(channelId, "Pape Alarm", NotificationManager.IMPORTANCE_HIGH)
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }

        val notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("Pape")
            .setContentText("Monitorando lembretes")
            .setSmallIcon(R.drawable.ic_notification)
            .build()

        startForeground(1, notification)

        timer.scheduleAtFixedRate(object : TimerTask() {
            override fun run() {
                val now = Calendar.getInstance()
                val hhmm = String.format("%02d:%02d", now.get(Calendar.HOUR_OF_DAY), now.get(Calendar.MINUTE))
                if (hhmm == "09:00") {
                    val alarmIntent = Intent(this@AlarmService, AlarmActivity::class.java).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
                    }
                    startActivity(alarmIntent)
                }
            }
        }, 0, 1000)

        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
