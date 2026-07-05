package com.pape.lembreme;

final class AppConfig {
    static final String BASE_URL = "https://pape-app.onrender.com/";
    static final String CHANNEL_ID = "pape_medication_alarms";
    static final int SNOOZE_MINUTES = 5;

    static final String EXTRA_REMINDER_ID = "reminder_id";
    static final String EXTRA_TIME = "scheduled_time_hhmm";
    static final String EXTRA_PATIENT = "patient_name";
    static final String EXTRA_MEDICINE = "medicine_name";
    static final String EXTRA_DOSE = "dose";
    static final String EXTRA_IMAGE = "pill_image_url";

    static final String ACTION_CONFIRM = "com.pape.lembreme.CONFIRM";
    static final String ACTION_SNOOZE = "com.pape.lembreme.SNOOZE";

    private AppConfig() {}
}
