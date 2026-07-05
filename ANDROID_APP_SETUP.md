# PAPE no Android

Este projeto agora tem duas camadas:

- a app web Flask/PWA, publicada no Render;
- uma app Android nativa em `android/`, criada para alarmes de medicação mais fortes.

## O que a app Android faz

- Abre o PAPE publicado em `https://pape-app.onrender.com/` dentro de uma WebView.
- Reutiliza a sessão/cookies da WebView para buscar `/api/schedule/today`.
- Agenda alarmes nativos com `AlarmManager`.
- Mostra uma tela fullscreen com:
  - hora da toma;
  - nome do medicamento;
  - dose/utente;
  - imagem do medicamento, quando existir;
  - botão `Foi tomado`;
  - botão `Adiar 5 min`.
- Ao tocar em `Foi tomado`, chama a API do PAPE para confirmar a toma.

## APK gerado

O APK debug fica em:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## Permissões importantes no telemóvel

Depois de instalar, abre a app uma vez e permite:

- Notificações;
- Alarmes e lembretes / alarmes exatos;
- Mostrar no ecrã bloqueado, se o Android pedir.

Em alguns telemóveis também convém desativar a otimização de bateria para esta app, porque fabricantes como Xiaomi, Samsung, Oppo e Huawei podem atrasar alarmes em segundo plano.

## Limite importante

Se o telemóvel estiver totalmente desligado, nenhuma app Android normal consegue tocar.  
Se o ecrã estiver bloqueado/apagado, ou se estiveres noutra app, a app Android nativa foi preparada para aparecer como alarme fullscreen.

## Como compilar nesta máquina

Nesta máquina usei o Android SDK local e Gradle descarregado em `.tools/`.

```powershell
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-21.0.3.9-hotspot'
$env:PATH="$env:JAVA_HOME\bin;$env:PATH"
.\.tools\gradle-8.14.3\bin\gradle.bat -p android assembleDebug
```

Também podes abrir a pasta `android/` no Android Studio e carregar em Run.
