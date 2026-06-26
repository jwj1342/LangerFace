// Compatibility facade for legacy JS imports.
// The React SPA-owned implementation lives under src/services/llmProvider.ts.
export {
  __llmProviderForTests,
  normalizeProviderBaseUrl,
  providerTestEndpointFor,
  testProviderConnection,
} from "./src/services/llmProvider.ts";
