import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";

export function createKysely(db: D1Database): Kysely<Record<string, unknown>> {
  return new Kysely({
    dialect: new D1Dialect({ database: db }),
  });
}
