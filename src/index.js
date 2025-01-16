// -- Global Variables and Flags --
let allMods = [];           // Stores all mods
let isInstalling = false;   // Tracks installation status
let installQueue = [];      // Queue for install requests
let checkUpdates = true;    // Used for running update checking once

// -- Modal Elements --
const modal = document.getElementById("SettingsModal");
const modalMessage = document.getElementById('modalMessage');


// -- DOM Actions --
document.addEventListener('DOMContentLoaded', () => {
  // Button Actions
  document.querySelector('.play-btn').addEventListener('click', launchGame);
  document.querySelector('.settings-btn').addEventListener('click', function () {
    openModal(""); // Passes empty intentionally
  });
  document.querySelector('.collapse-btn').addEventListener('click', toggleSidebar);
  document.getElementById('browseGame').addEventListener('click', () => openFileDialog('gamePath'));
  document.getElementById('browseModsPath').addEventListener('click', () => openFileDialog('modsPath'));
  document.getElementById('saveConfigBtn').addEventListener('click', saveConfig);
  document.getElementById('resetConfigBtn').addEventListener('click', resetConfig);

  // Dropdown Actions
  document.getElementById('browseDropdown').querySelector('.dropdown-header').addEventListener('click', () => toggleDropdown('browseDropdown'));
  document.getElementById('installedDropdown').querySelector('.dropdown-header').addEventListener('click', () => toggleDropdown('installedDropdown'));
  document.getElementById('loaderDropdown').querySelector('.dropdown-header').addEventListener('click', () => toggleDropdown('loaderDropdown'));

  // Auto-update toggle initialization
  const autoUpdateToggle = document.getElementById('autoUpdateToggle');

  // Add an event listener for changes to the toggle
  autoUpdateToggle.addEventListener('change', () => {
    if (autoUpdateToggle.checked) {
      enableAutoUpdate();
    } else {
      disableAutoUpdate();
    }
  });
});

// Simply opens dropdowns for modlists 
function toggleDropdown(id) {
  const dropdown = document.getElementById(id);
  dropdown.classList.toggle('open');
}

// -- Settings Modal --

// Open modal when settings button is clicked
function openModal(message = '') {
  window.api.log(message);
  if (message !== '') {
    modalMessage.textContent = message; // Set the dynamic message
    modalMessage.style.display = 'block'; // Show the message
  } else {
    modalMessage.style.display = 'none'; // Hide the message if none provided
  }
  modal.style.display = 'block';
}

// Helper function to close modal
function closeModal() {
  modal.style.display = "none";
}

// Open file dialog method that accepts an argument to know which field to update
async function openFileDialog(type) {
  const initialDirectory = document.getElementById(type).value;
  const fileType = type === 'gamePath' ? '.exe' : null; // If gamePath its exec, otherwise folder
  const filePath = await window.api.openFileDialog(initialDirectory, fileType);

  if (filePath) {
    document.getElementById(type).value = filePath;
  }
}


// Saves the settings configuration
async function saveConfig() {
  const autoUpdate = document.getElementById('autoUpdateToggle').checked;
  const gamePath = document.getElementById('gamePath').value;
  const modPath = document.getElementById('modsPath').value;
  await window.api.saveConfig(gamePath, modPath, autoUpdate);
  closeModal();
}

// Closes settings without saving
async function resetConfig() {
  const { startup, config } = await window.api.startupCheck();
  document.getElementById('gamePath').value = config.gameExe;
  document.getElementById('modsPath').value = config.modsDir;
  const autoUpdateToggle = document.getElementById('autoUpdateToggle');
  autoUpdateToggle.checked = config.autoUpdate || false; // Default to false if undefined
  closeModal();
}

// Methods for enabling/disabling auto-update
async function enableAutoUpdate() {
  window.api.log("Auto-update enabled");
  await window.api.updateModlist();
}

async function disableAutoUpdate() {
  window.api.log("Auto-update disabled");
}

//-- Side-Buttons --

//Launch Game Button
async function launchGame() {
  await window.api.launchGame();
}

//Collapse button, hides the sidebar
function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const collapseBtn = document.querySelector('.collapse-btn');
  sidebar.classList.toggle('collapsed');
  collapseBtn.classList.toggle('open');
  const arrow = collapseBtn.querySelector('.dropdown-arrow');
  arrow.textContent = sidebar.classList.contains('collapsed') ? '◄' : '◁';
}

// -- Core Functionality -- 

// Checks if the config for filepaths exists, if not prompt to set them.
async function CheckForPaths() {
  const { startup, config } = await window.api.startupCheck();
  if (!startup) {
    openModal("Welcome to Faroquin! Please set your appropriate mod-paths and install Lovely/Steammodded to get started.");
  }
  document.getElementById('gamePath').value = config.gameExe;
  document.getElementById('modsPath').value = config.modsDir;
  const autoUpdateToggle = document.getElementById('autoUpdateToggle');
  autoUpdateToggle.checked = config.autoUpdate || false; // Default to false if undefined

  if (autoUpdateToggle.checked) {
    enableAutoUpdate();
  } else {
    disableAutoUpdate();
  }

  // Initializes all the mods
  loadAndRenderMods();
}

// The meat of rendering all the mod items
async function loadAndRenderMods() {
  allMods = await window.api.getMods(); // Assign the mods to the global variable

  if (!allMods) {
    return;
  }

  // Sort Alphabetically and by Filter
  const browseMods = allMods
    .filter(mod => !mod.installed && !mod.core)
    .sort((a, b) => a.name.localeCompare(b.name));

  const installedMods = allMods
    .filter(mod => mod.installed && !mod.core)
    .sort((a, b) => a.name.localeCompare(b.name));

  const loaderMods = allMods
    .filter(mod => mod.core)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Checks for updates on mods, using a global variable to only run this check once after items are sorted.
  if (checkUpdates) {
    checkUpdates = false;
    // TODO
    // Currently waits, needs either an indicator or background check instead of stopping the app.
    await CheckForUpdates(installedMods);
  }

  renderModList('browseMods', browseMods);
  renderModList('installedMods', installedMods);
  renderModList('loaderMods', loaderMods);

  const searchBar = document.getElementById('searchBar');
  searchBar.addEventListener('input', () => {
    const searchTerm = searchBar.value.toLowerCase();
    renderModList('browseMods', browseMods.filter(mod => mod.name.toLowerCase().includes(searchTerm)));
    renderModList('installedMods', installedMods.filter(mod => mod.name.toLowerCase().includes(searchTerm)));
    renderModList('loaderMods', loaderMods.filter(mod => mod.name.toLowerCase().includes(searchTerm)));
  });
}

// Checks for updates based on github commit hashes, hashes are stored in .faro files
async function CheckForUpdates(installedMods) {
  // Iterate through installedMods and fetch the commit hash if mod.github exists
  for (let mod of installedMods) {
    //canUpdate prevents spamming github after we know theres an update
    //specialDownloads are intentionally only one version and not meant to be update-able
    if (mod.github && !mod.canUpdate && !mod.specialDownload) {
      try {
        const commitHash = await window.api.fetchHash(mod.github, mod); // Fetch commit hash

        // If mod has sha and it's different from the fetched commit hash
        if (mod.sha && mod.sha !== commitHash.sha) {
          await window.api.log(`Update available for ${mod.name}. Current SHA: ${mod.sha}, New SHA: ${commitHash.sha}`);
          mod.canUpdate = true;
          await window.api.createFaro(mod.modPath, mod);
        } else if (!mod.sha) {
          await window.api.log(`No SHA available for ${mod.name}, setting new SHA.`);
          mod.sha = commitHash.sha; // Set the new SHA if it's not available
        } else {
          await window.api.log(`No update needed for ${mod.name}.`);
        }
      } catch (error) {
        await window.api.logError(`Failed to fetch commit hash for ${mod.name}: ${error.message}`);
      }
    }
  }
}

// -- Mod Buttons --

// Renders the individual buttons and information for each mod, dynamically
// Currently uses inline svgs for the color fill, alternatives preferred. 
// A bit messy in general, refactor may be needed.
// SVGs from Hero Icons (https://heroicons.com/) 

function renderModList(containerId, mods) {
  const container = document.getElementById(containerId);
  container.innerHTML = mods.map(mod => `
    <div class="mod-item" id="mod-${mod.id}">
      <div>
        <h3>${mod.name}</h3>
        <p>${mod.description}</p>
      </div>
      <div class="mod-actions">
        ${!mod.installed
      ? `
            <div class="download-icon" id="download-icon-${mod.id}">
              <svg xmlns="http://www.w3.org/2000/svg" height="30" fill="none"  viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="download-icon">
               <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
            </div>
          `
      : `
          ${!mod.core
        ? `
              <div class="toggle ${mod.enabled ? 'enabled' : ''}" id="toggle-${mod.id}"></div>
            `
        : ''
      }
              <div class="trash-can" id="trash-can-${mod.id}">
                <svg xmlns="http://www.w3.org/2000/svg" height="30" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="trash-icon">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                </svg>
              </div>
          `
    }
        ${mod.canUpdate
      ? `
              <div class="update-icon" id="update-icon-${mod.id}">
                <svg xmlns="http://www.w3.org/2000/svg" height="30" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="update-icon">
                 <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
              </div>
           `
      : ''
    }
      </div>
    </div>
  `).join('');

  // Not exactly pretty, but is a last minute change to utilize DOM for CSP instead of inline methods
  mods.forEach(mod => {
    document.getElementById(`mod-${mod.id}`).addEventListener('click', () => showModDetails(mod.id));

    if (!mod.installed) {
      document.getElementById(`download-icon-${mod.id}`).addEventListener('click', (event) => {
        event.stopPropagation();
        installMod(mod.id);
      });
    } else {
      if (!mod.core) {
        document.getElementById(`toggle-${mod.id}`).addEventListener('click', (event) => {
          event.stopPropagation();
          toggleMod(mod.id);
        });
      }
      document.getElementById(`trash-can-${mod.id}`).addEventListener('click', (event) => {
        event.stopPropagation();
        deleteMod(mod.id);
      });

      if (mod.canUpdate) {
        document.getElementById(`update-icon-${mod.id}`).addEventListener('click', (event) => {
          event.stopPropagation();
          updateMod(mod.id);
        });
      }
    }
  });
}

// Upon clicking a mod attempts to display its relevant readme 
// TODO
// Eventually it should use local readmes if there's not github, or for locally downloaded mods.
window.showModDetails = async (id) => {
  // Remove selection from all mods and select the clicked mod
  document.querySelectorAll('.mod-item').forEach(mod => mod.classList.remove('selected'));
  const selectedMod = document.getElementById(`mod-${id}`);
  selectedMod?.classList.add('selected');

  const mod = allMods.find(m => m.id === id);
  if (!mod) return alert('Mod not found!');

  // Here we set a loading message, as an indicator that its loading, in-case of poor connections
  const modContent = document.getElementById('modContent');
  modContent.innerHTML = `<h2>${mod.name}</h2><p>${mod.description}</p><p id="loadingMessage">Loading README...</p>`;

  if (mod.github) {
    try {
      const readmeContent = await window.api.fetchReadme(mod.github);
      modContent.innerHTML = `<h3>README</h3><div class="markdown-content">${readmeContent}</div>`;
      // We set the targets to _blank in conjunction with code in main.js this prevents opening links inside electron itself
      modContent.querySelectorAll('.markdown-content a').forEach(link => link.setAttribute('target', '_blank'));
    } catch (error) {
      document.getElementById('loadingMessage').innerText = `Error loading README: ${error.message}`;
    }
  } else {
    document.getElementById('loadingMessage').innerText = 'No GitHub link available for this mod.';
  }
};

// Toggle switch, creates/deletes a .lovelyignore which disables lovely from loading a mod
window.toggleMod = async (id) => {
  const mod = allMods.find(m => m.id === id);
  if (!mod) return alert('Mod not found!');

  mod.enabled = !mod.enabled;

  // Toggle the 'enabled' class for the mod's toggle element
  const toggleElement = document.getElementById(`toggle-${id}`);
  toggleElement?.classList.toggle('enabled', mod.enabled);

  await window.api.log(`Mod ${mod.id} is now ${mod.enabled ? 'enabled' : 'disabled'}`);

  const action = mod.enabled ? window.api.deleteFile : window.api.createFile;
  const filePath = mod.modFullPath;

  // Perform the appropriate file action based on whether the mod is enabled or disabled
  action(filePath, ".lovelyignore")
    .then(await window.api.log)
    .catch(await window.api.logError);

  // Write our changes to the .faro so that it maintains the enabled/disabled state.
  await window.api.createFaro(mod.modPath, mod);
};

async function updateMod(id) {
  await deleteMod(id);
  await installMod(id);
}

async function deleteMod(id) {
  await window.api.log(`Deleting mod with ID: ${id}`);

  const mod = allMods.find(m => m.id === id);
  if (!mod) return await window.api.logError(`Mod with ID ${id} not found.`);

  const modItem = document.getElementById(`mod-${id}`);
  if (!modItem) return await window.api.logError(`Mod item with ID ${id} not found.`);

  const trashIcon = document.getElementById(`trash-can-${id}`);
  if (!trashIcon) return await window.api.logError(`Trash can for mod ID ${id} not found.`);

  const originalContent = trashIcon.innerHTML;
  trashIcon.innerHTML = '<div class="spinner"></div>'; // Show spinner

  try {
    await window.api.deleteDirectory(mod.modPath);
    await window.api.log(`Mod ${mod.modPath} successfully deleted.`);

    // Special paths for things like lovely's version.dll
    if (mod.specialPaths?.length) {
      await window.api.deleteSpecial(mod);
      await window.api.log(`Special paths for mod ${mod.id} deleted.`);
    }

    await loadAndRenderMods();
    await window.api.log(`Mod with ID ${id} has been removed.`);
  } catch (error) {
    await window.api.logError(error);
    trashIcon.innerHTML = originalContent;
  }
}

// TODO
// This logic needs to be adjusted so that you can't spam downloads, and that it remains spinning after the first queued item is downloaded
async function installMod(id) {
  const mod = allMods.find(m => m.id === id);
  if (!mod) return await window.api.logError(`Mod with ID ${id} not found.`);

  const downloadIcon = document.getElementById(`download-icon-${id}`);
  if (!downloadIcon) return;

  const originalContent = downloadIcon.innerHTML;
  downloadIcon.innerHTML = '<div class="spinner"></div>'; // Show spinner

  installQueue.push({ mod, downloadIcon, originalContent });
  if (!isInstalling) await processInstallQueue();
}

// Queue system so you can install more than one mod at a time.
async function processInstallQueue() {
  if (installQueue.length === 0) return; // No tasks in the queue

  isInstalling = true;
  const { mod, downloadIcon, originalContent } = installQueue.shift();

  try {
    const message = await window.api.installMod(mod);
    await window.api.log(message); // Success message
    await loadAndRenderMods();
  } catch (error) {
    await window.api.logError(`Error installing mod with ID ${mod.id}:`, error);
  } finally {
    downloadIcon.innerHTML = originalContent; // Restore icon
    isInstalling = false;
    await processInstallQueue(); // Process the next task
  }
}

// Runs on App Startup
CheckForPaths();