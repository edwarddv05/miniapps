# Downloader local

Este servicio ejecuta yt-dlp en Windows y expone el análisis y la descarga para la miniapp Downloader.

La app primero consulta `POST /analyze` para obtener el título, el canal y la duración sin descargar el archivo. Después usa `POST /download` con el formato elegido.

Cada descarga usa su propia carpeta para permitir repetir enlaces y atender solicitudes simultáneas. Audio extrae un M4A con FFmpeg y devuelve `audio/mp4` para compartirlo correctamente en iOS.

Requiere Python 3.10 o posterior. Desde esta carpeta:

```powershell
py -3.10 -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python server.py
```

La app usa `http://192.168.101.3:8787` por defecto, que es la IP local actual de este PC. Si cambia, inicia Expo con otra URL:

```powershell
$env:EXPO_PUBLIC_DOWNLOADER_API_URL="http://TU_IP_LOCAL:8787"
npx expo start
```

Si Expo Go abre la app pero Downloader no logra conectarse, permite el puerto solo dentro de la red local. Ejecuta PowerShell como administrador:

```powershell
New-NetFirewallRule -DisplayName "My SuperApp Downloader LAN 8787" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8787 -RemoteAddress "192.168.101.0/24" -Profile Public
```

Para combinar video y audio en un MP4, yt-dlp puede requerir FFmpeg instalado y accesible en el PATH. El servicio está pensado para tu red local; no lo expongas a Internet sin autenticación.
