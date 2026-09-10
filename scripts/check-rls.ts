/**
 * Fails CI if any migration creates a table without also enabling RLS
 * on it, in the same file.
 *
 * This is a deliberately simple regex-based check, not a SQL parser —
 * good enough to catch the common mistake ("I'll add RLS later") without
 * needing a full SQL AST. If migrations grow complex enough to defeat
 * this regex (e.g. dynamic table creation), replace this with a proper
 * parser rather than weakening the check.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

const CREATE_TABLE_RE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi;

function main() {
  let files: string[] = [];
  try {
    files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  } catch {
    console.log("No migrations directory yet — nothing to check. OK.");
    return;
  }

  if (files.length === 0) {
    console.log("No SQL migrations yet — nothing to check. OK.");
    return;
  }

  let failed = false;

  for (const file of files) {
    const path = join(MIGRATIONS_DIR, file);
    const sql = readFileSync(path, "utf8");

    const tables = [...sql.matchAll(CREATE_TABLE_RE)].map((m) => m[1]);

    for (const table of tables) {
      const rlsPattern = new RegExp(
        `ALTER\\s+TABLE\\s+"?${table}"?\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
        "i"
      );
      if (!rlsPattern.test(sql)) {
        console.error(
          `❌ ${file}: table "${table}" is created without ` +
            `"ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY" in the same file.`
        );
        failed = true;
      }
    }
  }

  if (failed) {
    console.error(
      "\nRLS check failed. Every table must enable RLS in the same " +
        "migration that creates it. See supabase/migrations/README.md."
    );
    process.exit(1);
  }

  console.log("✅ RLS check passed — every created table enables RLS.");
}

main();
