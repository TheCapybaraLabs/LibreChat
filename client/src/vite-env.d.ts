/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_LOGGER: string;
  readonly VITE_LOGGER_FILTER: string;
  readonly VITE_CLIENT_BANNER: string | undefined;
  readonly VITE_PLATFORM_IMAGE: string;
  readonly VITE_DEV_LOGO: string;
  readonly VITE_APP_TITLE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
