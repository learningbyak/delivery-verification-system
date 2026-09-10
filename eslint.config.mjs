import nextConfig from "eslint-config-next";

const eslintConfig = [
  ...nextConfig,
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/supabase/server",
              message:
                "src/lib/supabase/server.ts is server-only. If you're seeing this from a \"use client\" file, you have a bug — see the security notes in that file.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
