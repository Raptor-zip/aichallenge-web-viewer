// vite の resolve.alias で ../mpc_schema.json を指している。
// TypeScript には型が見えないので、ここで JSON として宣言しておく。
declare module "@mpc-schema" {
  const value: unknown;
  export default value;
}
