/// <reference types="vite/client" />

declare module 'virtual:viewer-bundle' {
  const code: string;
  export default code;
}

declare module '*.mmd?raw' {
  const src: string;
  export default src;
}
