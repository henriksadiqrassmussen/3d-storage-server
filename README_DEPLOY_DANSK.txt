3D Storage Railway Server v0.3.3

Denne server har:
- /health
- /api/me?email=...
- /api/files?email=...
- /api/upload
- /api/download/:id?email=...
- DELETE /api/files/:id?email=...
- CORS aktivt, så browser-appen kan uploade direkte.

Railway variables:
OWNER_EMAIL=vault1973@gmail.com
STORAGE_DRIVER=local

Vigtigt:
Denne local-storage version er stadig test/grundmotor. Railway filsystem kan nulstilles ved redeploy.
Næste lager-trin til betalende kunder er Cloudflare R2/S3.

Deploy:
1. Upload indholdet af 01_railway_server til dit GitHub repo.
2. Railway deployer automatisk.
3. Test: https://din-url/health
