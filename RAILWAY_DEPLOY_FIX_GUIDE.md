# 3D Storage Website v0.4.2 ROOT 404 FIX

This version fixes `GET / 404` by forcing `/` to serve `public/index.html`.

## GitHub/Railway checklist

Upload the CONTENTS of this folder to the root of the GitHub repo connected to Railway.

Correct:
- package.json
- server.js
- public/index.html
- public/styles.css
- public/app.js

Wrong:
- 3D_Storage_Website_v0_4_2_ROOT_404_FIXED/package.json

## Railway variables

Keep:
- OWNER_EMAIL=vault1973@gmail.com
- STORAGE_DRIVER=local

## Test

https://www.3d-storage.org/health

Expected:
{"ok":true,"version":"0.4.2","storageDriver":"local"}

Then open:
https://www.3d-storage.org/

It should show the website, not 404.
