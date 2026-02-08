#!/usr/bin/env node
import { Command } from 'commander';
import { runCommand } from './commands/run';
import { serveCommand } from './commands/serve';
import { taskCommand } from './commands/task';

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

program.parse(process.argv);
