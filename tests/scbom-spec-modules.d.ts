declare module "@scbom/spec/conformance" {
  export interface ScbomConformanceCase {
    readonly id: string;
    readonly valid: boolean;
    readonly document: unknown;
  }

  const suite: {
    readonly suite: string;
    readonly schema_version: "0.0.1";
    readonly cases: readonly ScbomConformanceCase[];
  };

  export default suite;
}
