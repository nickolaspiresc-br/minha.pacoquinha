## Deploy no Render

O projeto usa Flask + Flask-SocketIO com `gevent`. O `Procfile` já configura um worker WebSocket único:

```text
web: gunicorn --worker-class geventwebsocket.gunicorn.workers.GeventWebSocketWorker --workers 1 --bind 0.0.0.0:$PORT app:app
```

Configure estas variáveis no Render, sem commitar `.env`:

```text
SECRET_KEY=<segredo-forte>
ACCESS_PASSWORD=euteamoleide
SUPABASE_URL=https://tkuagggdzzyagvkgrksc.supabase.co
SUPABASE_ANON_KEY=<anon-key-do-supabase>
OMDB_API_KEY=<chave-da-omdb>
FLASK_DEBUG=0
```

Instalação e QA local:

```powershell
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
python -m py_compile app.py
```

O backend atual não é Node.js. A persistência usa `supabase-py`; Socket.IO usa `gevent-websocket`. Em produção, mantenha `--workers 1`, pois o estado temporário da sala (`rooms`) fica em memória do processo.

Os logs operacionais usam os prefixos `[Supabase]`, `[OMDb]`, `[Chat]`, `[Socket]` e `[PWA]`. O frontend não registra conteúdo de mensagens nem credenciais.
