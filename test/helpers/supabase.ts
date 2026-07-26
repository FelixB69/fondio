import { vi } from "vitest";

// Mock minimal mais fidèle du client Supabase pour tester les routes API sans
// vraie base. Le vrai client expose un query-builder CHAÎNABLE :
//   supabase.from("t").select("...").eq("a", 1).eq("b", 2).single()
// Chaque méthode renvoie le builder ; les terminaux (`single`/`maybeSingle`) et
// l'`await` direct du builder (insert/update/delete/select sans single) doivent
// résoudre un résultat `{ data, error }`.
//
// On enregistre chaque appel dans un `QueryState` que le `handler` fourni par le
// test inspecte (table + suite de méthodes) pour décider quoi renvoyer. C'est
// volontairement explicite : pas de magie cachée, le test décrit exactement les
// réponses de la DB qu'il simule.

export interface QueryCall {
  fn: string;
  args: unknown[];
}
export interface QueryState {
  table: string;
  calls: QueryCall[];
}
export type QueryResult = { data?: unknown; error?: unknown };
export type QueryHandler = (state: QueryState) => QueryResult;

export interface SupabaseMockOptions {
  // Utilisateur renvoyé par auth.getUser(). `null` = non authentifié.
  user?: ({ id: string } & Record<string, unknown>) | null;
  // Décide le résultat d'une requête à partir de la table et des méthodes
  // appelées. Par défaut : `{ data: null, error: null }`.
  handler?: QueryHandler;
}

export interface SupabaseMock {
  auth: { getUser: ReturnType<typeof vi.fn> };
  from: ReturnType<typeof vi.fn>;
  // Toutes les requêtes vues, dans l'ordre — pratique pour asserter les effets
  // de bord (insert, update…).
  queries: QueryState[];
}

export function createSupabaseMock(opts: SupabaseMockOptions = {}): SupabaseMock {
  const user = opts.user === undefined ? { id: "user-1" } : opts.user;
  const handler = opts.handler ?? (() => ({ data: null, error: null }));
  const queries: QueryState[] = [];

  function makeBuilder(table: string) {
    const state: QueryState = { table, calls: [] };
    queries.push(state);
    const resolve = () => Promise.resolve(handler(state));

    const builder: Record<string | symbol, unknown> = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            // Rend le builder « thenable » : `await supabase.from(...).insert(...)`
            // résout le résultat du handler.
            return (onFulfilled: (v: QueryResult) => unknown) => resolve().then(onFulfilled);
          }
          if (prop === "single" || prop === "maybeSingle") {
            return () => {
              state.calls.push({ fn: String(prop), args: [] });
              return resolve();
            };
          }
          // Méthode de chaînage (select, eq, order, insert, update, delete,
          // upsert, neq, limit…) : on enregistre et on renvoie le builder.
          return (...args: unknown[]) => {
            state.calls.push({ fn: String(prop), args });
            return builder;
          };
        },
      },
    );
    return builder;
  }

  return {
    auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) },
    from: vi.fn((table: string) => makeBuilder(table)),
    queries,
  };
}

// Petit utilitaire pour retrouver la 1re requête sur une table donnée.
export function queryOn(mock: SupabaseMock, table: string): QueryState | undefined {
  return mock.queries.find((q) => q.table === table);
}
