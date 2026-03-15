#!/usr/bin/env node

const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs/promises');
const { existsSync } = require('fs');
const { execFileSync } = require('child_process');

const DEFAULTS = {
  playlistName: 'Acervo de vídeos privados',
  studioUrl: 'https://studio.youtube.com/channel/UCKzHB3tXh5pBP_iVBC6CiiA/videos/short?filter=%5B%5D&sort=%7B%22columnType%22%3A%22date%22%2C%22sortOrder%22%3A%22DESCENDING%22%7D',
  chromeExecutable: '/usr/bin/google-chrome-stable',
  userDataDir: path.join(os.homedir(), '.config', 'google-chrome'),
  profileDirectory: 'Default',
  headless: false,
  slowMo: 50,
  timeoutMs: 20000,
  cloneProfile: true,
  storageStatePath: '',
};

function parseArgs(argv) {
  const config = { ...DEFAULTS };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--playlist' && next) {
      config.playlistName = next;
      i += 1;
      continue;
    }
    if (arg === '--studio-url' && next) {
      config.studioUrl = next;
      i += 1;
      continue;
    }
    if (arg === '--user-data-dir' && next) {
      config.userDataDir = next;
      i += 1;
      continue;
    }
    if (arg === '--profile' && next) {
      config.profileDirectory = next;
      i += 1;
      continue;
    }
    if (arg === '--headless') {
      config.headless = true;
      continue;
    }
    if (arg === '--storage-state' && next) {
      config.storageStatePath = next;
      i += 1;
      continue;
    }
    if (arg === '--reuse-live-profile') {
      config.cloneProfile = false;
      continue;
    }
    if (arg === '--help') {
      printHelpAndExit();
    }
  }

  return config;
}

function printHelpAndExit() {
  console.log(`
Usage:
  npm run publish-shorts-drafts -- [options]

Options:
  --playlist <name>         Playlist target. Default: ${DEFAULTS.playlistName}
  --studio-url <url>        YouTube Studio Shorts URL.
  --user-data-dir <path>    Chrome user data dir. Default: ${DEFAULTS.userDataDir}
  --profile <name>          Chrome profile directory. Default: ${DEFAULTS.profileDirectory}
  --headless                Run headless.
  --storage-state <path>    Playwright storage state JSON to reuse an authenticated session.
  --reuse-live-profile      Use the real Chrome profile directly.
  --help                    Show this help.

Important:
  1. Close Google Chrome before running if you use the real Chrome profile.
  2. The account in that profile must already be logged in to YouTube Studio.
`);
  process.exit(0);
}

function log(message) {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${stamp}] ${message}`);
}

async function prepareUserDataDir(config) {
  if (!config.cloneProfile) {
    return {
      userDataDir: config.userDataDir,
      cleanup: async () => {},
    };
  }

  const sourceProfileDir = path.join(config.userDataDir, config.profileDirectory);
  if (!existsSync(sourceProfileDir)) {
    throw new Error(`Perfil do Chrome nao encontrado: ${sourceProfileDir}`);
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-studio-shorts-profile-'));
  const tempProfileDir = path.join(tempRoot, config.profileDirectory);
  const localState = path.join(config.userDataDir, 'Local State');

  if (existsSync(localState)) {
    await fs.copyFile(localState, path.join(tempRoot, 'Local State'));
  }

  log(`Clonando perfil do Chrome para uso temporario: ${tempRoot}`);
  execFileSync('cp', ['-a', sourceProfileDir, tempProfileDir], { stdio: 'ignore' });

  for (const lockName of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    await fs.rm(path.join(tempRoot, lockName), { force: true }).catch(() => {});
    await fs.rm(path.join(tempProfileDir, lockName), { force: true }).catch(() => {});
  }

  return {
    userDataDir: tempRoot,
    cleanup: async () => {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    },
  };
}

async function waitForVisible(container, role, names, timeoutMs) {
  for (const name of names) {
    const locator = container.getByRole(role, { name, exact: true });
    try {
      await locator.first().waitFor({ state: 'visible', timeout: timeoutMs });
      return locator.first();
    } catch {
      // Try the next label.
    }
  }
  return null;
}

function getEditor(page) {
  return page.locator('ytcp-uploads-dialog:visible').last();
}

async function ensurePlaylistSelected(dialog, playlistName, timeoutMs) {
  const selectedButton = dialog.getByRole('button', { name: playlistName, exact: true });
  if (await selectedButton.count()) {
    return;
  }

  const openPlaylistButton = await waitForVisible(dialog, 'button', ['Selecionar playlists', 'Select playlists'], timeoutMs);
  if (!openPlaylistButton) {
    throw new Error('Nao encontrei o botao de playlists.');
  }
  await openPlaylistButton.click();

  const picker = dialog.page().getByRole('dialog', { name: 'Escolher playlists', exact: true }).first();
  await picker.waitFor({ state: 'visible', timeout: timeoutMs });

  const playlistCheckbox = picker.getByRole('checkbox', { name: playlistName, exact: true });
  if (await playlistCheckbox.count()) {
    const checked = await playlistCheckbox.first().getAttribute('aria-checked');
    if (checked !== 'true') {
      await playlistCheckbox.first().click();
    }
  } else {
    const playlistText = picker.getByText(playlistName, { exact: true }).last();
    if (!await playlistText.count()) {
      throw new Error(`Nao encontrei a playlist "${playlistName}" no seletor.`);
    }
    await playlistText.click();
  }

  const doneButton = await waitForVisible(picker, 'button', ['Concluir', 'Done'], timeoutMs);
  if (!doneButton) {
    throw new Error('Nao encontrei o botao Concluir da playlist.');
  }
  await doneButton.click();

  await dialog.getByRole('button', { name: playlistName, exact: true }).first().waitFor({
    state: 'visible',
    timeout: timeoutMs,
  }).catch(() => {});
}

async function setAudience(dialog, timeoutMs) {
  const notForKids = await waitForVisible(dialog, 'radio', ['Não é conteúdo para crianças', 'No, it’s not made for kids'], timeoutMs);
  if (!notForKids) {
    throw new Error('Nao encontrei a opcao de publico.');
  }

  const checked = await notForKids.getAttribute('aria-checked');
  if (checked !== 'true') {
    await notForKids.click();
  }
}

async function advanceWizard(dialog, timeoutMs) {
  for (let step = 0; step < 3; step += 1) {
    const nextButton = await waitForVisible(dialog, 'button', ['Avançar', 'Next'], timeoutMs);
    if (!nextButton) {
      throw new Error(`Nao encontrei o botao Avancar no passo ${step + 1}.`);
    }
    await nextButton.click();
    await dialog.page().waitForTimeout(400);
  }
}

async function setVisibility(dialog, timeoutMs) {
  const unlisted = await waitForVisible(dialog, 'radio', ['Não listado', 'Unlisted'], timeoutMs);
  if (!unlisted) {
    throw new Error('Nao encontrei a opcao Nao listado.');
  }

  const checked = await unlisted.getAttribute('aria-checked');
  if (checked !== 'true') {
    await unlisted.click();
  }
}

async function closePublishedAndEditor(dialog, timeoutMs) {
  const page = dialog.page();
  const publishedDialog = page.getByRole('dialog', { name: 'Vídeo publicado', exact: true }).first();
  if (await publishedDialog.count()) {
    const closePublished = await waitForVisible(publishedDialog, 'button', ['Fechar', 'Close'], timeoutMs);
    if (closePublished) {
      await closePublished.click().catch(() => {});
      await page.waitForTimeout(600);
    }
  }

  const closeEditor = await waitForVisible(dialog, 'button', ['Fechar', 'Close'], 3000);
  if (closeEditor) {
    await closeEditor.click().catch(() => {});
    await dialog.waitFor({ state: 'hidden', timeout: timeoutMs }).catch(() => {});
  }

  await page.waitForTimeout(1000);
}

async function saveDialog(dialog, timeoutMs) {
  const saveButton = await waitForVisible(dialog, 'button', ['Salvar', 'Save'], timeoutMs);
  if (!saveButton) {
    throw new Error('Nao encontrei o botao Salvar.');
  }

  await saveButton.click();
  await dialog.page().waitForTimeout(1500);
  await closePublishedAndEditor(dialog, timeoutMs);
}

async function openFirstDraft(page, timeoutMs) {
  const openEditor = getEditor(page);
  if (await openEditor.count()) {
    return true;
  }

  const editButtons = page.getByRole('button', { name: 'Editar rascunho', exact: true });
  const count = await editButtons.count();
  if (!count) {
    return false;
  }

  await editButtons.first().click();
  const dialog = getEditor(page);
  await dialog.waitFor({ state: 'visible', timeout: timeoutMs });
  return true;
}

async function goToNextPage(page) {
  const nextPage = page.getByRole('button', { name: 'Navegar para a próxima página', exact: true });
  if (await nextPage.count()) {
    const disabled = await nextPage.first().isDisabled();
    if (!disabled) {
      await nextPage.first().click();
      await page.waitForTimeout(1500);
      return true;
    }
  }
  return false;
}

async function getCurrentDraftTitle(page) {
  const dialogTitle = page.locator('ytcp-uploads-dialog:visible [id=\"dialog-title\"]');
  if (await dialogTitle.count()) {
    const title = (await dialogTitle.first().textContent()) || '';
    return title.trim();
  }
  return 'rascunho';
}

async function main() {
  const config = parseArgs(process.argv.slice(2));

  log(`Usando playlist: ${config.playlistName}`);
  log(`Abrindo Studio em: ${config.studioUrl}`);

  const useStorageState = Boolean(config.storageStatePath);
  const preparedProfile = useStorageState
    ? { cleanup: async () => {} }
    : await prepareUserDataDir(config);

  const browserOrContext = useStorageState
    ? await chromium.launch({
      executablePath: config.chromeExecutable,
      headless: config.headless,
      slowMo: config.slowMo,
      args: ['--lang=pt-BR'],
    })
    : await chromium.launchPersistentContext(preparedProfile.userDataDir, {
      executablePath: config.chromeExecutable,
      headless: config.headless,
      slowMo: config.slowMo,
      viewport: { width: 1440, height: 960 },
      args: [
        `--profile-directory=${config.profileDirectory}`,
        '--lang=pt-BR',
      ],
    });

  const context = useStorageState
    ? await browserOrContext.newContext({
      viewport: { width: 1440, height: 960 },
      storageState: config.storageStatePath,
    })
    : browserOrContext;

  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(config.timeoutMs);

  try {
    await page.goto(config.studioUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: config.timeoutMs }).catch(() => {});

    if (/accounts\\.google\\.com/.test(page.url())) {
      throw new Error('Chrome abriu na tela de login. Entre na conta primeiro e rode o script de novo.');
    }

    let processed = 0;

    while (true) {
      const opened = await openFirstDraft(page, config.timeoutMs);
      if (!opened) {
        const moved = await goToNextPage(page);
        if (moved) {
          continue;
        }
        break;
      }

      const dialog = getEditor(page);
      const title = await getCurrentDraftTitle(page);
      log(`Processando short: ${title}`);

      await ensurePlaylistSelected(dialog, config.playlistName, config.timeoutMs);
      await setAudience(dialog, config.timeoutMs);
      await advanceWizard(dialog, config.timeoutMs);
      await setVisibility(dialog, config.timeoutMs);
      await saveDialog(dialog, config.timeoutMs);

      processed += 1;
      log(`Publicado short como nao listado: ${title}`);
      await page.waitForTimeout(800);
    }

    log(`Concluido. Total processado: ${processed}`);
  } finally {
    await context.close();
    if (useStorageState) {
      await browserOrContext.close();
    }
    await preparedProfile.cleanup();
  }
}

main().catch((error) => {
  console.error(`\nErro: ${error.message}`);
  process.exit(1);
});
