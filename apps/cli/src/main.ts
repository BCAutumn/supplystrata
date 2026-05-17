#!/usr/bin/env node
import { Command } from "commander";
import { registerClaimCommands } from "./commands/claims.js";
import { registerDbAndAdminCommands } from "./commands/db-admin.js";
import { registerEntityAndReviewCommands } from "./commands/entity-review.js";
import { registerGraphDqAndCardCommands } from "./commands/graph-dq-cards.js";
import { registerPipelinePreviewCommands } from "./commands/pipeline-preview.js";
import { registerSourcesAndChangesCommands } from "./commands/sources-changes.js";

const program = new Command();

program.name("supplystrata").description("Open Supply Chain Evidence Graph MVP CLI").version("0.1.0");

registerDbAndAdminCommands(program);
registerPipelinePreviewCommands(program);
registerSourcesAndChangesCommands(program);
registerEntityAndReviewCommands(program);
registerGraphDqAndCardCommands(program);
registerClaimCommands(program);

await program.parseAsync(process.argv);
