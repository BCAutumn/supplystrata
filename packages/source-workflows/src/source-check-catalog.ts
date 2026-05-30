import type { DatabaseStore } from "@supplystrata/db/write";
import type { AdapterContext, SourceAdapter } from "@supplystrata/source-adapter-spec";
import type { CreateAdapterContextInput } from "@supplystrata/source-adapter-runtime";
import type { SourceCheckConnector, SourceCheckTargetRow } from "@supplystrata/source-connectors";
import { appleSuppliersAdapter, createAppleSuppliersAdapterContext } from "@supplystrata/sources-apple-suppliers";
import { censusTradeAdapter, createCensusTradeAdapterContext } from "@supplystrata/sources-census-trade";
import { createOshAdapterContext, oshAdapter } from "@supplystrata/sources-osh";
import { createAdapterContext as createSecAdapterContext, secCompanyFactsAdapter, secEdgarAdapter } from "@supplystrata/sources-sec-edgar";
import { createWorldBankPinkAdapterContext, worldBankPinkAdapter } from "@supplystrata/sources-worldbank-pink";
import { appleSupplierInputFromConfig, appleSupplierListReviewSourceCheckConnector } from "./apple-suppliers.js";
import { censusTradeInputFromConfig, censusTradeSourceCheckConnector } from "./census-trade-checks.js";
import { cninfoAdapter, cninfoCompanyFilingsInputFromConfig, cninfoCompanyFilingsSourceCheckConnector, createCninfoAdapterContext } from "./cninfo-checks.js";
import {
  createDartKrAdapterContext,
  dartKrAdapter,
  dartKrBodyAdapter,
  dartKrCompanyBodyInputFromConfig,
  dartKrCompanyBodySourceCheckConnector,
  dartKrCompanyFilingsInputFromConfig,
  dartKrCompanyFilingsSourceCheckConnector
} from "./dart-kr-checks.js";
import {
  createEdinetAdapterContext,
  edinetAdapter,
  edinetBodyAdapter,
  edinetCompanyFilingsInputFromConfig,
  edinetCompanyFilingsSourceCheckConnector,
  edinetDailyFilingsInputFromConfig,
  edinetDailyFilingsSourceCheckConnector
} from "./edinet-checks.js";
import {
  createHkexNewsAdapterContext,
  hkexNewsAdapter,
  hkexNewsTitleSearchInputFromConfig,
  hkexNewsTitleSearchSourceCheckConnector
} from "./hkex-news-checks.js";
import {
  asmlIrAdapter,
  companyIrExplicitUrlAdapter,
  createOfficialIrAdapterContext,
  micronIrAdapter,
  samsungIrAdapter,
  skHynixIrAdapter,
  tsmcIrAdapter
} from "./official-ir-adapters.js";
import {
  asmlIrInputFromConfig,
  companyIrExplicitUrlInputFromConfig,
  micronIrInputFromConfig,
  officialIrSourceCheckConnectors,
  samsungIrInputFromConfig,
  skHynixIrInputFromConfig,
  tsmcIrInputFromConfig
} from "./official-ir-checks.js";
import {
  createOfacSanctionsAdapterContext,
  ofacSanctionsAdapter,
  ofacSanctionsInputFromConfig,
  ofacSanctionsSourceCheckConnector
} from "./ofac-sanctions-checks.js";
import { oshInputFromConfig, oshSourceCheckConnector } from "./osh-checks.js";
import {
  secCompanyFactsInputFromTargetConfig,
  secCompanyFactsSourceCheckConnector,
  secEdgarInputFromTargetConfig,
  secEdgarSourceCheckConnector
} from "./sec-edgar.js";
import {
  createTwseMopsAdapterContext,
  twseMopsAdapter,
  twseMopsElectronicDocumentsInputFromConfig,
  twseMopsElectronicDocumentsSourceCheckConnector
} from "./twse-mops-checks.js";
import { worldBankPinkInputFromConfig, worldBankPinkSourceCheckConnector } from "./worldbank-pink-checks.js";
import type { SourceCheckSummary } from "./source-check-runner.js";

export interface SourceCheckCatalogRuntime {
  adapterContextInput: CreateAdapterContextInput;
}

export interface SourceCheckSmokeExecution<TInput> {
  adapter: SourceAdapter<TInput, Uint8Array>;
  adapterInput: TInput;
  context: AdapterContext;
}

export interface SourceCheckCatalogEntry {
  connector: SourceCheckConnector<DatabaseStore, SourceCheckSummary, SourceCheckTargetRow>;
  executeSmoke<TResult>(input: {
    targetConfig: Record<string, unknown>;
    runtime: SourceCheckCatalogRuntime;
    run<TInput>(execution: SourceCheckSmokeExecution<TInput>): Promise<TResult>;
  }): Promise<TResult>;
}

interface SourceCheckCatalogEntryInput<TInput> {
  connector: SourceCheckConnector<DatabaseStore, SourceCheckSummary, SourceCheckTargetRow>;
  adapter: SourceAdapter<TInput, Uint8Array>;
  inputFromConfig(config: Record<string, unknown>): TInput;
  createContext(runtime: SourceCheckCatalogRuntime): AdapterContext;
}

export const SOURCE_CHECK_CATALOG = [
  sourceCheckCatalogEntry({
    connector: appleSupplierListReviewSourceCheckConnector,
    adapter: appleSuppliersAdapter,
    inputFromConfig: appleSupplierInputFromConfig,
    createContext: (runtime) => createAppleSuppliersAdapterContext(runtime.adapterContextInput)
  }),
  sourceCheckCatalogEntry({
    connector: dartKrCompanyFilingsSourceCheckConnector,
    adapter: dartKrAdapter,
    inputFromConfig: dartKrCompanyFilingsInputFromConfig,
    createContext: (runtime) => createDartKrAdapterContext(runtime.adapterContextInput)
  }),
  sourceCheckCatalogEntry({
    connector: edinetDailyFilingsSourceCheckConnector,
    adapter: edinetAdapter,
    inputFromConfig: edinetDailyFilingsInputFromConfig,
    createContext: (runtime) => createEdinetAdapterContext(runtime.adapterContextInput)
  }),
  sourceCheckCatalogEntry({
    connector: edinetCompanyFilingsSourceCheckConnector,
    adapter: edinetBodyAdapter,
    inputFromConfig: edinetCompanyFilingsInputFromConfig,
    createContext: (runtime) => createEdinetAdapterContext(runtime.adapterContextInput)
  }),
  sourceCheckCatalogEntry({
    connector: cninfoCompanyFilingsSourceCheckConnector,
    adapter: cninfoAdapter,
    inputFromConfig: cninfoCompanyFilingsInputFromConfig,
    createContext: (runtime) => createCninfoAdapterContext(runtime.adapterContextInput)
  }),
  sourceCheckCatalogEntry({
    connector: dartKrCompanyBodySourceCheckConnector,
    adapter: dartKrBodyAdapter,
    inputFromConfig: dartKrCompanyBodyInputFromConfig,
    createContext: (runtime) => createDartKrAdapterContext(runtime.adapterContextInput)
  }),
  sourceCheckCatalogEntry({
    connector: twseMopsElectronicDocumentsSourceCheckConnector,
    adapter: twseMopsAdapter,
    inputFromConfig: twseMopsElectronicDocumentsInputFromConfig,
    createContext: (runtime) => createTwseMopsAdapterContext(runtime.adapterContextInput)
  }),
  sourceCheckCatalogEntry({
    connector: hkexNewsTitleSearchSourceCheckConnector,
    adapter: hkexNewsAdapter,
    inputFromConfig: hkexNewsTitleSearchInputFromConfig,
    createContext: (runtime) => createHkexNewsAdapterContext(runtime.adapterContextInput)
  }),
  sourceCheckCatalogEntry({
    connector: secEdgarSourceCheckConnector,
    adapter: secEdgarAdapter,
    inputFromConfig: secEdgarInputFromTargetConfig,
    createContext: (runtime) => createSecAdapterContext(runtime.adapterContextInput)
  }),
  sourceCheckCatalogEntry({
    connector: secCompanyFactsSourceCheckConnector,
    adapter: secCompanyFactsAdapter,
    inputFromConfig: secCompanyFactsInputFromTargetConfig,
    createContext: (runtime) => createSecAdapterContext(runtime.adapterContextInput)
  }),
  sourceCheckCatalogEntry({
    connector: officialIrConnector("company-ir"),
    adapter: companyIrExplicitUrlAdapter,
    inputFromConfig: companyIrExplicitUrlInputFromConfig,
    createContext: (runtime) => createOfficialIrAdapterContext(runtime.adapterContextInput)
  }),
  sourceCheckCatalogEntry({
    connector: officialIrConnector("tsmc-ir"),
    adapter: tsmcIrAdapter,
    inputFromConfig: tsmcIrInputFromConfig,
    createContext: (runtime) => createOfficialIrAdapterContext(runtime.adapterContextInput)
  }),
  sourceCheckCatalogEntry({
    connector: officialIrConnector("samsung-ir"),
    adapter: samsungIrAdapter,
    inputFromConfig: samsungIrInputFromConfig,
    createContext: (runtime) => createOfficialIrAdapterContext(runtime.adapterContextInput)
  }),
  sourceCheckCatalogEntry({
    connector: officialIrConnector("skhynix-ir"),
    adapter: skHynixIrAdapter,
    inputFromConfig: skHynixIrInputFromConfig,
    createContext: (runtime) => createOfficialIrAdapterContext(runtime.adapterContextInput)
  }),
  sourceCheckCatalogEntry({
    connector: officialIrConnector("asml-ir"),
    adapter: asmlIrAdapter,
    inputFromConfig: asmlIrInputFromConfig,
    createContext: (runtime) => createOfficialIrAdapterContext(runtime.adapterContextInput)
  }),
  sourceCheckCatalogEntry({
    connector: officialIrConnector("micron-ir"),
    adapter: micronIrAdapter,
    inputFromConfig: micronIrInputFromConfig,
    createContext: (runtime) => createOfficialIrAdapterContext(runtime.adapterContextInput)
  }),
  sourceCheckCatalogEntry({
    connector: censusTradeSourceCheckConnector,
    adapter: censusTradeAdapter,
    inputFromConfig: censusTradeInputFromConfig,
    createContext: (runtime) => createCensusTradeAdapterContext(runtime.adapterContextInput)
  }),
  sourceCheckCatalogEntry({
    connector: oshSourceCheckConnector,
    adapter: oshAdapter,
    inputFromConfig: oshInputFromConfig,
    createContext: (runtime) => createOshAdapterContext(runtime.adapterContextInput)
  }),
  sourceCheckCatalogEntry({
    connector: worldBankPinkSourceCheckConnector,
    adapter: worldBankPinkAdapter,
    inputFromConfig: worldBankPinkInputFromConfig,
    createContext: (runtime) => createWorldBankPinkAdapterContext(runtime.adapterContextInput)
  }),
  sourceCheckCatalogEntry({
    connector: ofacSanctionsSourceCheckConnector,
    adapter: ofacSanctionsAdapter,
    inputFromConfig: ofacSanctionsInputFromConfig,
    createContext: (runtime) => createOfacSanctionsAdapterContext(runtime.adapterContextInput)
  })
] as const;

function sourceCheckCatalogEntry<TInput>(entry: SourceCheckCatalogEntryInput<TInput>): SourceCheckCatalogEntry {
  return {
    connector: entry.connector,
    executeSmoke(input) {
      return input.run({
        adapter: entry.adapter,
        adapterInput: entry.inputFromConfig(input.targetConfig),
        context: entry.createContext(input.runtime)
      });
    }
  };
}

function officialIrConnector(sourceAdapterId: string): SourceCheckConnector<DatabaseStore, SourceCheckSummary, SourceCheckTargetRow> {
  const connector = officialIrSourceCheckConnectors.find((item) => item.source_adapter_id === sourceAdapterId);
  if (connector === undefined) throw new Error(`Missing official IR source-check connector: ${sourceAdapterId}`);
  return connector;
}
