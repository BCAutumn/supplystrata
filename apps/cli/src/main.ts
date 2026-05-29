#!/usr/bin/env node
import { Command } from "commander";
import { registerClaimCommands } from "./commands/claims.js";
import { registerCommunityPackCommands } from "./commands/community-pack.js";
import { registerDbAndAdminCommands } from "./commands/db-admin.js";
import { registerEntityAndReviewCommands } from "./commands/entity-review.js";
import { registerGraphDqAndCardCommands } from "./commands/graph-dq-cards.js";
import { registerIntelligenceCommands } from "./commands/intelligence.js";
import { registerPipelinePreviewCommands } from "./commands/pipeline-preview.js";
import { registerResearchCommands } from "./commands/research.js";
import { registerRuntimeCommands } from "./commands/runtime.js";
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
registerIntelligenceCommands(program);
registerWorkbenchCommands(program);
registerResearchCommands(program);
registerRuntimeCommands(program);
registerCommunityPackCommands(program);

try {
  await program.parseAsync(process.argv);
} catch (error) {
  process.stderr.write(`${formatCliError(error)}\n`);
  process.exitCode = 1;
}
