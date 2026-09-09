<p align="center">
  <img alt="AIOLiveTV Logo" src="packages/frontend/public/logo.png" width="256" height="256">
</p>

<h1 align="center">AIOLiveTV</h1>

<p align="center">
  <strong>Agregador unificado de Live TV para o Stremio.</strong>
  <br />
  Combine XMLTV, M3U, Xtream e addons de canais em um único addon, com ou sem EPG nativo.
</p>

<p align="center">
  <a href="https://github.com/mrcanelas/aiolivetv/actions">
    <img src="https://img.shields.io/github/actions/workflow/status/mrcanelas/aiolivetv/nightly.yml?style=for-the-badge&logo=github" alt="Build Status">
  </a>
  <a href="https://github.com/mrcanelas/aiolivetv">
    <img src="https://img.shields.io/github/stars/mrcanelas/aiolivetv?style=for-the-badge&logo=github" alt="GitHub Stars">
  </a>
</p>

---

## O que é o AIOLiveTV?

O AIOLiveTV adapta o fluxo do [AIOStreams](https://github.com/Viren070/AIOStreams) para TV ao vivo. Ele agrega canais e streams de várias fontes, faz matching dos equivalentes e devolve catálogo, meta e stream pelo protocolo padrão do Stremio.

Pode funcionar de dois jeitos:

- **Com EPG** — o XMLTV define os canais e o addon declara Native EPG (`behaviorHints.epgProvider`).
- **Sem EPG** — as fontes de stream definem os canais e equivalentes são mesclados por matching.

---

## Fontes

Tudo entra pela página **Addons** já existente:

- XMLTV (builtin de metadata/catálogo)
- M3U (builtin de streams; também gera canais sem EPG)
- Xtream, Vivo TV, Claro TV
- Addons Stremio externos de Live TV

A página **Channels** permite revisar mappings, priorizar streams e habilitar ou desabilitar canais. As alterações ficam no rascunho até o **Save**.

---

## Como executar

### Docker

```bash
git clone https://github.com/mrcanelas/aiolivetv.git
cd aiolivetv
cp .env.sample .env
# Defina BASE_URL e SECRET_KEY (64 caracteres hex)
docker compose up -d
```

Abra `http://localhost:3000/stremio/configure`.

### Vercel

Use PostgreSQL e Redis externos. O arquivo `Dockerfile.vercel` é detectado automaticamente. Guia: [Deploy on Vercel](packages/docs/content/docs/getting-started/vercel.mdx).

### A partir do código

Requer Node `>=24` e pnpm `>=11`.

```bash
pnpm install
pnpm build
pnpm start
```

---

## Créditos

O AIOLiveTV é uma adaptação do [AIOStreams](https://github.com/Viren070/AIOStreams), de [Viren070](https://github.com/Viren070).

## Aviso

O AIOLiveTV agrega metadados e URLs de canais fornecidos pelo usuário. Ele não hospeda nem distribui conteúdo. O uso das fontes configuradas é de responsabilidade de quem opera a instância.
