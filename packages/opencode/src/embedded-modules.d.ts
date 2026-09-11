// Virtual modules served by script/build.ts plugins at bundle time. Absent in
// dev, so consumers must import them dynamically inside try/catch.
declare module "embedded:ts-worker-bundle" {
  const source: string
  export default source
}
