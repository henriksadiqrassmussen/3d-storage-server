3D Storage v0.5.0 - R2 PERMANENT STORAGE

Hvad er nyt:
- Cloudflare R2 permanent storage klar
- Local storage virker stadig til test
- OWNER_FREE til vault1973@gmail.com
- Kvote-tjek før upload
- Upload/download/slet
- Hjemmeside i public/

GitHub/Railway struktur:
package.json
server.js
railway.json
public/
  index.html
  styles.css
  app.js
  downloads/

Railway variables til test/local:
OWNER_EMAIL=vault1973@gmail.com
STORAGE_DRIVER=local

Railway variables til R2:
OWNER_EMAIL=vault1973@gmail.com
STORAGE_DRIVER=r2
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=...

Test:
https://www.3d-storage.org/health

Hvis health viser storageDriver:"r2" og r2Ready:true, bruger serveren R2.
