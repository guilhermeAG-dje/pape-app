package com.pape.lembreme;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.PowerManager;

public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        PowerManager.WakeLock wakeLock = null;
        try {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(
                        PowerManager.PARTIAL_WAKE_LOCK,
                        "PAPE:MedicationAlarm"
                );
                wakeLock.acquire(30_000L);
            }

            showAlarmNotification(context, intent);
        } finally {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        }
    }

    private void showAlarmNotification(Context context, Intent source) {
        createChannel(context);

        Intent activityIntent = AlarmScheduler.buildAlarmActivityIntent(context, source);
        PendingIntent fullScreenIntent = PendingIntent.getActivity(
                context,
                AlarmScheduler.notificationId(source),
                activityIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        PendingIntent confirmIntent = PendingIntent.getBroadcast(
                context,
                AlarmScheduler.notificationId(source) + 1,
                actionIntent(context, source, AppConfig.ACTION_CONFIRM),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        PendingIntent snoozeIntent = PendingIntent.getBroadcast(
                context,
                AlarmScheduler.notificationId(source) + 2,
                actionIntent(context, source, AppConfig.ACTION_SNOOZE),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String medicine = source.getStringExtra(AppConfig.EXTRA_MEDICINE);
        String dose = source.getStringExtra(AppConfig.EXTRA_DOSE);
        String time = source.getStringExtra(AppConfig.EXTRA_TIME);
        String body = compact(source.getStringExtra(AppConfig.EXTRA_PATIENT), dose, time);

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(context, AppConfig.CHANNEL_ID)
                : new Notification.Builder(context);

        builder
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle("Hora de tomar " + (medicine == null ? "medicação" : medicine))
                .setContentText(body)
                .setCategory(Notification.CATEGORY_ALARM)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setFullScreenIntent(fullScreenIntent, true)
                .setContentIntent(fullScreenIntent);

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            builder.setPriority(Notification.PRIORITY_MAX);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            builder.addAction(new Notification.Action.Builder(
                    android.graphics.drawable.Icon.createWithResource(context, android.R.drawable.checkbox_on_background),
                    "Foi tomado",
                    confirmIntent
            ).build());
            builder.addAction(new Notification.Action.Builder(
                    android.graphics.drawable.Icon.createWithResource(context, android.R.drawable.ic_menu_recent_history),
                    "Adiar 5 min",
                    snoozeIntent
            ).build());
        } else {
            builder.addAction(android.R.drawable.checkbox_on_background, "Foi tomado", confirmIntent);
            builder.addAction(android.R.drawable.ic_menu_recent_history, "Adiar 5 min", snoozeIntent);
        }

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(AlarmScheduler.notificationId(source), builder.build());
        }
    }

    private Intent actionIntent(Context context, Intent source, String action) {
        Intent intent = new Intent(context, AlarmActionReceiver.class);
        intent.setAction(action);
        AlarmScheduler.copyAlarmExtras(source, intent);
        return intent;
    }

    private void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(AppConfig.CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(
                AppConfig.CHANNEL_ID,
                "Alarmes de medicação",
                NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Alarmes urgentes do PAPE com ecrã completo.");
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] { 400, 160, 400, 160, 800 });
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        channel.enableLights(true);
        channel.setLightColor(Color.rgb(15, 118, 110));
        nm.createNotificationChannel(channel);
    }

    private String compact(String patient, String dose, String time) {
        StringBuilder sb = new StringBuilder();
        append(sb, patient);
        append(sb, dose);
        append(sb, time);
        return sb.toString();
    }

    private void append(StringBuilder sb, String value) {
        if (value == null || value.trim().isEmpty()) return;
        if (sb.length() > 0) sb.append(" - ");
        sb.append(value.trim());
    }
}
