# Pape / LembreMe

Aplicativo Flask para lembretes de medicação e controle de pacientes.

## O que é
- Frontend web + PWA para lembretes de medicação.
- Painel administrativo para importar lembretes, ver estatísticas e exportar históricos.
- Banco de dados SQLite por padrão, com suporte a `DATABASE_URL`/PostgreSQL.

## Como rodar localmente

1. Crie e ative um ambiente virtual Python.
2. Instale as dependências:

```bash
python -m pip install -r requirements.txt
```

3. Copie o exemplo de variáveis de ambiente:

```bash
copy .env.example .env
```

4. Ajuste as variáveis se precisar.
5. Execute:

```bash
python app.py
```

O servidor ficará disponível em `http://127.0.0.1:5000`.

## Deploy no Render

A configuração já está preparada para Render:
- `render.yaml` contém o `buildCommand` e `startCommand`.
- `RENDER_DISK_PATH` está definido para persistir dados locais.
- O healthcheck usa `/healthz`.

### Importante
- Mantenha `RENDER_DISK_PATH` alinhado entre `render.yaml` e `.env.example`.
- Se mudar o caminho do banco ou variáveis importantes, atualize também `render.yaml`.

## PWA e modo offline

- O app inclui `static/offline.html` para fallback quando o dispositivo estiver sem internet.
- O service worker em `static/sw.js` cacheia recursos essenciais e mantém os ativos atualizados.
- O manifest PWA já está configurado para instalação em dispositivos compatíveis.

## Docker

Este projeto agora também inclui suporte a container Docker.

### Usar Docker localmente

```bash
docker build -t lembreme .
docker run -p 5000:5000 --env-file .env lembreme
```

### Ignorar arquivos locais no Docker

O `.dockerignore` já exclui diretórios e arquivos de ambiente locais, banco de dados e logs.

## Variáveis de ambiente úteis

- `SECRET_KEY` – chave Flask para sessão.
- `DB_PATH` – caminho do banco de dados SQLite.
- `RENDER_DISK_PATH` – diretório persistente no Render.
- `SESSION_COOKIE_SECURE` – `1` para cookies seguros.
- `TRUST_PROXY_HEADERS` – `1` para cabeçalhos X-Forwarded-*.
- `START_SCHEDULER` – `1` ativa o agendador de backups e email.

## Estrutura principal

- `app.py` – backend Flask e modelos SQLAlchemy.
- `requirements.txt` – dependências Python.
- `render.yaml` – deploy no Render.
- `Procfile` – gunicorn para deploy alternativo.
- `static/` – assets, service worker e manifest PWA.
- `templates/` – páginas HTML.

## Observações

- O serviço PWA já possui um `sw.js` com cache de recursos.
- A pasta `instance/` e arquivos `.db` são ignorados pelo Git.
