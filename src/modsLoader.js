// -- Requires --
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const log = require('electron-log');
const modlistString = require('./modlist.js'); // Import the string

//-- Global Variables

// Path to the mods directory
// Not sure this is non-Windows friendly
let modsDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Balatro', 'mods');
const modlist = app.isPackaged
    ? path.join(app.getPath('userData'), 'modslist.json')
    : path.join(__dirname, 'modslist.json');

// This may be redundant due to main.js
// Potentially remove this when available
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

// Utilized in indexing .faro files
let createdFaros = [];

// -- Main Functionality --

async function loadMods(configData) {
    // Set modDir based on config 
    // This probably should be adjusted later
    const { startup, config } = configData;

    modsDir = config.modsDir;

    // Processing and indexing all mods in the mods folder currently
    let mods = [];

    const excludedFolders = []; // Legacy code when I excluded steamodded, may be useful eventually

    if (fs.existsSync(modsDir)) {
        processFolder(modsDir, mods, excludedFolders);
    } else {
        log.warn('Mods directory does not exist: ${modsDir}');
    }

    // Load any mods that don't already exist from our mod list
    mods = await loadFileMods(mods, modlist);

    // Clear out created files once we're done
    createdFaros = [];

    return mods;
}

// Function to process each folder recursively for mods installed
function processFolder(folderPath, mods, excludedFolders) {
    const filesAndFolders = fs.readdirSync(folderPath);
    const faroFile = path.join(folderPath, '.faro');
    let faroExists = false;

    log.info(`Does faro exist at ${faroFile}?, ${fs.existsSync(faroFile)}`);

    // Check if .faro exists in the folder before processing any files
    // Also check if for any recently created .faro files, some mods may have more than one mod header
    if (fs.existsSync(faroFile) && !createdFaros.includes(faroFile)) {

        faroExists = true;
        try {
            const faroData = JSON.parse(fs.readFileSync(faroFile, 'utf-8'));
            mods.push(...faroData); // Add the faro data to the mods array
            log.info(`Pushed data from .faro file in ${folderPath}`);
        } catch (error) {
            log.error(`Error reading .faro file in ${folderPath}:`, error);
        }
    }

    // If .faro exists, skip the file processing (no need to recurse or process .json or .lua files)
    if (faroExists) {
        return;
    }

    // Looks for installed mods that aren't indexed already
    let jsonFileExists = false;
    let luaFileExists = false;

    filesAndFolders.forEach(item => {
        const itemPath = path.join(folderPath, item);
        const stat = fs.statSync(itemPath);

        // Skip excluded folders (currently unused)
        if (stat.isDirectory() && excludedFolders.includes(item)) {
            return;
        }

        // If it's a directory, recurse into it
        if (stat.isDirectory()) {
            processFolder(itemPath, mods, excludedFolders);
        } else {

            // Lua is prioritized over the json files
            // Order being changed affects which id is used
            if (item.endsWith('.lua')) {
                luaFileExists = processLuaFile(itemPath, mods);
            }

            if (item.endsWith('.json') && !luaFileExists) {
                jsonFileExists = true;
                processJsonFile(itemPath, mods);
            }

        }
    });
}

// Loads our from our modlist after processing everything we do have installed.
// This populates our browse mods section
async function loadFileMods(mods, filePath) {
    try {
        const data = fs.readFileSync(filePath, 'utf-8');
        const jsonData = JSON.parse(data); // Parse JSON data

        if (Array.isArray(jsonData)) {
            jsonData.forEach((modData) => {
                const modExists = mods.some(mod => mod.id === modData.id);

                if (!modExists) {
                    mods.push({
                        id: modData.id || path.basename(filePath, '.json'),
                        name: modData.name || 'Unknown Mod',
                        description: modData.description || 'No description available.',
                        enabled: modData.enabled || false,
                        installed: modData.installed || false,
                        github: modData.github,
                        core: modData.core || false,
                        specialDownload: modData.specialDownload || "",
                    });
                } else {
                    log.info(`Mod with id ${modData.id} already exists, skipping.`);
                }
            });
        } else {
            log.error('JSON data is not an array.');
            return null;
        }

    } catch (error) {
        log.error('Error reading JSON file:', error);
        return null;
    }
    return mods;
}

// -- Process Functions --

// Json and Lua process are similar, may consolidate here

// Function to process JSON files
function processJsonFile(filePath, mods) {
    try {
        const data = fs.readFileSync(filePath, 'utf-8');
        const modData = safeParseJson(data);

        // Check for .lovelyignore file to determine if it's enabled
        const ignoreFile = path.join(path.dirname(filePath), '.lovelyignore');
        const isEnabled = !fs.existsSync(ignoreFile);

        // Validate the JSON structure
        if (isValidJsonMod(modData)) {
            const modInfo = getModInfo(filePath, modData, isEnabled);
            const faroFile = path.join(modInfo.modPath, '.faro');
            const faroExists = fs.existsSync(faroFile);

            // Handle .faro file creation or update
            if (!faroExists) {
                fs.writeFileSync(faroFile, JSON.stringify([modInfo], null, 2), 'utf-8');
                createdFaros.push(faroFile)
                log.info(`Created .faro file and added the first mod: ${modData.name}`);
            } else {
                const existingData = JSON.parse(fs.readFileSync(faroFile, 'utf-8'));
                existingData.push(modInfo);
                fs.writeFileSync(faroFile, JSON.stringify(existingData, null, 2), 'utf-8');
                log.info(`Added mod to existing .faro file: ${modData.name}`);
            }

            mods.push(modInfo);  // Add the mod to the list
        } else {
            log.warn(`Invalid JSON structure in ${filePath}`);
        }
    } catch (error) {
        log.error(`Error parsing mod JSON file: ${filePath}`, error);
    }
}

// Function to process Lua files
function processLuaFile(filePath, mods) {
    try {
        const modData = parseLuaHeader(filePath);  // Parse Lua header for mod info

        // Check for .lovelyignore file to determine if it's enabled
        const ignoreFile = path.join(path.dirname(filePath), '.lovelyignore');
        const isEnabled = !fs.existsSync(ignoreFile);

        if (modData) {
            const modInfo = getModInfo(filePath, modData, isEnabled);
            const faroFile = path.join(modInfo.modPath, '.faro');
            const faroExists = fs.existsSync(faroFile);

            // Handle .faro file creation or update
            if (!faroExists) {
                fs.writeFileSync(faroFile, JSON.stringify([modInfo], null, 2), 'utf-8');
                createdFaros.push(faroFile)
                log.info(`Created .faro file and added the first mod: ${modData.name}`);
            } else {
                const existingData = JSON.parse(fs.readFileSync(faroFile, 'utf-8'));
                existingData.push(modInfo);
                fs.writeFileSync(faroFile, JSON.stringify(existingData, null, 2), 'utf-8');
                log.info(`Added mod to existing .faro file: ${modData.name}`);
            }

            mods.push(modInfo);  // Add the mod to the list

            return true;
        } else {
            log.warn(`Invalid Lua header in ${filePath}`);
            return false;
        }
    } catch (error) {
        log.error(`Error parsing Lua file: ${filePath}`, error);
        return false;
    }
}

// -- Helper Functions --

// Helper function to get mod information
function getModInfo(filePath, modData, isEnabled) {
    const relativePath = path.relative(modsDir, filePath);
    const parts = relativePath.split(path.sep);
    const fullPath = path.dirname(filePath);
    const mainFolder = path.join(modsDir, parts[0]);

    // Determine file type (JSON or LUA) to set the mod ID accordingly
    const extension = path.extname(filePath).toLowerCase();
    const modId = extension === '.json' ? (modData.id || path.basename(filePath, '.json')) :
        extension === '.lua' ? (modData.id || path.basename(filePath, '.lua')) :
            path.basename(filePath); // Default to the file name

    return {
        id: modData.id || modId,
        name: modData.name || 'Unknown Mod',
        description: modData.description || 'No description available.',
        enabled: isEnabled,
        version: modData.version || 'Unknown',
        prefix: modData.prefix || 'None',
        installed: true,
        modPath: mainFolder,
        modFullPath: fullPath,
        specialPaths: modData.specialPaths || [],
        canUpdate: false,
        core: modData.core || false,
    };
}

// Function to safely parse JSON, fixing common issues like trailing commas
function safeParseJson(jsonString) {
    try {
        // Remove trailing commas
        const cleanedJsonString = jsonString.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
        return JSON.parse(cleanedJsonString); // Try to parse the cleaned string
    } catch (error) {
        log.error('Error parsing JSON:', error);
        throw new Error('Invalid JSON structure');
    }
}

// Helper function to validate mod data structure
function isValidJsonMod(modData) {
    return modData && typeof modData === 'object' && modData.id && modData.name && modData.description;
}

// Function to read Lua file headers and extract details
function parseLuaHeader(filePath) {
    const luaHeader = fs.readFileSync(filePath, 'utf-8').replace(/\r/g, ''); // Carriage returns forcibly removed to not break html

    const headerComponents = {
        name: { pattern: /--- MOD_NAME: ([^\n]+)/, required: true },
        id: { pattern: /--- MOD_ID: ([^\n]+)/, required: true },
        author: { pattern: /--- MOD_AUTHOR: \[([^\n]+)\]/, required: true, parse_array: true },
        description: { pattern: /--- MOD_DESCRIPTION: ([^\n]+)/, required: true },
        priority: { pattern: /--- PRIORITY: (-?\d+)/, handle: (x) => (x ? +x : 0) },
        badge_colour: { pattern: /--- BADGE_COLOR: (\w+)/, handle: (x) => x || '666666FF' },
        badge_text_colour: { pattern: /--- BADGE_TEXT_COLOR: (\w+)/, handle: (x) => x || 'FFFFFF' },
        display_name: { pattern: /--- DISPLAY_NAME: ([^\n]+)/ },
        dependencies: {
            pattern: /--- DEPENDENCIES: \[([^\n]+)\]/,
            parse_array: true,
            handle: (x) => {
                if (typeof x === 'string') {
                    return x.split(',').map((item) => item.trim());
                }
                return x;
            },
        },
        conflicts: {
            pattern: /--- CONFLICTS: \[([^\n]+)\]/,
            parse_array: true,
            handle: (x) => {
                if (typeof x === 'string') {
                    return x.split(',').map((item) => item.trim());
                }
                return x;
            },
        },
        prefix: { pattern: /--- PREFIX: ([^\n]+)/ },
        version: { pattern: /--- VERSION: ([^\n]+)/, handle: (x) => x || '0.0.0' },
    };

    const mod = {};
    for (const [key, { pattern, required, handle, parse_array }] of Object.entries(headerComponents)) {
        const match = luaHeader.match(pattern);
        if (match) {
            let value = match[1];
            if (parse_array && value) {
                value = value.split(',').map((item) => item.trim());
            }
            if (handle) {
                value = handle(value);
            }
            mod[key] = value;
        } else if (required) {
            // Temporarily disabled because it spams logs
            /* log.warn(`Missing required field ${key} in Lua header. File: ${filePath}`); */
            // Ignore lua files without proper fields.
            return null;
        }
    }
    return mod;
}


module.exports = { loadMods, getModInfo };
