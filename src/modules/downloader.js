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

    // If using custom repo, check if it has releases with binaries
    if (owner || branch || configObj.cli?.customRepo) {
        const hasCustomReleases = await checkCustomRepoReleases(repoOwner);

        if (hasCustomReleases && version !== 'nightly') {
            // Use custom repository releases if available
            return constants.remote.binariesUrl
                .replace('neutralinojs/neutralinojs', `${repoOwner}/neutralinojs`)
                .replace(/\{tag\}/g, utils.getVersionTag(version));
        } else {
            // Warn user and fall back to official repository
            utils.warn(`Custom repository ${repoOwner}/neutralinojs does not have pre-compiled binary releases.`);
            utils.warn('Falling back to official neutralinojs repository binaries.');
            utils.warn('Note: The binaries may not include changes from the custom repository.');

            // Use official repository binaries
            return constants.remote.binariesUrl
                .replace(/\{tag\}/g, utils.getVersionTag(version));
        }
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

let checkCustomRepoReleases = (owner) => {
    return new Promise((resolve) => {
        if (owner === constants.defaults.owner) {
            resolve(true); // Official repo always has releases
            return;
        }

        let opt = {
            headers: { 'User-Agent': 'Neutralinojs CLI' }
        };

        const releasesUrl = `https://api.github.com/repos/${owner}/neutralinojs/releases`;
        https.get(releasesUrl, opt, function (response) {
            let body = '';
            response.on('data', (data) => body += data);
            response.on('end', () => {
                try {
                    if (response.statusCode === 200) {
                        const releases = JSON.parse(body);
                        // Check if there are any releases with assets (binaries)
                        const hasValidReleases = releases.some(release =>
                            release.assets && release.assets.length > 0 &&
                            release.assets.some(asset => asset.name.includes('neutralinojs-'))
                        );
                        resolve(hasValidReleases);
                    } else {
                        resolve(false);
                    }
                } catch (error) {
                    resolve(false);
                }
            });
        })
        .on('error', () => {
            resolve(false);
        });
    });
}

let downloadBinariesFromRelease = (latest, owner = null, branch = null) => {
    return new Promise((resolve, reject) => {
        fs.mkdirSync('.tmp', { recursive: true });
        const zipFilename = '.tmp/binaries.zip';
        const file = fs.createWriteStream(zipFilename);

        utils.log('Downloading Neutralinojs binaries..');

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

    // All binaries now come from release format (either official or custom repo releases)
    for (let platform in constants.files.binaries) {
        for (let arch in constants.files.binaries[platform]) {
            let binaryFile = constants.files.binaries[platform][arch];
            if (fse.existsSync(`.tmp/${binaryFile}`)) {
                fse.copySync(`.tmp/${binaryFile}`, `bin/${binaryFile}`);
                // Ensure that correct permissions are set
                // Non-applicable on Windows platform and not needed for Windows executables
                if (process.platform !== 'win32' && platform !== 'win32') {
                    fse.chmodSync(`bin/${binaryFile}`, '755');
                }
            }
        }
    }

    for (let dependency of constants.files.dependencies) {
        if (fse.existsSync(`.tmp/${dependency}`)) {
            fse.copySync(`.tmp/${dependency}`, `bin/${dependency}`);
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

        // Check if the repository exists
        const checkUrl = `https://api.github.com/repos/${owner}/neutralinojs`;
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
