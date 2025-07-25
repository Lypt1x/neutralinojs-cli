const utils = require('../utils');
const downloader = require('../modules/downloader');

module.exports.register = (program) => {
    program
        .command('update')
        .description('updates neutralinojs binaries, client library, and TypeScript definitions')
        .option('-l, --latest')
        .option('--owner <owner>', 'specify custom GitHub repository owner with releases (e.g., "Lypt1x")')
        .option('--branch <branch>', 'specify custom GitHub repository branch for client library (e.g., "feature-branch")')
        .action(async (command) => {
            utils.checkCurrentProject();

            if (command.owner || command.branch) {
                const owner = command.owner || 'neutralinojs';
                const branch = command.branch || 'main';
                utils.log(`Using custom repository settings: ${owner}/neutralinojs${command.branch ? ` (${branch} branch for client)` : ''}`);

                // Validate custom repository
                if (command.owner && command.owner !== 'neutralinojs') {
                    utils.log('Validating custom repository...');
                    const isValid = await downloader.isValidCustomRepo(owner, branch);
                    if (!isValid) {
                        utils.error(`Custom repository ${owner}/neutralinojs does not exist or is not accessible.`);
                        process.exit(1);
                    }
                }
            }

            try {
                await downloader.downloadAndUpdateBinaries(command.latest, command.owner, command.branch);
                await downloader.downloadAndUpdateClient(command.latest, command.owner);

                utils.showArt();
                utils.log('Run "neu version" to see installed version details.');
            } catch (error) {
                utils.error(`Failed to update: ${error.message}`);
                process.exit(1);
            }
        });
}

