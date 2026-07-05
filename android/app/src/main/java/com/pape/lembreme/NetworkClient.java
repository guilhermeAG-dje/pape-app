package com.pape.lembreme;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;

final class NetworkClient {
    private NetworkClient() {}

    static List<MedicationAlarm> fetchTodayAlarms() throws Exception {
        HttpURLConnection conn = openConnection(AppConfig.BASE_URL + "api/schedule/today", "GET");
        int status = conn.getResponseCode();
        if (status < 200 || status >= 300) return new ArrayList<>();

        String body = readAll(conn.getInputStream());
        JSONObject root = new JSONObject(body);
        JSONArray items = root.optJSONArray("items");
        List<MedicationAlarm> alarms = new ArrayList<>();
        if (items == null) return alarms;

        long now = System.currentTimeMillis();
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null) continue;
            if ("taken".equalsIgnoreCase(item.optString("status"))) continue;

            String time = item.optString("time_hhmm", item.optString("scheduled_time_hhmm", ""));
            long triggerAt = triggerForToday(time);
            if (triggerAt < now - 60_000L) continue;

            alarms.add(new MedicationAlarm(
                    item.optInt("reminder_id", item.optInt("id", 0)),
                    triggerAt,
                    time,
                    item.optString("patient_name", "Utente"),
                    item.optString("medicine_name", "Medicamento"),
                    item.optString("dose", ""),
                    absoluteUrl(item.optString("pill_image_url", ""))
            ));
        }
        return alarms;
    }

    static boolean confirm(int reminderId, String scheduledTime) {
        try {
            HttpURLConnection conn = openConnection(
                    AppConfig.BASE_URL + "api/reminders/" + reminderId + "/confirm",
                    "POST"
            );
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setDoOutput(true);
            String json = "{\"scheduled_time_hhmm\":\"" + escapeJson(scheduledTime == null ? "" : scheduledTime) + "\"}";
            try (OutputStream out = conn.getOutputStream()) {
                out.write(json.getBytes());
            }
            int status = conn.getResponseCode();
            return status >= 200 && status < 300;
        } catch (Exception ignored) {
            return false;
        }
    }

    static Bitmap fetchBitmap(String imageUrl) {
        if (imageUrl == null || imageUrl.trim().isEmpty()) return null;
        try {
            HttpURLConnection conn = openConnection(imageUrl, "GET");
            if (conn.getResponseCode() < 200 || conn.getResponseCode() >= 300) return null;
            try (BufferedInputStream in = new BufferedInputStream(conn.getInputStream())) {
                return BitmapFactory.decodeStream(in);
            }
        } catch (Exception ignored) {
            return null;
        }
    }

    private static HttpURLConnection openConnection(String rawUrl, String method) throws Exception {
        URL url = new URL(rawUrl);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod(method);
        conn.setConnectTimeout(12000);
        conn.setReadTimeout(12000);
        conn.setRequestProperty("Accept", "application/json");
        String cookie = CookieManager.getInstance().getCookie(AppConfig.BASE_URL);
        if (cookie != null && !cookie.trim().isEmpty()) {
            conn.setRequestProperty("Cookie", cookie);
        }
        return conn;
    }

    private static String readAll(InputStream input) throws Exception {
        try (InputStream in = input; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
            return out.toString("UTF-8");
        }
    }

    private static long triggerForToday(String hhmm) {
        try {
            String[] parts = hhmm.split(":");
            int hour = Integer.parseInt(parts[0]);
            int minute = Integer.parseInt(parts[1]);
            Calendar cal = Calendar.getInstance();
            cal.set(Calendar.HOUR_OF_DAY, hour);
            cal.set(Calendar.MINUTE, minute);
            cal.set(Calendar.SECOND, 0);
            cal.set(Calendar.MILLISECOND, 0);
            return cal.getTimeInMillis();
        } catch (Exception ignored) {
            return -1L;
        }
    }

    private static String absoluteUrl(String path) {
        if (path == null || path.trim().isEmpty()) return "";
        if (path.startsWith("http://") || path.startsWith("https://")) return path;
        if (path.startsWith("/")) return AppConfig.BASE_URL.substring(0, AppConfig.BASE_URL.length() - 1) + path;
        return AppConfig.BASE_URL + path;
    }

    private static String escapeJson(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
