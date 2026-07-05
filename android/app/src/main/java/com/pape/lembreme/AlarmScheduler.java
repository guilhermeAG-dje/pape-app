package com.pape.lembreme;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import java.util.Calendar;
import java.util.List;

final class AlarmScheduler {
    private AlarmScheduler() {}

    static void scheduleToday(Context context) {
        Context appContext = context.getApplicationContext();
        new Thread(() -> {
            try {
                List<MedicationAlarm> alarms = NetworkClient.fetchTodayAlarms();
                for (MedicationAlarm alarm : alarms) {
                    schedule(appContext, alarm);
                }
            } catch (Exception ignored) {
                // If the user is offline or not logged in yet, the WebView can still be used normally.
            }
        }, "pape-schedule-today").start();
    }

    static void scheduleSnooze(Context context, Intent sourceIntent) {
        Calendar cal = Calendar.getInstance();
        cal.add(Calendar.MINUTE, AppConfig.SNOOZE_MINUTES);
        MedicationAlarm alarm = new MedicationAlarm(
                sourceIntent.getIntExtra(AppConfig.EXTRA_REMINDER_ID, 0),
                cal.getTimeInMillis(),
                sourceIntent.getStringExtra(AppConfig.EXTRA_TIME),
                sourceIntent.getStringExtra(AppConfig.EXTRA_PATIENT),
                sourceIntent.getStringExtra(AppConfig.EXTRA_MEDICINE),
                sourceIntent.getStringExtra(AppConfig.EXTRA_DOSE),
                sourceIntent.getStringExtra(AppConfig.EXTRA_IMAGE)
        );
        schedule(context.getApplicationContext(), alarm);
    }

    private static void schedule(Context context, MedicationAlarm alarm) {
        if (alarm.reminderId <= 0 || alarm.triggerAtMillis <= 0) return;

        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;

        PendingIntent pi = PendingIntent.getBroadcast(
                context,
                requestCode(alarm),
                buildAlarmIntent(context, alarm),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmManager.canScheduleExactAlarms()) {
            PendingIntent showIntent = PendingIntent.getActivity(
                    context,
                    requestCode(alarm) + 100000,
                    new Intent(context, MainActivity.class),
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            alarmManager.setAlarmClock(new AlarmManager.AlarmClockInfo(alarm.triggerAtMillis, showIntent), pi);
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, alarm.triggerAtMillis, pi);
        } else {
            alarmManager.setExact(AlarmManager.RTC_WAKEUP, alarm.triggerAtMillis, pi);
        }
    }

    static Intent buildAlarmIntent(Context context, MedicationAlarm alarm) {
        Intent intent = new Intent(context, AlarmReceiver.class);
        intent.putExtra(AppConfig.EXTRA_REMINDER_ID, alarm.reminderId);
        intent.putExtra(AppConfig.EXTRA_TIME, alarm.time);
        intent.putExtra(AppConfig.EXTRA_PATIENT, safe(alarm.patient));
        intent.putExtra(AppConfig.EXTRA_MEDICINE, safe(alarm.medicine));
        intent.putExtra(AppConfig.EXTRA_DOSE, safe(alarm.dose));
        intent.putExtra(AppConfig.EXTRA_IMAGE, safe(alarm.imageUrl));
        return intent;
    }

    static Intent buildAlarmActivityIntent(Context context, Intent source) {
        Intent intent = new Intent(context, AlarmActivity.class);
        copyAlarmExtras(source, intent);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return intent;
    }

    static void copyAlarmExtras(Intent source, Intent target) {
        target.putExtra(AppConfig.EXTRA_REMINDER_ID, source.getIntExtra(AppConfig.EXTRA_REMINDER_ID, 0));
        target.putExtra(AppConfig.EXTRA_TIME, source.getStringExtra(AppConfig.EXTRA_TIME));
        target.putExtra(AppConfig.EXTRA_PATIENT, source.getStringExtra(AppConfig.EXTRA_PATIENT));
        target.putExtra(AppConfig.EXTRA_MEDICINE, source.getStringExtra(AppConfig.EXTRA_MEDICINE));
        target.putExtra(AppConfig.EXTRA_DOSE, source.getStringExtra(AppConfig.EXTRA_DOSE));
        target.putExtra(AppConfig.EXTRA_IMAGE, source.getStringExtra(AppConfig.EXTRA_IMAGE));
    }

    static int notificationId(Intent intent) {
        int reminderId = intent.getIntExtra(AppConfig.EXTRA_REMINDER_ID, 0);
        String time = intent.getStringExtra(AppConfig.EXTRA_TIME);
        return Math.abs((String.valueOf(reminderId) + "-" + String.valueOf(time)).hashCode());
    }

    private static int requestCode(MedicationAlarm alarm) {
        return Math.abs((String.valueOf(alarm.reminderId) + "-" + String.valueOf(alarm.time)).hashCode());
    }

    private static String safe(String value) {
        return value == null ? "" : value;
    }
}
