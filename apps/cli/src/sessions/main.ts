import { runCli } from '../cli.js';

process.exitCode = await runCli(['sessions', ...process.argv.slice(2)]);
