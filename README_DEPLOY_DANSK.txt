3D Storage v0.5.4 - Signed URL HTTPS Fixed

Upload hele indholdet til GitHub-roden:
package.json
server.js
railway.json
public/index.html
public/styles.css
public/app.js

Railway variables:
OWNER_EMAIL=vault1973@gmail.com
STORAGE_DRIVER=r2
R2_ACCOUNT_ID=kun account id, ingen https://
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=3d-storage-files

Cloudflare R2 CORS:
[
  {
    "AllowedOrigins": ["https://www.3d-storage.org", "https://3d-storage.org"],
    "AllowedMethods": ["GET", "PUT", "DELETE", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]

Efter deploy test:
https://www.3d-storage.org/health
Skal vise version 0.5.4 og signedUrlHttpsFix true.
