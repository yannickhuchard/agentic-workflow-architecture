#!/usr/bin/env node
import { Command } from 'commander';
import { runCommand } from './commands/run';
import { serveCommand } from './commands/serve';
import { taskCommand } from './commands/task';
import { initCommand } from './commands/init';
import { generateCommand } from './commands/generate';
import { recipeCommand } from './commands/recipe';

// @ts-ignore
import { version } from '../../package.json';

const program = new Command();

program
    .name('awa')
    .description('Agentic Workflow Architecture CLI')
    .version(version);

program.addCommand(runCommand);
program.addCommand(serveCommand);
program.addCommand(taskCommand);
program.addCommand(initCommand);
program.addCommand(generateCommand);
program.addCommand(recipeCommand);

program.parse(process.argv);
