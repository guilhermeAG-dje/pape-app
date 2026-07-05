package com.pape.lembreme;

import android.app.Activity;
import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

public class AlarmActivity extends Activity {
    private Intent alarmIntent;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        alarmIntent = getIntent();
        prepareWindow();
        buildUi();
        dismissNotification();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        alarmIntent = intent;
        buildUi();
        dismissNotification();
    }

    private void prepareWindow() {
        Window window = getWindow();
        window.addFlags(
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                        | WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON
                        | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                        | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        );

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null) {
                km.requestDismissKeyguard(this, null);
            }
        }
    }

    private void buildUi() {
        String patient = value(AppConfig.EXTRA_PATIENT, "Utente");
        String medicine = value(AppConfig.EXTRA_MEDICINE, "Medicamento");
        String dose = value(AppConfig.EXTRA_DOSE, "");
        String time = value(AppConfig.EXTRA_TIME, "");
        String imageUrl = value(AppConfig.EXTRA_IMAGE, "");

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(dp(24), dp(28), dp(24), dp(28));
        root.setBackgroundColor(Color.rgb(12, 18, 24));

        TextView label = text("Alarme de medicação", 16, Color.rgb(200, 230, 224), true);
        TextView timeView = text(time, 64, Color.WHITE, true);
        TextView medView = text(medicine, 30, Color.WHITE, true);
        TextView detailView = text(compact(patient, dose), 18, Color.rgb(221, 226, 232), false);

        ImageView image = new ImageView(this);
        image.setAdjustViewBounds(true);
        image.setScaleType(ImageView.ScaleType.CENTER_CROP);
        LinearLayout.LayoutParams imageParams = new LinearLayout.LayoutParams(dp(240), dp(240));
        imageParams.setMargins(0, dp(22), 0, dp(18));
        image.setLayoutParams(imageParams);
        image.setBackgroundColor(Color.rgb(25, 33, 41));

        ProgressBar loader = new ProgressBar(this);
        LinearLayout.LayoutParams loaderParams = new LinearLayout.LayoutParams(dp(48), dp(48));
        loaderParams.setMargins(0, dp(22), 0, dp(18));
        loader.setLayoutParams(loaderParams);

        Button confirm = button("Foi tomado", Color.rgb(255, 112, 43), Color.WHITE);
        Button snooze = button("Adiar 5 min", Color.rgb(62, 68, 76), Color.WHITE);

        root.addView(label);
        root.addView(timeView);
        root.addView(medView);
        root.addView(detailView);
        root.addView(loader);
        root.addView(image);
        root.addView(confirm);
        root.addView(snooze);
        image.setVisibility(ImageView.GONE);

        setContentView(root);

        confirm.setOnClickListener(v -> confirmTaken());
        snooze.setOnClickListener(v -> snooze());

        new Thread(() -> {
            Bitmap bitmap = NetworkClient.fetchBitmap(imageUrl);
            runOnUiThread(() -> {
                loader.setVisibility(ProgressBar.GONE);
                if (bitmap != null) {
                    image.setImageBitmap(bitmap);
                    image.setVisibility(ImageView.VISIBLE);
                }
            });
        }, "pape-load-pill-image").start();
    }

    private void confirmTaken() {
        int reminderId = alarmIntent.getIntExtra(AppConfig.EXTRA_REMINDER_ID, 0);
        String time = alarmIntent.getStringExtra(AppConfig.EXTRA_TIME);
        Toast.makeText(this, "A confirmar toma...", Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            boolean ok = NetworkClient.confirm(reminderId, time);
            runOnUiThread(() -> {
                Toast.makeText(this, ok ? "Toma confirmada." : "Não foi possível confirmar.", Toast.LENGTH_LONG).show();
                if (ok) {
                    AlarmScheduler.scheduleToday(this);
                    finish();
                }
            });
        }, "pape-confirm-alarm").start();
    }

    private void snooze() {
        AlarmScheduler.scheduleSnooze(this, alarmIntent);
        Toast.makeText(this, "Adiado 5 minutos.", Toast.LENGTH_SHORT).show();
        finish();
    }

    private void dismissNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null && alarmIntent != null) {
            nm.cancel(AlarmScheduler.notificationId(alarmIntent));
        }
    }

    private TextView text(String value, int sp, int color, boolean bold) {
        TextView tv = new TextView(this);
        tv.setText(value == null ? "" : value);
        tv.setTextSize(sp);
        tv.setTextColor(color);
        tv.setGravity(Gravity.CENTER);
        tv.setIncludeFontPadding(true);
        if (bold) tv.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        return tv;
    }

    private Button button(String label, int bg, int fg) {
        Button btn = new Button(this);
        btn.setText(label);
        btn.setTextSize(18);
        btn.setTextColor(fg);
        btn.setBackgroundColor(bg);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(58)
        );
        params.setMargins(0, dp(8), 0, 0);
        btn.setLayoutParams(params);
        return btn;
    }

    private String value(String key, String fallback) {
        String value = alarmIntent == null ? null : alarmIntent.getStringExtra(key);
        return value == null || value.trim().isEmpty() ? fallback : value;
    }

    private String compact(String a, String b) {
        if (a == null || a.trim().isEmpty()) return b == null ? "" : b;
        if (b == null || b.trim().isEmpty()) return a;
        return a + " - " + b;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
