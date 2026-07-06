Android scaffold for full-screen medication alerts

This minimal Android app demonstrates receiving FCM messages and opening
a full-screen Activity showing the pill image and action buttons.

What it does
- Registers for FCM and POSTs the token to the server at `/api/push/android/register`.
- Listens for FCM messages and, when a message arrives, posts a high-priority
  notification with a fullScreenIntent to open `FullScreenActivity`.
- `FullScreenActivity` downloads and displays the image URL passed in the intent.

How to set up
1. Create a Firebase project and add an Android app with package id `com.pape.app`.
2. Download `google-services.json` and place it at `android_app/app/google-services.json`.
3. In the Firebase Console -> Project settings -> Cloud Messaging, copy the Server key.
4. On your Render service, set the environment variable `FCM_SERVER_KEY` to that Server key.
5. Build the app in Android Studio (open `android_app` as a project). Install on a device.

Notes
- The app requests notification permission on Android 13+.
- For testing, the server sends FCM payloads when a reminder is due.
- If you change the package name, update `applicationId` in `app/build.gradle` and the `AndroidManifest.xml`.
