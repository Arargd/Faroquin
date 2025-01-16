// -- Imports --
const { app, BrowserWindow, ipcMain, ipcRenderer, autoUpdater } = require('electron');
const { dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const marked = require('marked');
const https = require('https');
const os = require('os');
const { pipeline } = require('stream');
var exec = require('child_process').execFile;
const AdmZip = require('adm-zip');
const { loadMods, getModInfo } = require('./modsLoader');
const log = require('electron-log');


// -- Global Variables --
// These need to be flexible for multiple OS later
let gameExe = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Balatro\\Balatro.exe";
let gameDir = path.dirname(gameExe);
let modsDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Balatro', 'Mods');
const configPath = app.isPackaged
  ? path.join(app.getPath('userData'), 'config.json')
  : path.join(__dirname, 'config.json');
const zippedDir = app.isPackaged
  ? path.join(app.getPath('userData'), 'ZippedMods')
  : path.join(__dirname, 'ZippedMods');
const modlist = app.isPackaged
  ? path.join(app.getPath('userData'), 'modslist.json')
  : path.join(__dirname, 'modslist.json');

if (!fs.existsSync(modlist)) {
  try {
    // Parse the string and write it to a file
    fs.writeFileSync(modlist, modlistString, 'utf-8');
    log.info('modlist.json has been created in the userData directory.');
  } catch (error) {
    log.error('Error writing modlist.json to userData:', error);
  }
} else {
  log.info('modlist.json already exists in userData.');
}


// Ensures ZippedMods folder is made
if (!fs.existsSync(zippedDir)) { fs.mkdirSync(zippedDir, { recursive: true }); }


// -- Application Core --

// This is the initial startup of the entire program
let mainWindow;

app.enableSandbox()
app.on('ready', () => {
  log.info('App is starting...');
  mainWindow = new BrowserWindow({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
    autoHideMenuBar: true,
  });
  mainWindow.maximize();

  mainWindow.loadFile('index.html');

  log.info('Main window loaded');
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Prevents opening of links inside of electron (when tagged with _blank)
  mainWindow.webContents.setWindowOpenHandler((details) => {
    const { url } = details;
    require('electron').shell.openExternal(url);
    return { action: 'deny' }
  })

  // Opens developer window for debugging
  // mainWindow.webContents.openDevTools()
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// -- ipcHandlers Core --

// Logging
ipcMain.on('log-message', (event, message) => {
  log.info(`Renderer message: ${message}`);
});

ipcMain.on('log-error', (event, message) => {
  log.error(`Renderer error: ${message}`);
});

// Connects renderer to the modsLoader.js
ipcMain.handle('get-mods', async () => {
  return loadMods(loadConfig());
});

function loadConfig() {
  const defaultConfig = { gameExe, modsDir, autoUpdate: true };

  try {
    if (fs.existsSync(configPath)) {
      const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (configData.gameExe && configData.modsDir && typeof configData.autoUpdate === 'boolean') {
        return { startup: true, config: configData };
      }
    }
  } catch (error) {
    log.error('Error reading config, resetting to default:', error.message);
  }

  fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
  return { startup: false, config: defaultConfig };
}


function saveConfig(gamePath, modPath, autoUpdate) {
  const newConfig = {
    gameExe: gamePath || gameExe,
    modsDir: modPath || modsDir,
    autoUpdate: autoUpdate,
  };

  fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf-8');

  // Update the in-memory variables
  gameExe = newConfig.gameExe;
  gameDir = path.dirname(gameExe);
  modsDir = newConfig.modsDir;

  return { success: true, config: newConfig };
}

// Reads and creates config file.
ipcMain.handle('startup-check', async () => {
  const { startup, config } = loadConfig();
  return { startup, config };
});

// Used by the "Save" button in the settings menu
ipcMain.handle('save-config', async (event, gamePath, modPath, autoUpdate) => {
  const { success, config } = saveConfig(gamePath, modPath, autoUpdate);
  return { success, config };
});

// Used to update the modlist
ipcMain.handle('update-modlist', async () => {
  // URL of the raw JSON file on GitHub
  const githubRawURL = 'https://raw.githubusercontent.com/Arargd/Faroquin/refs/heads/main/modslist.json';

  try {
    const data = await new Promise((resolve, reject) => {
      https.get(githubRawURL, (res) => {
        let jsonData = '';

        // Collect data chunks
        res.on('data', (chunk) => {
          jsonData += chunk;
        });

        // Handle the end of the response
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(jsonData);
          } else {
            reject(new Error(`Failed to fetch: ${res.statusCode} ${res.statusMessage}`));
          }
        });
      }).on('error', (err) => {
        reject(err);
      });
    });

    // Write fetched data to the local modlist.json file
    fs.writeFileSync(modlist, data, 'utf-8');

    const successMessage = "Successfully pulled the latest modlist!";
    log.info(successMessage);
    return successMessage;
  } catch (error) {
    const errorMessage = `Failed to update modlist: ${error.message}`;
    log.error(errorMessage);
    return errorMessage;
  }
});


// Utilized by the launch game sidebar button
ipcMain.handle('launch-game', async () => {
  return new Promise((resolve, reject) => {
    exec(gameExe, (err, stdout, stderr) => {
      if (err) {
        log.error('Error launching game:', err);
        reject(`Failed to launch game: ${err.message}`);
        return;
      }

      if (stderr) {
        log.warn('Game launched with warnings:', stderr);
        resolve(`Game launched with warnings: ${stderr}`);
        return;
      }

      log.info('Game launched successfully:', stdout);
      resolve('Game launched successfully');
    });
  });
});

// For the "Browse" buttons in the settings menu
// This will open the file dialog and allow the user to select a directory/file
// Allows passing a specific file-type, say .exe to only show executables
ipcMain.handle('open-file-dialog', async (event, initialDirectory, fileType = null) => {
  const dialogProperties = fileType 
    ? ['openFile'] 
    : ['openDirectory']; 

  const filters = fileType
    ? [{ name: `${fileType.toUpperCase()} Files`, extensions: [fileType.replace('.', '')] }]
    : [];

  const result = await dialog.showOpenDialog({
    properties: dialogProperties,
    title: fileType ? `Select a ${fileType.toUpperCase()} File` : 'Select a Folder',
    defaultPath: initialDirectory, 
    filters: filters,
  });

  if (result.canceled) {
    return null;
  }

  return result.filePaths[0];
});


// -- ipcHandlers GitHub --

// Handle reading a GitHub markdown file (README)
ipcMain.handle('fetch-readme', async (event, repoUrl) => {
  // Account for a couple of branches and some readme names, so glad everyone follows the same format... I wish
  const branches = ['main', 'master'];
  const readmeFiles = ['README.md', 'readme.md', 'Readme.md'];

  for (const branch of branches) {
    for (const readme of readmeFiles) {
      const rawUrl = repoUrl.replace('github.com', 'raw.githubusercontent.com') + `/${branch}/${readme}`;
      log.info(`Attempting to fetch README from: ${rawUrl}`);

      try {
        const html = await new Promise((resolve, reject) => {
          https.get(rawUrl, (response) => {
            if (response.statusCode !== 200) return reject();
            let data = '';
            response.on('data', chunk => data += chunk);
            response.on('end', () => resolve(marked.parse(data))); // Convert markdown to HTML
          }).on('error', () => reject());
        });
        return html;
      } catch {
        log.warn(`Failed to fetch README from: ${rawUrl}`);
        continue; // Try the next readme file/branch if the current one fails
      }
    }
  }
  throw new Error('README not found on main or master branch with available filenames.');
});

//Gets mod commit hash on main or master
ipcMain.handle('fetch-hash', async (event, githubUrl, mod) => {
  const match = githubUrl.match(/^https:\/\/github\.com\/(.+)\/(.+)$/);
  if (!match) throw new Error('Invalid GitHub URL format.');
  const githubRepo = `${match[1]}/${match[2]}`;

  //TODO
  //This is use redundantly, ideally changed later
  async function getCommitHash(branch) {
    const apiUrl = `https://api.github.com/repos/${githubRepo}/commits/${branch}`;
    return await fetchCommitHash(apiUrl, mod);
  }

  let commitData;

  try {
    commitData = await getCommitHash('main');
  } catch {
    commitData = await getCommitHash('master');
  }

  return commitData;
});

// Helper function to fetch the commit hash
async function fetchCommitHash(apiUrl, modItem) {
  return new Promise((resolve, reject) => {
    // Set up headers with If-None-Match and If-Modified-Since fallback
    const headers = {
      'Authorization': 'JustaString', // Found on a stackoverflow, without this it counts against the rate limit
      'User-Agent': 'Electron',
      ...(modItem.etag ? { 'if-none-match': modItem.etag } : {}), // Utilize ETags to simply get 304 on the same pages
    };

    https.get(apiUrl, { headers }, (res) => {
      let data = '';

      // Handle "Not Modified" response (304)
      if (res.statusCode === 304) {
        log.info(`No changes detected for ${apiUrl}`);
        return resolve({ sha: modItem.sha, etag: modItem.etag });
      }

      // Handle error responses like 404 or 403
      if (res.statusCode === 404 || res.statusCode === 403) {
        log.error(`Received error: ${res.statusCode} for ${apiUrl}`);
        return reject(new Error(`Request failed with status code: ${res.statusCode}`));
      }

      // Handle other errors (non-200)
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to fetch commit data: HTTP status ${res.statusCode}`));
      }

      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          // Parse commit data
          const commitData = JSON.parse(data);
          const newEtag = res.headers['etag']; // Extract ETag from headers

          // Check for valid commit data and return
          if (commitData?.sha) {
            resolve({ sha: commitData.sha, etag: newEtag });
          } else {
            reject(new Error('Invalid commit data received'));
          }
        } catch (error) {
          reject(new Error(`Failed to parse commit data: ${error.message}`));
        }
      });
    }).on('error', (err) => reject(new Error(`Request failed: ${err.message}`)));
  });
}

// -- ipcHandlers Files -- 

// Provided a partial path which is then made with .faro to make/update .faro file
// Currently used for updating SHAs & Updating Toggle
ipcMain.handle('create-faro', async (event, modPath, modData) => {
  if (!modPath) {
    throw new Error('No mod path provided');
  }

  const filePath = path.join(modPath, '.faro'); // Construct the full file path

  try {
    // Create a .faro file with relevant data
    await fs.writeFileSync(filePath, JSON.stringify([modData], null, 2), 'utf-8');
    return 'File created successfully';
  } catch (error) {
    log.error('Error creating file:', error);
    throw new Error('Error creating file: ' + error.message);
  }
});


// Handle creating the .lovelyignore file for disabling mods
ipcMain.handle('create-file', async (event, modPath) => {
  if (!modPath) {
    throw new Error('No mod path provided');
  }

  const filePath = path.join(modPath, '.lovelyignore'); // Construct the full file path

  try {
    // Create an empty .lovelyignore file at the constructed path
    await fs.promises.writeFile(filePath, '');
    return 'File created successfully';
  } catch (error) {
    log.error('Error creating file:', error);
    throw new Error('Error creating file: ' + error.message);
  }
});


// Handle deleting a file, using modPath as the file if no fileName is provided
ipcMain.handle('delete-file', async (event, modPath, fileName) => {
  const filePath = fileName ? path.join(modPath, fileName) : modPath; // Use modPath if no fileName is provided

  try {
    // Call the deleteFile function to perform the actual deletion
    await deleteFile(filePath);
    return 'File deleted successfully';
  } catch (error) {
    log.error('Error deleting file:', error);
    throw new Error('Error deleting file: ' + error.message);
  }
});

// Function to delete a file specifically for use inside main.js
async function deleteFile(filePath) {
  try {
    if (!filePath) {
      throw new Error('No file path provided');
    }
    // Fixes a weird issue where some files aren't deleted instantly, something in the program locks them up.
    // Instead it renames them and then when the program is closed it deletes them.
    // A fix to this issue in general would be appreciated.
    let tempFilePath = `${filePath}.${Math.random().toString(36).substring(2, 15)}`;  // Random string as suffix
    await fs.promises.rename(filePath, tempFilePath); // Rename first
    log.info(`File renamed to: ${tempFilePath}`);

    // Attempt to delete after renaming
    await fs.promises.unlink(tempFilePath);
    log.info(`Deleted successfully: ${tempFilePath}`);
    return 'File deleted successfully'; // Return success message
  } catch (error) {
    log.error('Error deleting file:', error.message);
    throw new Error('Error deleting file: ' + error.message);
  }
}

// Function to delete a directory
async function deleteDirectory(dirPath) {
  try {
    // Delete the directory recursively
    await fs.promises.rm(dirPath, { recursive: true, force: true });
    return 'Directory deleted successfully'; // Return success message
  } catch (error) {
    log.error('Error deleting directory:', error.message);
    throw new Error('Error deleting directory: ' + error.message);
  }
}


// Handle the 'delete-directory' event
ipcMain.handle('delete-directory', async (event, dirPath) => {
  return await deleteDirectory(dirPath);
});

// Handle the 'delete-special' event
ipcMain.handle('delete-special', async (event, mod) => {
  try {
    for (const specialPath of mod.specialPaths) {
      const isDirectory = fs.existsSync(specialPath) && fs.statSync(specialPath).isDirectory();

      if (isDirectory) {
        // Use the deleteDirectory function
        try {
          const message = await deleteDirectory(specialPath);
          log.info(`Directory deleted successfully: ${message}`);
        } catch (error) {
          log.error(`Failed to delete directory at ${specialPath}:`, error.message);
        }
      } else {
        // Use the deleteFile function
        try {
          const message = await deleteFile(specialPath);
          log.info(`File deleted successfully: ${message}`);
        } catch (error) {
          log.error(`Failed to delete file at ${specialPath}:`, error.message);
        }
      }
    }
    return 'Special paths processed successfully.';
  } catch (error) {
    log.error('Error processing special paths:', error.message);
    throw new Error('Failed to delete special paths.');
  }
});

// Utility to unzip a file
// It makes a folder for the unzipped contents to go in and then puts said contents in it.
function unzipFile(zipPath, destination) {
  return new Promise((resolve, reject) => {
    const unzipDir = path.join(destination, path.basename(zipPath, '.zip')); // Create folder named after the zip

    try {
      // Create a new AdmZip instance with the provided ZIP file
      const zip = new AdmZip(zipPath);

      // Extract the ZIP file contents to the target directory
      zip.extractAllTo(unzipDir, true); // The second argument 'true' will overwrite existing files

      const extractedItems = fs.readdirSync(unzipDir);

      // Handle single folder case
      if (extractedItems.length === 1 && fs.statSync(path.join(unzipDir, extractedItems[0])).isDirectory()) {
        const singleFolder = path.join(unzipDir, extractedItems[0]);
        resolve(singleFolder); // Return the single folder path
      } else {
        // Handle multiple files/folders case
        const flattenedDir = path.join(unzipDir, 'flattened');
        fs.mkdirSync(flattenedDir);

        extractedItems.forEach((item) => {
          const itemPath = path.join(unzipDir, item);
          const targetPath = path.join(flattenedDir, item);
          fs.renameSync(itemPath, targetPath);
        });

        resolve(flattenedDir); // Return the flattened folder
      }
    } catch (error) {
      reject(new Error(`Error processing extracted files: ${error.message}`));
    }
  });
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);

    function download(urlToFetch) {
      https.get(urlToFetch, (response) => {
        if (response.statusCode === 200) {
          // Pipe the response to the file
          pipeline(response, file, (err) => {
            if (err) return reject(err);
            file.close();
            resolve();
          });
        } else if (response.statusCode === 302 || response.statusCode === 301) {
          // Follow the redirect
          const redirectUrl = response.headers.location;
          if (!redirectUrl) return reject(new Error('Redirect location not found.'));
          download(redirectUrl);
        } else {
          reject(new Error(`Failed to download file: ${response.statusCode}`));
        }
      }).on('error', (err) => {
        fs.unlinkSync(destination); // Cleanup on failure
        reject(err);
      });
    }

    download(url);
  });
}

// -- ipcHandlers Install Mods --

ipcMain.handle('install-mod', async (event, mod) => {
  try {

    const githubUrl = mod.github;
    if (!githubUrl) throw new Error('No GitHub URL provided.');

    const match = githubUrl.match(/^https:\/\/github\.com\/(.+)\/(.+)$/);
    if (!match) throw new Error('Invalid GitHub URL format.');

    const githubRepo = `${match[1]}/${match[2]}`;

    // TODO
    // This is redundantly used, consolidate later
    async function getCommitHash(branch) {
      const apiUrl = `https://api.github.com/repos/${githubRepo}/commits/${branch}`;
      return await fetchCommitHash(apiUrl, mod);
    }
    let commitHash;

    try {
      commitHash = await getCommitHash('main');
    } catch {
      commitHash = await getCommitHash('master');
    }


    let finalModPath = [];

    // Handle installing lovely different than normal mods
    if (mod.id == "lovely") {
      finalModPath = await installLovely(mod);
    }
    else {
      finalModPath = await installMod(mod, githubUrl);
      if (mod.id == "steamodded") {
        // Install smods like a normal mod, but Creates relevant .faro file for smods
        await installSmods(mod);
      }
    }

    log.info(`Mod installed successfully at: ${finalModPath}`);

    // Mark mod as installed and enabled
    mod.installed = true;
    mod.enabled = true;

    await loadMods(loadConfig());

    // After loading all the mods information from our modsLoader we pass on necessary information to the .faro
    const faroFile = path.join(finalModPath, '.faro');
    const data = await fs.promises.readFile(faroFile, 'utf-8');
    let faroData = JSON.parse(data); // Parse the JSON data

    // Ensure faroData is an array
    if (!Array.isArray(faroData)) {
      faroData = [faroData];
    }

    // Add or update the `github` and `zipPath` properties for each mod item
    faroData.forEach(modItem => {
      modItem.github = mod.github;
      modItem.specialDownload = mod.specialDownload;
      modItem.sha = commitHash.sha;
      modItem.etag = commitHash.etag;
    });

    await fs.promises.writeFile(faroFile, JSON.stringify(faroData, null, 2), 'utf-8');
    log.info(`Updated mod with id ${mod.id} in .faro file at: ${faroFile}`);

    log.info(`Mod .faro successfully created at: ${finalModPath}`);

    return { success: true, message: `Mod installed at ${finalModPath}` };
  } catch (error) {
    log.error('Error installing mod:', error);
    return { success: false, message: error.message };
  }
});


// -- Install Functions --

async function installMod(mod, githubUrl) {

  // Function to download the ZIP file from a given branch, with retry logic
  async function downloadModFromBranch(branch) {
    let archiveUrl = "";
    archiveUrl = `${githubUrl}/archive/refs/heads/${branch}.zip`; // Construct the URL for the branch
    const zipFileName = `${mod.name}.zip`;
    const zipFilePath = path.join(zippedDir, zipFileName);

    log.info(mod.id);

    // Utilize special downloads for specific versions
    if (mod.specialDownload && mod.id !== "lovely") {
      log.info(archiveUrl);
      archiveUrl = mod.specialDownload;
    }

    // Try downloading the file
    await downloadFile(archiveUrl, zipFilePath);
    return zipFilePath;
  }

  // Try downloading from 'main', then fall back to 'master' if it fails
  let zipFilePath;
  try {
    zipFilePath = await downloadModFromBranch('main');
  } catch {
    zipFilePath = await downloadModFromBranch('master');
  }

  // Unzip the file
  const extractedDir = await unzipFile(zipFilePath, zippedDir);

  log.info(extractedDir);

  try {
    // Read the contents of the extracted directory
    const contents = await fs.promises.readdir(extractedDir, { withFileTypes: true });

    // Log the contents
    contents.forEach((entry) => {
      if (entry.isDirectory()) {
        log.info('Directory:', entry.name);
      } else {
        log.info('File:', entry.name);
      }
    });
  } catch (error) {
    log.error('Error reading extracted directory contents:', error);
  }

  // Sanitize folder name and move extracted folder to modsDir
  const sanitizedDir = mod.specialDownload
    ? extractedDir.replace(new RegExp(`-${mod.specialDownload.match(/\/archive\/([a-zA-Z0-9]+)\.zip$/)[1]}$`), '')
    : extractedDir.replace(/(-main|-master)$/i, ''); // Remove commit hash or branch suffix

  const finalModPath = path.join(modsDir, path.basename(sanitizedDir));

  if (!fs.existsSync(finalModPath)) {
    fs.renameSync(extractedDir, finalModPath); // Only rename if the folder doesn't already exist
  }

  // Removes an empty folder from the zipped folder
  fs.rmdirSync(path.dirname(extractedDir));

  log.info(zipFilePath);
  if (fs.existsSync(zipFilePath)) {
    log.info("ZIP EXISTS");
    await deleteFile(zipFilePath);
  }


  return finalModPath;
}

// Creates a .faro for smods before the modsLoader, slightly hardcoded
async function installSmods(mod) {
  // Hardcoded to the smods title
  const smodsFolder = path.join(modsDir, 'smods');

  if (!fs.existsSync(smodsFolder)) fs.mkdirSync(smodsFolder, { recursive: true });

  const smodsFaro = path.join(smodsFolder, '.faro');

  const modInfo = getModInfo(smodsFolder, mod, true);

  fs.writeFileSync(smodsFaro, JSON.stringify([modInfo], null, 2), 'utf-8');
}

// Because of the special file and format the zip is in, we handle lovely different than normal mods.
// This could potentially be consolidated later
async function installLovely(mod) {
  const archiveUrl = mod.specialDownload;
  const zipFileName = `${mod.name}.zip`;
  const zipFilePath = path.join(zippedDir, zipFileName);

  log.info('Downloading lovely.');

  await downloadFile(archiveUrl, zipFilePath);

  const extractedDir = await unzipFile(zipFilePath, zippedDir);

  const finalModPath = path.join(gameDir, 'version.dll');

  log.info('Beginning to move version.dll for lovely.');

  // If the version.dll doesn't exist in the game directory, move it
  if (!fs.existsSync(finalModPath)) {
    const extractedFilePath = path.join(extractedDir, 'version.dll');
    log.info(extractedFilePath);
    log.info(finalModPath);
    // Used later for deleting version.dll
    mod.specialPaths = [];
    mod.specialPaths.push(finalModPath);
    if (fs.existsSync(extractedFilePath)) {
      fs.renameSync(extractedFilePath, finalModPath); // Move the file to the game directory
      log.info('version.dll moved to game directory.');
    } else {
      log.error('version.dll not found in the extracted folder.');
    }
  }

  if (fs.existsSync(extractedDir) && fs.readdirSync(extractedDir).length === 0) {
    fs.rmdirSync(extractedDir); // Remove the extracted directory if it's empty
    log.info('Removed empty extracted directory.');
  }

  if (fs.existsSync(zipFilePath)) {
    fs.unlinkSync(zipFilePath); // Remove the zip file
    log.info('Deleted the zip file:', zipFilePath);
  }

  log.info('Installed Lovely!');

  // Creates the lovely folder in the mods dir so that it indexes with a .faro file

  const lovelyFolder = path.join(modsDir, 'lovely');

  if (!fs.existsSync(lovelyFolder)) fs.mkdirSync(lovelyFolder, { recursive: true });

  const lovelyFaro = path.join(lovelyFolder, '.faro');

  const modInfo = getModInfo(lovelyFolder, mod, true);

  fs.writeFileSync(lovelyFaro, JSON.stringify([modInfo], null, 2), 'utf-8');

  return lovelyFolder;
}