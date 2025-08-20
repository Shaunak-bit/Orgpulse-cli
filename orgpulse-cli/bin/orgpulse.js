#!/usr/bin/env node
import 'dotenv/config'; // Load env vars first
import { Command } from "commander";

// Import command modules
import initCommand from "../src/commands/init.js";
import fetchCommand from "../src/commands/fetch.js";
import analyzeCommand from "../src/commands/analyze.js";
import reportCommand from "../src/commands/report.js";
import exportCommand from "../src/commands/export.js";
import topCommand from '../src/commands/top.js';
import syncStarsCommand from '../src/commands/syncStars.js';

const program = new Command();

program
  .name("orgpulse")
  .description("OrgPulse CLI tool for GitHub org analytics")
  .version("1.0.0");

// Register commands
initCommand(program);
fetchCommand(program);
analyzeCommand(program);
reportCommand(program);
exportCommand(program);
topCommand(program);
syncStarsCommand(program);

program.parseAsync(process.argv);   // <-- 🔑 use async version
