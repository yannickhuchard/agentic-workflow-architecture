#!/usr/bin/env node
import { Command } from 'commander';
import { runCommand } from './commands/run';
import { serveCommand } from './commands/serve';
import { taskCommand } from './commands/task';
import { initCommand } from './commands/init';
import { generateCommand } from './commands/generate';
import { recipeCommand } from './commands/recipe';
import { knowledgeCommand } from './commands/knowledge';
import { replayCommand } from './commands/replay';
import { journeyCommand } from './commands/journey';
import { measuresCommand } from './commands/measures';
import { validateCommand } from './commands/validate';

import { version } from '../../package.json';

const program = new Command();

program
    .name('awa')
    .description('Agentic Workflow Architecture CLI')
    .version(version);

program.addCommand(runCommand);
program.addCommand(validateCommand);
program.addCommand(serveCommand);
program.addCommand(taskCommand);
program.addCommand(initCommand);
program.addCommand(generateCommand);
program.addCommand(recipeCommand);
program.addCommand(knowledgeCommand);
program.addCommand(replayCommand);
program.addCommand(journeyCommand);
program.addCommand(measuresCommand);

program.parse(process.argv);
