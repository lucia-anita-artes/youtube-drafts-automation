# YouTube Drafts Automation

Automatiza a publicação de rascunhos do YouTube Studio como `não listado` e adiciona cada vídeo em uma playlist específica.

## O que o script faz

- abre a página de conteúdo do YouTube Studio
- procura botões `Editar rascunho`
- para cada rascunho:
  - garante a playlist selecionada
  - marca `Não é conteúdo para crianças`
  - avança pelas etapas
  - define `Não listado`
  - salva
- repete até zerar os rascunhos visíveis em todas as páginas

## Limite importante

Ele usa o perfil local do Chrome para reaproveitar o login da sua conta. Por isso:

1. feche o Google Chrome antes de rodar
2. deixe a conta certa já logada nesse perfil

## Instalação

```bash
cd /home/lucia/Downloads/youtube-drafts-automation
npm install
```

## Uso

```bash
cd /home/lucia/Downloads/youtube-drafts-automation
npm run publish-drafts -- --playlist "Acervo de vídeos privados"
```

Para shorts:

```bash
cd /home/lucia/Downloads/youtube-drafts-automation
npm run publish-shorts-drafts -- --playlist "Acervo de vídeos privados"
```

## Opções

```bash
npm run publish-drafts -- --help
```
