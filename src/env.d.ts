declare module "virtual:microbloggr" {
  const config: {
    editorUrl: string;
    siteBase: string;
    thumbnailPath: string;
    clientUrl: string;
  };
  export default config;
}

declare module "virtual:microbloggr/server" {
  const store: ReturnType<typeof import("./server/store.mjs").createStore>;
  export default store;
}
