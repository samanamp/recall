// Vite asset import used by the .apkg importer (sql.js wasm binary).
declare module "*.wasm?url" {
  const url: string;
  export default url;
}
