# Account service

Optional sign-in with Discord and sync of modpacks, favourites, a few settings and the
session history. The launcher works the same without it. Plain Node 18 or newer, no
dependencies.

The desktop app never holds the Discord client secret. It opens
`/auth/login?port=<loopback port>&challenge=<PKCE S256>`, the service talks to Discord,
then hands a one-time code to `http://127.0.0.1:<port>/callback`. The app trades that code
plus its PKCE verifier at `/auth/token` for a session token.

| Route | What it does |
|---|---|
| `GET /auth/login` | checks port and challenge, redirects to Discord |
| `GET /auth/callback` | Discord comes back here, the code is exchanged with the client secret |
| `POST /auth/token` | `{ code, verifier }` gives `{ token, user }`, the code works once, 2 minutes |
| `POST /auth/logout` | ends the session of the bearer token |
| `GET /api/me` | the signed-in user |
| `GET /api/sync`, `PUT /api/sync` | the user's document `{ packs, favorites, settings, history }`, at most 256 kB |
| `GET /health` | `{ ok: true }` |

Limits: 30 sign-in requests and 120 API requests per minute and IP, sessions expire after
90 days, storage is one JSON file per user in `DATA_DIR`.

## Deploy

1. Create the Discord application's redirect `https://imkirit.dev/kitbash/auth/callback`.
2. Copy this folder to the server, for example `/opt/kitbash-account`.
3. Env file `/etc/kitbash-account.env`, readable by root only:

   ```
   DISCORD_CLIENT_ID=1561154745140518922
   DISCORD_CLIENT_SECRET=<from the Discord developer portal>
   SESSION_SECRET=<long random string, for example: openssl rand -hex 32>
   PUBLIC_URL=https://imkirit.dev/kitbash
   PORT=3160
   DATA_DIR=/var/lib/kitbash-account
   ```

4. systemd unit `/etc/systemd/system/kitbash-account.service`:

   ```
   [Unit]
   Description=Kitbash account service
   After=network.target

   [Service]
   EnvironmentFile=/etc/kitbash-account.env
   ExecStart=/usr/bin/node /opt/kitbash-account/index.js
   User=kitbash
   StateDirectory=kitbash-account
   Restart=on-failure
   NoNewPrivileges=true
   ProtectSystem=strict
   ReadWritePaths=/var/lib/kitbash-account

   [Install]
   WantedBy=multi-user.target
   ```

5. nginx, inside the `server` block of imkirit.dev:

   ```
   location /kitbash/ {
       proxy_pass http://127.0.0.1:3160/;
       proxy_set_header X-Real-IP $remote_addr;
       client_max_body_size 300k;
   }
   ```

6. `systemctl daemon-reload && systemctl enable --now kitbash-account`, then
   `curl https://imkirit.dev/kitbash/health`.

The service rotates nothing by itself: after a new client secret, change the env file and
restart the unit.

## Test locally

`npm test` in the launcher repository starts the service on a random local port with a
mocked Discord and checks every route.
