const process = require('process');
const path = require('path');
const fs = require('fs');
const fse = require('fs-extra');
const config = require('../modules/config');
const downloader = require('./downloader');
const frontendlib = require('../modules/frontendlib');
const hostproject = require('../modules/hostproject');
const utils = require('../utils');

module.exports.createApp = async (appPath, template, owner = null, branch = null) => {
    const binaryName = path.basename(path.resolve(appPath));

    if (utils.isNeutralinojsProject(appPath)) {
        utils.error(`${appPath} directory already contains a Neutralinojs project.`);
        process.exit(1);
    }

    if(!template) {
        template = 'neutralinojs/neutralinojs-minimal';
    }

    utils.log(`Checking if ${template} is a valid Neutralinojs app template...`);

    const isValidTemplate = await downloader.isValidTemplate(template);
    if(!isValidTemplate) {
        utils.error(`${template} is not a valid Neutralinojs app template.`);
        process.exit(1);
    }

    utils.log(`Downloading ${template} template to ${binaryName} directory...`);

    if (owner || branch) {
        const repoOwner = owner || 'neutralinojs';
        const repoBranch = branch || 'main';
        utils.log(`Using custom Neutralino.js repository: ${repoOwner}/neutralinojs${branch ? ` (${repoBranch} branch)` : ''}`);

        // Validate custom repository
        if (owner && owner !== 'neutralinojs') {
            utils.log('Validating custom repository...');
            const isValid = await downloader.isValidCustomRepo(repoOwner, repoBranch);
            if (!isValid) {
                utils.error(`Custom repository ${repoOwner}/neutralinojs does not exist or is not accessible.`);
                process.exit(1);
            }
        }
    }

    fs.mkdirSync(appPath, { recursive: true });
    process.chdir(appPath); // Change the path context for the following methods

    try {
        await downloader.downloadTemplate(template);
        await downloader.downloadAndUpdateBinaries(false, owner, branch);
        await downloader.downloadAndUpdateClient(false, owner);
    }
    catch(err) {
        utils.error('Unable to download resources from internet.' +
                    ' Please check your internet connection and template URLs.');
        if (owner || branch) {
            utils.error('Please verify that the custom repository and branch exist and are accessible.');
        }
        process.exit(1);
    }

    config.update('cli.binaryName', binaryName);
    config.update('modes.window.title', binaryName);

    if(frontendlib.containsFrontendLibApp()) {
        await frontendlib.runCommand('initCommand');
    }

    if(hostproject.hasHostProject()) {
        await hostproject.runCommand('initCommand');
    }

    console.log('-------');
    utils.log(`Enter 'cd ${appPath} && neu run' to run your application.`);
}
