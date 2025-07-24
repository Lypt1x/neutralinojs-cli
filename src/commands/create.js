const creator = require('../modules/creator');
const utils = require('../utils');

module.exports.register = (program) => {
    program
        .command('create <binaryName>')
        .description('creates an app based on template (neutralinojs/neutralinojs-minimal by default)')
        .option('-t, --template [template]')
        .option('--owner <owner>', 'specify custom GitHub repository owner for Neutralino.js binaries (e.g., "Lypt1x")')
        .option('--branch <branch>', 'specify custom GitHub repository branch for Neutralino.js binaries (e.g., "feature-branch")')
        .action(async (binaryName, command) => {
            await creator.createApp(binaryName, command.template, command.owner, command.branch);
            utils.showArt();
        });
}

