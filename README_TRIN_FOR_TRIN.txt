3D Storage v0.5.2 R2 NODE20 IPV4 FIX

Upload hele indholdet til GitHub-roden:
- package.json
- server.js
- railway.json
- public/
- guides/

Railway variables:
OWNER_EMAIL=vault1973@gmail.com
STORAGE_DRIVER=r2
R2_ACCOUNT_ID=kun account id
R2_ACCESS_KEY_ID=access key id
R2_SECRET_ACCESS_KEY=secret access key
R2_BUCKET=bucket-navn

Efter deploy:
https://www.3d-storage.org/health
Skal vise version 0.5.2, storageDriver r2, r2Ready true og node v20.x.x.

Test derefter:
https://www.3d-storage.org/api/r2-test
