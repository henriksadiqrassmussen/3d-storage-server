Upload disse filer til GitHub-roden:
package.json
server.js
railway.json
public/
guides/

Efter Railway redeploy:
https://www.3d-storage.org/health
skal vise version 0.5.3 og r2Mode signed-direct-upload.

Test:
1. Åbn https://www.3d-storage.org
2. Log ind med vault1973@gmail.com
3. Upload en lille .fbx/.glb/.zip
4. Hent bibliotek
5. Download filen

Hvis upload fejler med CORS:
Sæt CORS på Cloudflare R2 bucket som vist i guides/README_R2_CORS_DANSK.txt
