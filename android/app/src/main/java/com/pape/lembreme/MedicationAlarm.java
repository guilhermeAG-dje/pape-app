package com.pape.lembreme;

final class MedicationAlarm {
    final int reminderId;
    final long triggerAtMillis;
    final String time;
    final String patient;
    final String medicine;
    final String dose;
    final String imageUrl;

    MedicationAlarm(int reminderId, long triggerAtMillis, String time, String patient, String medicine, String dose, String imageUrl) {
        this.reminderId = reminderId;
        this.triggerAtMillis = triggerAtMillis;
        this.time = time;
        this.patient = patient;
        this.medicine = medicine;
        this.dose = dose;
        this.imageUrl = imageUrl;
    }
}
