# Розгортання на Windows (Docker)

Потрібно: Docker Desktop (WSL2-бекенд) і Tailscale на Windows-машині.

## Перше розгортання

```powershell
git clone <репозиторій> hatcat-web
cd hatcat-web
docker compose up -d --build
docker compose logs -f        # має бути «HATCAT web monitor: http://0.0.0.0:8080 -> https://hatcat.eu/auth/»
```

Порт опубліковано лише на `127.0.0.1:8080` Windows-машини. Відкрити: http://127.0.0.1:8080.

Доступ з інших пристроїв, тільки tailnet (не Funnel):

```powershell
tailscale serve --bg 8080
tailscale serve status
```

Автозапуск: у Docker Desktop увімкнути «Start Docker Desktop when you sign in»; контейнер має `restart: unless-stopped`.

## Оновлення

```powershell
git pull
docker compose up -d --build
```

## Дані

Усе стан (сесія, історія, `telegram.json`, ліміти, кеш відключень) лежить у томі `hatcat-data` (`/app/data` у контейнері). Це іменований том, а не bind-mount: на NTFS не працюють права 0600.

Перенос з Linux-машини (зупинити там сервіс, щоб файли були узгоджені):

```powershell
# data/ скопіювати поруч, у папку .\data-import
docker run --rm -v hatcat-data:/app/data -v ${PWD}/data-import:/src alpine sh -c "cp -a /src/. /app/data/ && chown -R 1000:1000 /app/data"
```

Резервна копія:

```powershell
docker run --rm -v hatcat-data:/d -v ${PWD}:/b alpine tar czf /b/hatcat-data.tgz -C /d .
```

Сесія живе ~7 днів. Після міграції, якщо історія не пишеться, увійти в браузері ще раз.

## Примітки

- Не вмикати два екземпляри (Linux і Windows) одночасно: обидва опитуватимуть API й слатимуть дубль сповіщень у Telegram.
- Контейнер слухає `0.0.0.0` всередині; безпека тримається на публікації порту лише на `127.0.0.1` хоста. Не міняти на `"8080:8080"`.
- `MOCK=1` для перевірки без акаунта: додати `MOCK: "1"` у `environment`.
