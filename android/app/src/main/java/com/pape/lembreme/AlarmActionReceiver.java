package com.pape.lembreme;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class AlarmActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                if (AppConfig.ACTION_CONFIRM.equals(intent.getAction())) {
                    int reminderId = intent.getIntExtra(AppConfig.EXTRA_REMINDER_ID, 0);
                    String time = intent.getStringExtra(AppConfig.EXTRA_TIME);
                    NetworkClient.confirm(reminderId, time);
                    dismiss(context, intent);
                    AlarmScheduler.scheduleToday(context);
                } else if (AppConfig.ACTION_SNOOZE.equals(intent.getAction())) {
                    AlarmScheduler.scheduleSnooze(context, intent);
                    dismiss(context, intent);
                }
            } finally {
                pending.finish();
            }
        }, "pape-alarm-action").start();
    }

    private void dismiss(Context context, Intent intent) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.cancel(AlarmScheduler.notificationId(intent));
        }
    }
}
