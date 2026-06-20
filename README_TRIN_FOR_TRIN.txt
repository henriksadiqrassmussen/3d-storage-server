3D Storage Website v0.4.1 ROOT FIXED

PROBLEM DEN RETTER:
Hvis www.3d-storage.org viser:
3D Storage Server
Version 0.3.3
Health: /health

så rammer domænet API-serveren, men serverens / viser ikke hjemmesiden.
Denne version retter / til at vise public/index.html.

RAILWAY:
1. Upload/deploy hele denne mappe som din Railway-service.
2. Sørg for at package.json ligger i roden.
3. Railway Variables:
   OWNER_EMAIL=vault1973@gmail.com
   STORAGE_DRIVER=local
4. Redeploy.
5. Test:
   https://www.3d-storage.org/health
   skal vise version 0.4.1
6. Åbn:
   https://www.3d-storage.org
   skal vise den flotte hjemmeside.

DOWNLOAD-FILER:
Læg disse filer i public/downloads:
- 3d-storage-android.apk
- 3D_Storage_PC_Companion.zip

LOKAL TEST:
1. Kør npm install
2. Kør npm start
3. Åbn http://localhost:8080
