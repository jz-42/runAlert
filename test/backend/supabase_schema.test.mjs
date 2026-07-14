import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  import.meta.dirname,
  "../../supabase/migrations/20260714000000_runalert_v1_sync.sql"
);

describe("Supabase v1 sync schema", () => {
  it("defines separate configs, hashed device credentials, and pairing exchanges", () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toContain("create table public.runalert_v1_configs");
    expect(sql).toContain("create table public.runalert_v1_device_credentials");
    expect(sql).toContain("credential_hash text not null unique");
    expect(sql).toContain("create table public.runalert_v1_pairing_exchanges");
    expect(sql).toContain("exchange_hash text not null unique");
    expect(sql).toContain("code_hash text not null unique");
    expect(sql).toContain("create or replace function public.runalert_update_config");
    expect(sql).toContain(
      "create or replace function public.runalert_consume_pairing_exchange"
    );
    expect(sql).toContain(
      "create or replace function public.runalert_bootstrap_account"
    );
    expect(sql).not.toMatch(/\btoken\s+text/i);
  });
});
