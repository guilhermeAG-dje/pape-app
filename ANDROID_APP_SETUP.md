# PAPE no Android

## O caminho mais simples

Este projeto ja esta montado como app web em Flask. O caminho mais facil para ter "uma app Android que atualiza quando mudares o codigo aqui" e:

1. Manter este projeto como a fonte principal.
2. Publicar o Flask num servidor.
3. Abrir esse endereco no Android e instalar como app (PWA).
4. Mais tarde, se quiseres APK da Play Store, criar um wrapper Android por cima do mesmo endereco.

## Como fica o fluxo de trabalho

1. Alteras o codigo nesta pasta.
2. Fazes deploy/publicacao do projeto para o servidor.
3. A app instalada no Android abre a versao atualizada.
4. Como o `service worker` esta em modo de atualizacao agressiva, os ficheiros novos entram sem teres de reconstruir tudo.

## O que ja ficou preparado

- `manifest.webmanifest` para instalacao no Android.
- `sw.js` para cache e atualizacoes.
- `static/js/pwa.js` para registar o `service worker` em todas as paginas importantes.
- Metadados PWA nas paginas principais e admin.

## O que ainda precisas fazer fora desta pasta

### 1. Publicar o Flask

Podes usar servicos como:

- Render
- Railway
- PythonAnywhere
- VPS com Nginx + Gunicorn

### 2. Configurar URL publica

Exemplo:

```text
https://meu-pape.onrender.com
```

### 3. Instalar no Android

No Chrome do Android:

1. Abrir o site publicado.
2. Tocar em "Adicionar ao ecra principal" ou "Instalar app".
3. A app passa a abrir em modo standalone.

## Quando precisas gerar APK novo

Nao precisas gerar APK novo quando mudares:

- HTML
- CSS
- JavaScript
- rotas Flask
- logica do backend

So precisas de novo APK se mudares a parte nativa Android, por exemplo:

- icone nativo do app wrapper
- splash screen nativa
- permissoes Android
- notificacoes push nativas

## Se quiseres Play Store depois

O proximo passo recomendado e criar uma app Android simples em:

- Trusted Web Activity (melhor para publicar)
- ou WebView (mais simples para testes)

Essa app aponta para a tua URL publicada. Assim continuas a alterar este projeto e a app reflete as mudancas.
