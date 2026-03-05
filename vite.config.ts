import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const normalizeEnv = (value: string | undefined): string =>
    typeof value === 'string' ? value.trim().replace(/^['"]|['"]$/g, '') : '';
  const supabaseUrl = normalizeEnv(env.VITE_SUPABASE_URL);
  const localOnlyFlag = normalizeEnv(env.VITE_LOCAL_ONLY).toLowerCase();
  const isLocalOnlyMode = localOnlyFlag === 'true' || localOnlyFlag === '1' || localOnlyFlag === 'yes';

  let supabaseOrigin = '';
  try {
    supabaseOrigin = !isLocalOnlyMode && supabaseUrl ? new URL(supabaseUrl).origin : '';
  } catch {
    supabaseOrigin = '';
  }

  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify; file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: supabaseOrigin
        ? {
            '/_supabase': {
              target: supabaseOrigin,
              changeOrigin: true,
              secure: true,
              ws: true,
              rewrite: (requestPath) => requestPath.replace(/^\/_supabase/, ''),
            },
          }
        : undefined,
    },
  };
});
