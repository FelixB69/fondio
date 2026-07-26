import { vi } from "vitest";

// Mock minimal mais fidèle du client Supabase pour tester les routes API et les
// hooks sans vraie base. Le vrai client expose un query-builder CHAÎNABLE :
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
export type MockUser = ({ id: string } & Record<string, unknown>) | null;

const DEFAULT_HANDLER: QueryHandler = () => ({ data: null, error: null });

// Fabrique interne : un client dont l'utilisateur et le handler sont lus À CHAQUE
// APPEL via des getters. Cela permet aussi bien un mock figé qu'un mock pilotable
// (utile quand un module met en cache le client, cf. lib/use-tasks.ts).
function makeClient(getUser: () => MockUser, getHandler: () => QueryHandler) {
  const queries: QueryState[] = [];

  function makeBuilder(table: string) {
    const state: QueryState = { table, calls: [] };
    queries.push(state);
    const resolve = () => Promise.resolve(getHandler()(state));

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
    auth: { getUser: vi.fn(async () => ({ data: { user: getUser() }, error: null })) },
    from: vi.fn((table: string) => makeBuilder(table)),
    queries,
  };
}

export type SupabaseMock = ReturnType<typeof makeClient>;

export interface SupabaseMockOptions {
  // Utilisateur renvoyé par auth.getUser(). `null` = non authentifié.
  user?: MockUser;
  // Décide le résultat d'une requête à partir de la table et des méthodes
  // appelées. Par défaut : `{ data: null, error: null }`.
  handler?: QueryHandler;
}

// Mock figé : idéal pour une route API testée en une passe.
export function createSupabaseMock(opts: SupabaseMockOptions = {}): SupabaseMock {
  const user = opts.user === undefined ? { id: "user-1" } : opts.user;
  const handler = opts.handler ?? DEFAULT_HANDLER;
  return makeClient(
    () => user,
    () => handler,
  );
}

// Mock PILOTABLE : le même objet client reste valide entre tests (utile quand un
// module met en cache `createClient()`), mais on reconfigure user/handler à la
// volée via les setters.
export function createControllableSupabase() {
  let user: MockUser = { id: "user-1" };
  let handler: QueryHandler = DEFAULT_HANDLER;
  const client = makeClient(
    () => user,
    () => handler,
  );
  return {
    client,
    setUser: (u: MockUser) => {
      user = u;
    },
    setHandler: (h: QueryHandler) => {
      handler = h;
    },
    reset: () => {
      user = { id: "user-1" };
      handler = DEFAULT_HANDLER;
      client.queries.length = 0;
    },
  };
}

// Petit utilitaire pour retrouver la 1re requête sur une table donnée.
export function queryOn(mock: SupabaseMock, table: string): QueryState | undefined {
  return mock.queries.find((q) => q.table === table);
}
