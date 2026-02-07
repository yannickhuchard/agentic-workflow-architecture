#!/usr/bin/env node
import { Command } from 'commander';
import { runCommand } from './commands/run';
import { serveCommand } from './commands/serve';
// @ts-ignore
import { version } from '../../package.json';

const program = new Command();

program
    .name('awa')
    .description('Agentic Workflow Architecture CLI')
    .version(version);

program.addCommand(runCommand);
program.addCommand(serveCommand);

program.parse(process.argv);
