const fs = require('fs');
const fse = require('fs-extra');
const { https } = require('follow-redirects');
const constants = require('../constants');
const config = require('./config');
const utils = require('../utils');
const zl = require('zip-lib');

let cachedLatestClientVersion = null;


let getRemoteLatestVersion = (owner, repo) => {
    return new Promise((resolve, reject) => {
        let opt = {
            headers: { 'User-Agent': 'Neutralinojs CLI' }
        };
        https.get(constants.remote.releasesApiUrl.replace('{owner}', owner).replace('{repo}', repo), opt, function (response) {
            let body = '';
            response.on('data', (data) => body += data);
            response.on('end', () => {
                if (response.statusCode != 200) {
                    return reject();
                }
                let apiRes = JSON.parse(body);
                let version = apiRes.tag_name.replace('v', '');
                resolve(version);
            });
            response.on('error', () => {
                reject();
            });
        })
        .on('error', () => {
            reject();
        });
    });
}

let getLatestVersion = (owner, repo) => {
    return new Promise((resolve, reject) => {
        function fallback() {
            utils.warn('Unable to fetch the latest version tag from GitHub. Using nightly releases...');
            resolve('nightly');
        }

        getRemoteLatestVersion(owner, repo)
            .then((version) => {
                utils.log(`Found the latest release tag ${utils.getVersionTag(version)} for ${repo}...`);
                resolve(version);
            })
            .catch((error) => fallback());
    });
}

let getScriptExtension = () => {
    const configObj = config.get();
    let clientLibrary = configObj.cli.clientLibrary;
    return clientLibrary.includes('.mjs') ? 'mjs' : 'js';
}

let getBinaryDownloadUrl = async (latest, owner = null, branch = null) => {
    const configObj = config.get();
    let version = configObj.cli.binaryVersion;

    // Use custom repository settings if provided
    const repoOwner = owner || configObj.cli?.customRepo?.owner || constants.defaults.owner;
    const repoBranch = branch || configObj.cli?.customRepo?.branch || constants.defaults.branch;

    if (!version || latest) {
        version = await getLatestVersion(repoOwner, 'neutralinojs');
        config.update('cli.binaryVersion', version);
    }

    // If using custom repo/branch, use archive URL instead of release URL
    if (owner || branch || configObj.cli?.customRepo) {
        return constants.remote.binariesArchiveUrl
            .replace('{owner}', repoOwner)
            .replace('{branch}', repoBranch);
    }

    return constants.remote.binariesUrl
        .replace(/\{tag\}/g, utils.getVersionTag(version));
}

let getClientDownloadUrl = async (latest, types = false, owner = null) => {
    const configObj = config.get();
    let version = configObj.cli.clientVersion;

    // Use custom repository settings if provided
    const repoOwner = owner || configObj.cli?.customRepo?.owner || constants.defaults.owner;

    if (!version || latest) {
        if (cachedLatestClientVersion) {
            version = cachedLatestClientVersion;
        }
        else {
            version = await getLatestVersion(repoOwner, 'neutralino.js');
        }
        cachedLatestClientVersion = version;
        config.update('cli.clientVersion', version);
    }

    let scriptUrl = constants.remote.clientUrlPrefix + (types ? 'd.ts' : getScriptExtension());
    return scriptUrl
        .replace(/\{tag\}/g, utils.getVersionTag(version));
}

let getTypesDownloadUrl = (latest, owner = null) => {
    return getClientDownloadUrl(latest, true, owner);
}

let getRepoNameFromTemplate = (template) => {
    return template.split('/')[1];
}

let downloadBinariesFromRelease = (latest, owner = null, branch = null) => {
    return new Promise((resolve, reject) => {
        fs.mkdirSync('.tmp', { recursive: true });
        const zipFilename = '.tmp/binaries.zip';
        const file = fs.createWriteStream(zipFilename);

        const repoOwner = owner || constants.defaults.owner;
        const repoBranch = branch || constants.defaults.branch;

        if (owner || branch) {
            utils.log(`Downloading Neutralinojs binaries from ${repoOwner}/neutralinojs (${repoBranch} branch)..`);
        } else {
            utils.log('Downloading Neutralinojs binaries..');
        }

        getBinaryDownloadUrl(latest, owner, branch)
            .then((url) => {
                https.get(url, function (response) {
                    if (response.statusCode !== 200) {
                        reject(new Error(`Failed to download from ${url}. Status: ${response.statusCode}. Please check if the repository and branch exist.`));
                        return;
                    }
                    response.pipe(file);
                    response.on('end', () => {
                        utils.log('Extracting binaries.zip file...');
                        zl.extract(zipFilename, '.tmp/')
                            .then(() => resolve())
                            .catch((e) => reject(e));
                    });
                })
                .on('error', (e) => {
                    reject(new Error(`Failed to download binaries: ${e.message}. Please check if the repository and branch exist.`));
                });
            })
            .catch((e) => reject(e));
    });
}

let downloadClientFromRelease = (latest, owner = null) => {
    return new Promise((resolve, reject) => {
        fs.mkdirSync('.tmp', { recursive: true });
        const file = fs.createWriteStream('.tmp/neutralino.' + getScriptExtension());
        utils.log('Downloading the Neutralinojs client..');
        getClientDownloadUrl(latest, false, owner)
            .then((url) => {
                https.get(url, function (response) {
                    if (response.statusCode !== 200) {
                        reject(new Error(`Failed to download client from ${url}. Status: ${response.statusCode}`));
                        return;
                    }
                    response.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        resolve();
                    });
                })
                .on('error', (e) => {
                    reject(new Error(`Failed to download client: ${e.message}`));
                });
            })
            .catch((e) => reject(e));
    });
}

let downloadTypesFromRelease = (latest, owner = null) => {
    return new Promise((resolve, reject) => {
        fs.mkdirSync('.tmp', { recursive: true });
        const file = fs.createWriteStream('.tmp/neutralino.d.ts');
        utils.log('Downloading the Neutralinojs types..');

        getTypesDownloadUrl(latest, owner)
            .then((url) => {
                https.get(url, function (response) {
                    if (response.statusCode !== 200) {
                        reject(new Error(`Failed to download types from ${url}. Status: ${response.statusCode}`));
                        return;
                    }
                    response.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        resolve();
                    });
                })
                .on('error', (e) => {
                    reject(new Error(`Failed to download types: ${e.message}`));
                });
            })
            .catch((e) => reject(e));
    });
}

module.exports.downloadTemplate = (template) => {
    return new Promise((resolve, reject) => {
        let templateUrl = constants.remote.templateUrl.replace('{template}', template);
        fs.mkdirSync('.tmp', { recursive: true });
        const zipFilename = '.tmp/template.zip';
        const file = fs.createWriteStream(zipFilename);
        https.get(templateUrl, function (response) {
            response.pipe(file);
            response.on('end', () => {
                utils.log('Extracting template zip file...');
                zl.extract(zipFilename, '.tmp/')
                    .then(() => {
                        fse.copySync(`.tmp/${getRepoNameFromTemplate(template)}-main`, '.');
                        utils.clearDirectory('.tmp');
                        resolve();
                    })
                    .catch((e) => reject(e));
            });
        });
    });
}

module.exports.downloadAndUpdateBinaries = async (latest = false, owner = null, branch = null) => {
    // Store custom repo settings in config if provided
    if (owner || branch) {
        const configObj = config.get();
        if (!configObj.cli) configObj.cli = {};
        if (!configObj.cli.customRepo) configObj.cli.customRepo = {};

        if (owner) {
            configObj.cli.customRepo.owner = owner;
            config.update('cli.customRepo.owner', owner);
        }
        if (branch) {
            configObj.cli.customRepo.branch = branch;
            config.update('cli.customRepo.branch', branch);
        }
    }

    await downloadBinariesFromRelease(latest, owner, branch);
    utils.log('Finalizing and cleaning temp. files.');
    if (!fse.existsSync('bin'))
        fse.mkdirSync('bin');

    // Check if we're using custom repo (archive format) or release format
    const isCustomRepo = owner || branch || config.get().cli?.customRepo;
    let sourceDir = '.tmp';

    if (isCustomRepo) {
        // For custom repos, binaries are in neutralinojs-{branch}/bin/ folder
        const repoOwner = owner || config.get().cli?.customRepo?.owner || constants.defaults.owner;
        const repoBranch = branch || config.get().cli?.customRepo?.branch || constants.defaults.branch;
        sourceDir = `.tmp/neutralinojs-${repoBranch}/bin`;
    }

    for (let platform in constants.files.binaries) {
        for (let arch in constants.files.binaries[platform]) {
            let binaryFile = constants.files.binaries[platform][arch];
            const sourcePath = isCustomRepo ? `${sourceDir}/${binaryFile}` : `.tmp/${binaryFile}`;
            if (fse.existsSync(sourcePath)) {
                fse.copySync(sourcePath, `bin/${binaryFile}`);
                // Ensure that correct permissions are set
                // Non-applicable on Windows platform and not needed for Windows executables
                if (process.platform !== 'win32' && platform !== 'win32') {
                    fse.chmodSync(`bin/${binaryFile}`, '755');
                }
            }
        }
    }

    for (let dependency of constants.files.dependencies) {
        const sourcePath = isCustomRepo ? `${sourceDir}/${dependency}` : `.tmp/${dependency}`;
        if (fse.existsSync(sourcePath)) {
            fse.copySync(sourcePath, `bin/${dependency}`);
        }
    }
    utils.clearDirectory('.tmp');
}

module.exports.downloadAndUpdateClient = async (latest = false, owner = null) => {
    const configObj = config.get();
    if (!configObj.cli.clientLibrary) {
        utils.log(`neu CLI won't download the client library --` +
            ` download @neutralinojs/lib from your Node package manager.`);
        return;
    }

    // Store custom repo owner in config if provided
    if (owner) {
        if (!configObj.cli) configObj.cli = {};
        if (!configObj.cli.customRepo) configObj.cli.customRepo = {};
        configObj.cli.customRepo.owner = owner;
        config.update('cli.customRepo.owner', owner);
    }

    const clientLibrary = utils.trimPath(configObj.cli.clientLibrary);
    await downloadClientFromRelease(latest, owner);
    await downloadTypesFromRelease(latest, owner);
    utils.log('Finalizing and cleaning temp. files...');
    fse.copySync(`.tmp/${constants.files.clientLibraryPrefix + getScriptExtension()}`
        , `./${clientLibrary}`);
    fse.copySync(`.tmp/neutralino.d.ts`
        , `./${clientLibrary.replace(/[.][a-z]*$/, '.d.ts')}`);
    utils.clearDirectory('.tmp');
}

module.exports.isValidTemplate = (template) => {
    return new Promise((resolve) => {
        let opt = {
            headers: { 'User-Agent': 'Neutralinojs CLI' }
        };

        function fallback() {
            utils.warn('Unable to check the template validity via the GitHub API. Assuming that the template is valid...');
            resolve(true);
        }

        https.get(constants.remote.templateCheckUrl.replace('{template}', template), opt,
        function (response) {
            response.req.abort();
            if(response.statusCode == 200) {
                resolve(true);
            }
            else if(response.statusCode == 404) {
                resolve(false);
            }
            else {
                fallback();
            }
        })
        .on('error', (e) => {
            fallback();
        });
    });

}

module.exports.isValidCustomRepo = (owner, branch = 'main') => {
    return new Promise((resolve) => {
        let opt = {
            headers: { 'User-Agent': 'Neutralinojs CLI' }
        };

        function fallback() {
            utils.warn('Unable to check the custom repository validity via the GitHub API. Assuming that the repository is valid...');
            resolve(true);
        }

        const checkUrl = `https://api.github.com/repos/${owner}/neutralinojs/contents/bin`;
        https.get(checkUrl, opt, function (response) {
            response.req.abort();
            if(response.statusCode == 200) {
                resolve(true);
            }
            else if(response.statusCode == 404) {
                resolve(false);
            }
            else {
                fallback();
            }
        })
        .on('error', (e) => {
            fallback();
        });
    });
}

module.exports.getRemoteLatestVersion = getRemoteLatestVersion;
