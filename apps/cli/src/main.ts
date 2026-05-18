#!/usr/bin/env node
import { Command } from "commander";
import { registerClaimCommands } from "./commands/claims.js";
import { registerDbAndAdminCommands } from "./commands/db-admin.js";
import { registerEntityAndReviewCommands } from "./commands/entity-review.js";
import { registerGraphDqAndCardCommands } from "./commands/graph-dq-cards.js";
import { registerPipelinePreviewCommands } from "./commands/pipeline-preview.js";
import { registerResearchCommands } from "./commands/research.js";
import { registerSourcesAndChangesCommands } from "./commands/sources-changes.js";
import { registerWorkbenchCommands } from "./commands/workbench.js";
import { formatCliError } from "./cli-utils.js";

const program = new Command();

program.name("supplystrata").description("Open Supply Chain Evidence Graph MVP CLI").version("0.1.0");

registerDbAndAdminCommands(program);
registerPipelinePreviewCommands(program);
registerSourcesAndChangesCommands(program);
registerEntityAndReviewCommands(program);
registerGraphDqAndCardCommands(program);
registerClaimCommands(program);
registerWorkbenchCommands(program);
registerResearchCommands(program);

try {
  await program.parseAsync(process.argv);
} catch (error) {
  process.stderr.write(`${formatCliError(error)}\n`);
  process.exitCode = 1;
}
