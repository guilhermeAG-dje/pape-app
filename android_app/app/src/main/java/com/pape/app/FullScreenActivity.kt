package com.pape.app

import android.os.Bundle
import android.widget.Button
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.squareup.picasso.Picasso

class FullScreenActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_fullscreen)

        val titleText = findViewById<TextView>(R.id.reminderTitle)
        val messageText = findViewById<TextView>(R.id.reminderMessage)
        val pillImage = findViewById<ImageView>(R.id.pillImage)
        val confirmButton = findViewById<Button>(R.id.confirmButton)
        val snoozeButton = findViewById<Button>(R.id.snoozeButton)

        titleText.text = intent.getStringExtra("title") ?: "Hora de medicação"
        messageText.text = intent.getStringExtra("body") ?: "Confirme a toma ou adie." 

        val imageUrl = intent.getStringExtra("image_url")
        if (!imageUrl.isNullOrEmpty()) {
            Picasso.get().load(imageUrl).into(pillImage)
        }

        confirmButton.setOnClickListener {
            finish()
        }
        snoozeButton.setOnClickListener {
            finish()
        }
    }
}
