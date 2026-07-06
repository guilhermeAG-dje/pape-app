package com.pape.app

object ServerApi {
    private const val SERVER_BASE_URL = "https://pape-app.onrender.com"

    fun sendTokenToServer(token: String) {
        Thread {
            try {
                val url = java.net.URL("$SERVER_BASE_URL/api/push/android/register")
                val connection = url.openConnection() as java.net.HttpURLConnection
                connection.requestMethod = "POST"
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                val payload = "{\"token\":\"$token\"}"
                connection.outputStream.use { it.write(payload.toByteArray(Charsets.UTF_8)) }
                connection.inputStream.close()
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }.start()
    }
}
