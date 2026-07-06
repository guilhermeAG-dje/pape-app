Android native alert app for Pape

This project is a native Android app that can show a full-screen alarm when a reminder is due, even when the phone is locked and the app is not running.

What it does
- Uses a background service and notification channel.
- Opens a full-screen alarm activity when the reminder time arrives.
- Reads reminders from the SQLite database via the Flask app endpoint.

How to install
1. Open this folder in Android Studio.
2. Connect your phone by USB and enable USB debugging.
3. Click Run / Deploy.
4. Grant notification permission.

How to test
- Set a reminder in the Pape app for the current minute.
- Wait for the alarm to trigger.
- The app should show a full-screen alarm screen.
